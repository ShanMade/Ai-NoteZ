from __future__ import annotations

import asyncio
from dataclasses import dataclass
import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.errors import NoteNotFound
from ...models import Note
from .embeddings import embed_query
from .qdrant_client import search as qdrant_search
from .query_classify import QueryPlan

_TOKEN = re.compile(r"[\w'-]+", re.UNICODE)
_TOKEN_BUDGET = 40_000
_SEARCH_STOP_WORDS = {"about", "and", "are", "for", "from", "how", "into", "the", "what", "when", "where", "with", "you", "your"}


@dataclass(frozen=True)
class Excerpt:
    note_id: uuid.UUID
    title: str
    text: str
    score: float
    version: int


@dataclass(frozen=True)
class RetrievalResult:
    excerpts: list[Excerpt]
    confident: bool
    direct_answer: str | None = None


@dataclass(frozen=True)
class _Hit:
    note_id: uuid.UUID
    chunk_index: int
    text: str
    score: float
    rank_score: float
    version: int | None


async def _attribute_query(
    db: AsyncSession,
    user_id: str,
    operation: str,
) -> RetrievalResult:
    base = select(Note).where(Note.user_id == user_id, Note.deleted_at.is_(None))
    if operation == "count":
        count = await db.scalar(select(func.count()).select_from(Note).where(Note.user_id == user_id, Note.deleted_at.is_(None)))
        return RetrievalResult([], True, f"You have {count or 0} notes.")
    if operation == "largest":
        result = await db.execute(base.order_by(func.length(Note.body).desc(), Note.updated_at.desc()).limit(1))
        note = result.scalar_one_or_none()
        answer = f"Your longest note is “{note.title or 'Untitled note'}” ({len(note.body)} characters)." if note else "You don't have any notes yet."
    else:
        result = await db.execute(base.order_by(Note.updated_at.desc(), Note.id.desc()).limit(1))
        note = result.scalar_one_or_none()
        answer = f"Your most recently updated note is “{note.title or 'Untitled note'}”." if note else "You don't have any notes yet."
    excerpts = [] if note is None else [Excerpt(note.id, note.title, note.body[:6000], 1.0, note.version)]
    return RetrievalResult(excerpts, True, answer)


async def _fts_search(db: AsyncSession, user_id: str, query: str, limit: int) -> list[_Hit]:
    tokens = list(
        dict.fromkeys(
            token.casefold()
            for token in _TOKEN.findall(query)
            if len(token) > 2 and token.casefold() not in _SEARCH_STOP_WORDS
        )
    )[:12]
    if not tokens:
        return []
    if db.get_bind().dialect.name == "postgresql":
        tsquery = func.websearch_to_tsquery("english", query)
        rank = func.ts_rank_cd(Note.search_vec, tsquery)
        statement = (
            select(Note.id, Note.version, Note.title, Note.body, rank.label("rank"))
            .where(
                Note.user_id == user_id,
                Note.deleted_at.is_(None),
                Note.search_vec.op("@@")(tsquery),
            )
            .order_by(rank.desc(), Note.updated_at.desc())
            .limit(limit)
        )
    else:
        conditions = [Note.title.ilike(f"%{token}%") | Note.body.ilike(f"%{token}%") for token in tokens]
        statement = (
            select(Note.id, Note.version, Note.title, Note.body)
            .where(Note.user_id == user_id, Note.deleted_at.is_(None), or_(*conditions))
            .order_by(Note.updated_at.desc())
            .limit(limit)
        )
    rows = (await db.execute(statement)).all()
    hits: list[_Hit] = []
    for rank_index, row in enumerate(rows):
        body = row.body or ""
        if db.get_bind().dialect.name == "postgresql":
            vector_rank = min(1.0, max(0.0, float(row.rank or 0.0)))
        else:
            vector_rank = 0.0
        corpus = f"{row.title or ''} {body}".casefold()
        lexical_coverage = sum(token in corpus for token in tokens) / len(tokens)
        raw_score = max(vector_rank, lexical_coverage)
        text = f"{row.title or 'Untitled note'}\n{body}".strip()[:5000]
        hits.append(_Hit(row.id, 0, text, raw_score, 1 / (60 + rank_index + 1), row.version))
    return hits


def reciprocal_rank_fusion(semantic: list[_Hit], lexical: list[_Hit], limit: int = 20) -> list[_Hit]:
    fused: dict[tuple[uuid.UUID, int], _Hit] = {}
    scores: dict[tuple[uuid.UUID, int], float] = {}
    for results in (semantic, lexical):
        for rank, hit in enumerate(results, start=1):
            key = (hit.note_id, hit.chunk_index)
            fused.setdefault(key, hit)
            scores[key] = scores.get(key, 0.0) + 1 / (60 + rank)
            previous = fused[key]
            if hit.score > previous.score:
                fused[key] = _Hit(hit.note_id, hit.chunk_index, hit.text, hit.score, scores[key], hit.version)
    return sorted(
        (_Hit(hit.note_id, hit.chunk_index, hit.text, hit.score, scores[key], hit.version) for key, hit in fused.items()),
        key=lambda hit: (hit.rank_score, hit.score),
        reverse=True,
    )[:limit]


def assemble_within_token_budget(hits: list[_Hit], notes: dict[uuid.UUID, Note]) -> list[Excerpt]:
    excerpts: list[Excerpt] = []
    remaining = _TOKEN_BUDGET
    for hit in hits:
        note = notes[hit.note_id]
        content = hit.text.strip()
        if not content:
            continue
        token_estimate = max(1, len(content) // 4)
        if token_estimate > remaining:
            content = content[: remaining * 4]
            token_estimate = max(1, len(content) // 4)
        excerpts.append(Excerpt(note.id, note.title, content, hit.score, note.version))
        remaining -= token_estimate
        if remaining <= 0:
            break
    return excerpts


async def retrieve(
    db: AsyncSession,
    user_id: str,
    plan: QueryPlan,
) -> RetrievalResult:
    if plan.scope == "note":
        note = await db.scalar(
            select(Note).where(
                Note.id == plan.note_id,
                Note.user_id == user_id,
                Note.deleted_at.is_(None),
            )
        )
        if note is None:
            raise NoteNotFound()
        text = f"{note.title}\n{note.body}".strip()
        return RetrievalResult(
            [Excerpt(note.id, note.title, text, 1.0, note.version)] if text else [],
            bool(text),
        )
    if plan.operation:
        return await _attribute_query(db, user_id, plan.operation)

    vector = await embed_query(plan.resolved_query)
    # Tenant ownership is enforced at the Qdrant query filter; this is never an unscoped search.
    raw_hits = await asyncio.to_thread(
        qdrant_search,
        "note_chunks",
        vector,
        user_id=user_id,
        limit=20,
    )
    semantic = [
        _Hit(
            uuid.UUID(hit["payload"]["note_id"]),
            int(hit["payload"].get("chunk_index", 0)),
            str(hit["payload"].get("text", "")),
            float(hit["score"]),
            0.0,
            int(hit["payload"]["version"]) if hit["payload"].get("version") is not None else None,
        )
        for hit in raw_hits
        if isinstance(hit.get("payload", {}).get("note_id"), str)
    ]
    lexical = await _fts_search(db, user_id, plan.resolved_query, 20)
    fused = reciprocal_rank_fusion(semantic, lexical, limit=20)
    note_ids = list(dict.fromkeys(hit.note_id for hit in fused))
    if not note_ids:
        return RetrievalResult([], False)
    rows = await db.execute(
        select(Note).where(
            Note.id.in_(note_ids),
            Note.user_id == user_id,
            Note.deleted_at.is_(None),
        )
    )
    live = {note.id: note for note in rows.scalars().all()}
    # The single batched ownership/version check deliberately drops stale index hits before prompting.
    verified = [
        hit
        for hit in fused
        if hit.note_id in live
        and (hit.version is None or hit.version == live[hit.note_id].version)
    ]
    best_score = max((hit.score for hit in verified), default=0.0)
    if best_score < settings.ai_rag_min_confidence:
        return RetrievalResult([], False)
    excerpts = assemble_within_token_budget(verified[:8], live)
    return RetrievalResult(excerpts, bool(excerpts))
