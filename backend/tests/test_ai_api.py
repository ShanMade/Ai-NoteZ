from __future__ import annotations

import asyncio
import json
import uuid

from sqlalchemy import select

from app.api import ai as ai_api
from app.models import ChatHistory, Note
from app.services.rag import retrieval
from app.services.rag.query_classify import classify
from app.services.rag.retrieval import Excerpt, RetrievalResult

TEST_USER_ID = "test-user"


def _sse_payload(text: str, event: str) -> dict:
    for frame in text.split("\n\n"):
        if f"event: {event}\n" in frame:
            data = next(line[6:] for line in frame.splitlines() if line.startswith("data: "))
            return json.loads(data)
    raise AssertionError(f"Missing SSE event {event!r}: {text}")


def test_weak_match_streams_clarification_without_calling_gemini(api_harness, monkeypatch):
    client, sessions = api_harness
    calls = []

    async def no_match(*_args, **_kwargs):
        return RetrievalResult([], False)

    async def unexpected_generation(**_kwargs):
        calls.append("called")
        yield "should not appear"

    monkeypatch.setattr(ai_api, "retrieve", no_match)
    monkeypatch.setattr(ai_api, "stream_answer", unexpected_generation)
    response = client.post("/v1/ai/chat", json={"question": "What did I decide?"})
    assert response.status_code == 200
    assert _sse_payload(response.text, "clarification")["text"]
    assert _sse_payload(response.text, "done")["is_clarification"] is True
    assert calls == []
    conversation_id = uuid.UUID(_sse_payload(response.text, "meta")["conversation_id"])

    async def history():
        async with sessions() as db:
            return list(
                (
                    await db.execute(
                        select(ChatHistory)
                        .where(ChatHistory.conversation_id == conversation_id)
                        .order_by(ChatHistory.message_index)
                    )
                ).scalars()
            )

    messages = asyncio.run(history())
    assert [(message.role, message.is_clarification) for message in messages] == [
        ("user", False),
        ("assistant", True),
    ]


def test_note_scoped_chat_never_calls_qdrant(api_harness, monkeypatch):
    client, _ = api_harness
    created = client.post("/v1/notes", json={"title": "Biology", "body": "Cells contain a nucleus."}).json()

    def forbidden(*_args, **_kwargs):
        raise AssertionError("note-scoped retrieval must not access Qdrant")

    async def answer(**_kwargs):
        yield "A cell has a nucleus. [1]"

    monkeypatch.setattr(retrieval, "qdrant_search", forbidden)
    monkeypatch.setattr(ai_api, "stream_answer", answer)
    response = client.post(
        "/v1/ai/chat",
        json={"question": "What is inside a cell?", "note_id": created["id"]},
    )
    assert response.status_code == 200
    assert "A cell has a nucleus." in response.text
    citations = _sse_payload(response.text, "sources")["citations"]
    assert citations == [{"note_id": created["id"], "title": "Biology"}]


def test_count_question_uses_exact_database_count_over_200_notes(api_harness):
    client, sessions = api_harness

    async def seed_notes():
        async with sessions() as db:
            db.add_all(
                [
                    Note(user_id=TEST_USER_ID, title=f"Seed {index}", body=f"Body {index}")
                    for index in range(207)
                ]
            )
            await db.commit()

    asyncio.run(seed_notes())
    response = client.post("/v1/ai/chat", json={"question": "How many notes do I have?"})
    assert response.status_code == 200
    assert "You have 207 notes." in response.text
    assert "event: done" in response.text


def test_chat_history_is_user_scoped_and_answer_can_be_saved(api_harness, monkeypatch):
    client, _ = api_harness

    async def confident_result(_db, _user_id, _plan):
        return RetrievalResult(
            [Excerpt(uuid.uuid4(), "Grounded note", "Evidence from notes.", 0.9, 1)],
            True,
        )

    async def answer(**_kwargs):
        yield "A grounded answer. [1]"

    monkeypatch.setattr(ai_api, "retrieve", confident_result)
    monkeypatch.setattr(ai_api, "stream_answer", answer)
    response = client.post("/v1/ai/chat", json={"question": "What is in my notes?"})
    conversation_id = _sse_payload(response.text, "meta")["conversation_id"]
    done = _sse_payload(response.text, "done")
    history = client.get(f"/v1/ai/chat/{conversation_id}/history")
    assert history.status_code == 200
    assert [message["role"] for message in history.json()["messages"]] == ["user", "assistant"]

    saved = client.post(
        "/v1/ai/note-from-answer",
        json={"conversation_id": conversation_id, "message_index": done["message_index"]},
    )
    assert saved.status_code == 201
    assert saved.json()["body"] == "A grounded answer. [1]"
