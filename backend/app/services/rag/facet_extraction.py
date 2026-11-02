from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...models import Note, NoteFacet
from ...services.recording.transcription import _generate_content
from .embeddings import embed_documents
from .qdrant_client import delete_facet_vectors, upsert

_FACET_NAMESPACE = uuid.UUID("da427063-8eb0-4dd7-b44b-07a16b836f1e")


@dataclass(frozen=True)
class FacetCandidate:
    facet_type: str
    name: str
    value: str


def parse_facet_candidates(payload: dict[str, Any]) -> list[FacetCandidate]:
    candidates: list[FacetCandidate] = []
    for source_key, facet_type in (
        ("keywords", "keyword"),
        ("people", "person"),
        ("places", "place"),
        ("dates", "date"),
    ):
        values = payload.get(source_key, [])
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str) and value.strip():
                cleaned = value.strip()[:4000]
                candidates.append(FacetCandidate(facet_type, cleaned[:120], cleaned))
    attributes = payload.get("attributes", {})
    if isinstance(attributes, dict):
        for name, value in attributes.items():
            if isinstance(name, str) and isinstance(value, str) and name.strip() and value.strip():
                candidates.append(FacetCandidate("attribute", name.strip()[:120], value.strip()[:4000]))
    unique: dict[tuple[str, str], FacetCandidate] = {}
    for candidate in candidates:
        unique[(candidate.facet_type, candidate.name.casefold())] = candidate
    return list(unique.values())


async def extract_facets(note: Note) -> list[FacetCandidate]:
    if not (note.title.strip() or note.body.strip()):
        return []
    prompt = f"""Extract searchable facets from this note. Return JSON with keys keywords, people,
places, dates (arrays of strings), and attributes (an object mapping key to value). Only include
information actually present; do not invent facts or assert canonical identities.
---
{note.title}
{note.body[:8000]}"""
    response = await _generate_content(
        model=settings.ai_chat_model,
        prompt=prompt,
    )
    try:
        parts = response["candidates"][0]["content"]["parts"]
        text = next(part["text"] for part in parts if isinstance(part.get("text"), str))
        payload = json.loads(text)
    except (KeyError, IndexError, StopIteration, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Gemini returned invalid note facets.") from exc
    if not isinstance(payload, dict):
        raise ValueError("Gemini note facets must be a JSON object.")
    return parse_facet_candidates(payload)


async def extract_and_store_facets(db: AsyncSession, note: Note) -> None:
    candidates = await extract_facets(note)
    result = await db.execute(select(NoteFacet).where(NoteFacet.note_id == note.id))
    existing = list(result.scalars().all())
    by_key = {(facet.facet_type, facet.name.casefold()): facet for facet in existing}
    for candidate in candidates:
        key = (candidate.facet_type, candidate.name.casefold())
        facet = by_key.get(key)
        if facet and facet.user_edited:
            continue
        if facet:
            facet.value = candidate.value
            facet.source = "ai"
        else:
            facet = NoteFacet(
                note_id=note.id,
                user_id=note.user_id,
                facet_type=candidate.facet_type,
                name=candidate.name,
                value=candidate.value,
                source="ai",
                user_edited=False,
            )
            db.add(facet)
    current_auto_keys = {(candidate.facet_type, candidate.name.casefold()) for candidate in candidates}
    for facet in existing:
        if not facet.user_edited and facet.source == "ai" and (facet.facet_type, facet.name.casefold()) not in current_auto_keys:
            await db.delete(facet)
    await db.flush()
    facets_result = await db.execute(select(NoteFacet).where(NoteFacet.note_id == note.id))
    facets = list(facets_result.scalars().all())
    if not facets:
        await asyncio.to_thread(delete_facet_vectors, str(note.id))
        return
    facet_texts = [f"{facet.name}: {facet.value}" for facet in facets]
    vectors = await embed_documents(facet_texts)
    points = [
        {
            "id": str(uuid.uuid5(_FACET_NAMESPACE, str(facet.id))),
            "vector": vector,
            "payload": {
                "note_id": str(note.id),
                "facet_id": str(facet.id),
                "user_id": note.user_id,
                "facet_type": facet.facet_type,
                "name": facet.name,
                "value": facet.value,
            },
        }
        for facet, vector in zip(facets, vectors, strict=True)
    ]
    await asyncio.to_thread(delete_facet_vectors, str(note.id))
    await asyncio.to_thread(upsert, "note_facets", points)
