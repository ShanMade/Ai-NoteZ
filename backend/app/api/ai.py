from __future__ import annotations

import json
import logging
import re
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import get_db
from ..core.errors import NoteNotFound
from ..models import ChatHistory, Note
from ..repositories.notes import create_note
from ..schemas.chat import (
    ChatHistoryRead,
    ChatMessageRead,
    ChatRequest,
    ChatSearchRead,
    ChatSearchRequest,
    NoteFromAnswerRequest,
    SearchExcerptRead,
)
from ..schemas.note import NoteRead
from ..services.rag.chat_generation import stream_answer
from ..services.rag.query_classify import classify
from ..services.rag.retrieval import Excerpt, retrieve
from .deps import RateLimitedUser

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/ai", tags=["ai"])


def _event(name: str, payload: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _next_message_index(db: AsyncSession, conversation_id: uuid.UUID) -> int:
    current = await db.scalar(
        select(func.max(ChatHistory.message_index)).where(ChatHistory.conversation_id == conversation_id)
    )
    return (current if current is not None else -1) + 1


def _citation_payload(excerpts: list[Excerpt]) -> list[dict[str, str]]:
    return [
        {"note_id": str(excerpt.note_id), "title": excerpt.title or "Untitled note"}
        for excerpt in excerpts
    ]


@router.post("/chat")
async def chat(
    payload: ChatRequest,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question must not be blank.")
    conversation_id = payload.conversation_id or uuid.uuid4()
    rows = await db.execute(
        select(ChatHistory)
        .where(ChatHistory.user_id == user.id, ChatHistory.conversation_id == conversation_id)
        .order_by(ChatHistory.message_index)
    )
    previous_rows = list(rows.scalars().all())
    if payload.conversation_id and not previous_rows:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    history = [{"role": row.role, "content": row.content} for row in previous_rows]
    plan = classify(question, payload.note_id, history)
    result = await retrieve(db, user.id, plan)
    message_index = await _next_message_index(db, conversation_id)
    db.add(
        ChatHistory(
            user_id=user.id,
            conversation_id=conversation_id,
            message_index=message_index,
            role="user",
            content=question,
            note_id=payload.note_id,
        )
    )
    await db.commit()
    citations = _citation_payload(result.excerpts)

    async def stream() -> AsyncIterator[str]:
        yield _event("meta", {"conversation_id": str(conversation_id)})
        if result.direct_answer is not None:
            answer = result.direct_answer
            yield _event("sources", {"citations": citations})
            yield _event("token", {"text": answer})
            clarification = False
        elif not result.confident:
            answer = (
                "I couldn't find a strong match in your notes. Which note or topic should I look at?"
            )
            yield _event("clarification", {"text": answer})
            clarification = True
        else:
            yield _event("sources", {"citations": citations})
            excerpts = [
                {"title": excerpt.title or "Untitled note", "text": excerpt.text}
                for excerpt in result.excerpts
            ]
            answer_parts: list[str] = []
            try:
                async for part in stream_answer(question=plan.resolved_query, excerpts=excerpts, history=history):
                    answer_parts.append(part)
                    yield _event("token", {"text": part})
            except Exception as exc:
                logger.exception("Grounded chat stream failed for conversation %s.", conversation_id)
                yield _event("error", {"message": str(exc) if isinstance(exc, RuntimeError) else "The answer stream failed."})
                return
            answer = "".join(answer_parts).strip()
            if not answer:
                yield _event("error", {"message": "The AI provider returned an empty answer."})
                return
            clarification = False

        assistant_index = await _next_message_index(db, conversation_id)
        db.add(
            ChatHistory(
                user_id=user.id,
                conversation_id=conversation_id,
                message_index=assistant_index,
                role="assistant",
                content=answer,
                note_id=payload.note_id,
                citations=citations if not clarification else [],
                is_clarification=clarification,
            )
        )
        await db.commit()
        yield _event(
            "done",
            {
                "conversation_id": str(conversation_id),
                "message_index": assistant_index,
                "citations": citations if not clarification else [],
                "is_clarification": clarification,
            },
        )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.get("/chat/{conversation_id}/history", response_model=ChatHistoryRead)
async def chat_history(
    conversation_id: uuid.UUID,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> ChatHistoryRead:
    rows = await db.execute(
        select(ChatHistory)
        .where(ChatHistory.user_id == user.id, ChatHistory.conversation_id == conversation_id)
        .order_by(ChatHistory.message_index)
    )
    messages = list(rows.scalars().all())
    if not messages:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return ChatHistoryRead(
        conversation_id=conversation_id,
        messages=[ChatMessageRead.model_validate(message) for message in messages],
    )


@router.post("/search", response_model=ChatSearchRead)
async def semantic_search(
    payload: ChatSearchRequest,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> ChatSearchRead:
    plan = classify(payload.query, None, [])
    result = await retrieve(db, user.id, plan)
    return ChatSearchRead(
        confident=result.confident,
        excerpts=[
            SearchExcerptRead(note_id=item.note_id, title=item.title, text=item.text, score=item.score)
            for item in result.excerpts[: payload.limit]
        ],
    )


@router.post("/note-from-answer", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
async def note_from_answer(
    payload: NoteFromAnswerRequest,
    user: RateLimitedUser,
    db: AsyncSession = Depends(get_db),
) -> Note:
    answer = await db.scalar(
        select(ChatHistory).where(
            ChatHistory.user_id == user.id,
            ChatHistory.conversation_id == payload.conversation_id,
            ChatHistory.message_index == payload.message_index,
            ChatHistory.role == "assistant",
        )
    )
    if answer is None:
        raise NoteNotFound()
    title = next((line.strip("# ").strip() for line in answer.content.splitlines() if line.strip()), "Note from AI")
    title = re.sub(r"\s+", " ", title)[:500] or "Note from AI"
    note = await create_note(
        db,
        user_id=user.id,
        fields={
            "title": title,
            "body": answer.content,
            "kind": "note",
            "folder_path": payload.folder_path,
            "parent_id": None,
            "note_type": None,
        },
    )
    await db.commit()
    return note
