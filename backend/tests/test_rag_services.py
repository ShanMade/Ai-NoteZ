from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.models import Note, NoteFacet, Outbox
from app.services.rag import embeddings, facet_extraction, qdrant_client, retrieval
from app.services.rag.chunking import chunk_text, has_indexable_content
from app.services.rag.facet_extraction import FacetCandidate
from app.services.rag.query_classify import classify, is_vague_followup
from app.workers import tasks_index
from scripts import rebuild_index

TEST_USER_ID = "test-user"


def test_chunker_preserves_code_fences_tables_and_cleans_html():
    body = """<h2>A note with <strong>useful</strong> content.</h2>

| Name | Role |
| --- | --- |
| A | Teacher |

```python
print("inside code")
print("<tag>")
```

The identifier `embedding_model` stays intact."""
    chunks = chunk_text(body, "My note")
    combined = "\n".join(chunk.text for chunk in chunks)
    assert "useful" in combined
    assert "<strong>" not in combined
    assert "##" not in combined
    assert "embedding_model" in combined
    assert "| Name | Role |" in combined
    assert '```python\nprint("inside code")\nprint("<tag>")\n```' in combined
    assert 'print("<tag>")' in combined
    assert not chunk_text("<script>hidden</script>", "")
    assert not has_indexable_content("<style>hidden</style>", "")


def test_chunker_keeps_chunks_bounded_and_overlaps_long_prose():
    body = " ".join(f"concept{index:04d}" for index in range(650))
    chunks = chunk_text(body, size=800)
    assert len(chunks) >= 3
    assert all(len(chunk.text) <= 800 for chunk in chunks)
    first_words = chunks[0].text.split()
    second_words = chunks[1].text.split()
    assert len(set(first_words[-20:]) & set(second_words[:20])) >= 10


def test_query_classification_keeps_single_subject_and_resolves_followups():
    history = [{"role": "user", "content": "What did I write about biology?"}]
    assert not is_vague_followup("biology", history)
    assert is_vague_followup("summarize", history)
    plan = classify("summarize", None, history)
    assert plan.resolved_query == "Follow-up to the user's earlier question, “What did I write about biology?”: summarize"
    assert classify("How many notes do I have?", None, []).operation == "count"
    scoped = classify("anything", uuid.uuid4(), history)
    assert scoped.scope == "note"


def test_embeddings_use_asymmetric_gemini_task_types(monkeypatch):
    task_types: list[str] = []

    async def fake_batch(texts, task_type):
        task_types.append(task_type)
        return [[0.1] * 768 for _ in texts]

    monkeypatch.setattr(embeddings, "_embed_batch", fake_batch)
    asyncio.run(embeddings.embed_documents(["document"]))
    asyncio.run(embeddings.embed_query("question"))
    assert task_types == ["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


def test_embedding_retries_429_with_same_model_and_task_type(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, status_code):
            self.status_code = status_code
            self.headers = {"Retry-After": "0"}
            self.is_success = status_code == 200

        def json(self):
            return {"embeddings": [{"values": [0.25] * 768}]}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, params, json):
            calls.append((url, params, json))
            return FakeResponse(429 if len(calls) == 1 else 200)

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(embeddings, "_api_key", lambda: "test-key")
    monkeypatch.setattr(embeddings.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(embeddings.asyncio, "sleep", no_wait)
    vector = asyncio.run(embeddings._embed_batch(["note"], "RETRIEVAL_DOCUMENT"))
    assert len(calls) == 2
    assert all("gemini-embedding-001:batchEmbedContents" in call[0] for call in calls)
    assert all(call[2]["requests"][0]["taskType"] == "RETRIEVAL_DOCUMENT" for call in calls)
    assert len(vector[0]) == 768


def test_qdrant_search_requires_and_applies_tenant_filter(monkeypatch):
    calls = []

    class FakeClient:
        def query_points(self, **kwargs):
            calls.append(kwargs)
            return type("Response", (), {"points": []})()

    monkeypatch.setattr(qdrant_client, "_get_client", lambda: FakeClient())
    qdrant_client.search("note_chunks", [0.0] * 768, user_id=TEST_USER_ID, limit=8)
    conditions = calls[0]["query_filter"].must
    assert any(
        condition.key == "user_id" and condition.match.value == TEST_USER_ID
        for condition in conditions
    )
    assert inspect.signature(qdrant_client.search).parameters["user_id"].default is inspect.Parameter.empty


def test_retrieval_passes_authenticated_user_to_qdrant_search(api_harness, monkeypatch):
    _, sessions = api_harness
    note = Note(user_id=TEST_USER_ID, title="Biology", body="Cells carry genetic information.")

    async def seed():
        async with sessions() as db:
            db.add(note)
            await db.commit()
            return note.id

    note_id = asyncio.run(seed())
    observed: list[str] = []
    monkeypatch.setattr(retrieval, "embed_query", lambda _query: asyncio.sleep(0, result=[0.0] * 768))

    def fake_search(_collection, _vector, *, user_id, limit):
        observed.append(user_id)
        return [{
            "id": "point",
            "score": 0.9,
            "payload": {
                "note_id": str(note_id),
                "chunk_index": 0,
                "version": 1,
                "text": "Cells carry genetic information.",
            },
        }]

    monkeypatch.setattr(retrieval, "qdrant_search", fake_search)

    async def run():
        async with sessions() as db:
            return await retrieval.retrieve(db, TEST_USER_ID, classify("biology", None, []))

    result = asyncio.run(run())
    assert observed == [TEST_USER_ID]
    assert result.confident
    assert result.excerpts[0].note_id == note_id


def test_facet_reextraction_preserves_user_values_and_updates_ai_values(api_harness, monkeypatch):
    _, sessions = api_harness

    async def run():
        async with sessions() as db:
            note = Note(user_id=TEST_USER_ID, title="Trip", body="Old place")
            db.add(note)
            await db.flush()
            edited = NoteFacet(
                note_id=note.id,
                user_id=TEST_USER_ID,
                facet_type="attribute",
                name="destination",
                value="Chosen by me",
                source="user",
                user_edited=True,
            )
            generated = NoteFacet(
                note_id=note.id,
                user_id=TEST_USER_ID,
                facet_type="place",
                name="Harbor",
                value="Old place",
                source="ai",
                user_edited=False,
            )
            db.add_all([edited, generated])
            await db.commit()

            async def candidates(_note):
                return [
                    FacetCandidate("attribute", "destination", "Model suggestion"),
                    FacetCandidate("place", "Harbor", "New place"),
                ]

            async def fake_embed(texts):
                return [[0.1] * 768 for _ in texts]

            monkeypatch.setattr(facet_extraction, "extract_facets", candidates)
            monkeypatch.setattr(facet_extraction, "embed_documents", fake_embed)
            monkeypatch.setattr(facet_extraction, "delete_facet_vectors", lambda *_args: None)
            monkeypatch.setattr(facet_extraction, "upsert", lambda *_args: None)
            await facet_extraction.extract_and_store_facets(db, note)
            await db.commit()
            rows = await db.execute(select(NoteFacet).where(NoteFacet.note_id == note.id))
            return {(facet.name, facet.value, facet.user_edited) for facet in rows.scalars()}

    values = asyncio.run(run())
    assert ("destination", "Chosen by me", True) in values
    assert ("Harbor", "New place", False) in values


def test_index_task_upserts_deterministic_points_and_marks_outbox_done(api_harness, monkeypatch):
    _, sessions = api_harness
    note_id = uuid.uuid4()
    point_batches = []

    async def seed():
        async with sessions() as db:
            note = Note(id=note_id, user_id=TEST_USER_ID, title="Biology", body="A cell contains a nucleus.")
            db.add(note)
            await db.flush()
            db.add(Outbox(note_id=note.id, event="upsert", status="processing"))
            await db.commit()

    asyncio.run(seed())
    monkeypatch.setattr(tasks_index, "AsyncSessionLocal", sessions)

    async def fake_embed(texts):
        return [[0.2] * 768 for _ in texts]

    async def fake_facets(_db, _note):
        return None

    monkeypatch.setattr(tasks_index, "embed_documents", fake_embed)
    monkeypatch.setattr(tasks_index, "extract_and_store_facets", fake_facets)
    monkeypatch.setattr(tasks_index, "upsert", lambda collection, points: point_batches.append((collection, points)))
    monkeypatch.setattr(tasks_index, "delete_stale_chunks", lambda *_args: None)
    observed_deletes = []
    monkeypatch.setattr(tasks_index, "delete_note_vectors", lambda note: observed_deletes.append(note))

    asyncio.run(tasks_index._index_note(str(note_id)))
    assert point_batches[0][0] == "note_chunks"
    point = point_batches[0][1][0]
    assert point["id"] == tasks_index.stable_point_id(note_id, 0)
    assert point["payload"]["user_id"] == TEST_USER_ID
    assert point["payload"]["text"]
    asyncio.run(tasks_index._index_note(str(note_id)))
    assert point_batches[1][1][0]["id"] == point["id"]

    async def read_outbox():
        async with sessions() as db:
            result = await db.scalar(select(Outbox).where(Outbox.note_id == note_id))
            return result.status

    assert asyncio.run(read_outbox()) == "done"
    assert observed_deletes == []


def test_rebuild_script_ensures_collections_and_queues_only_live_notes(api_harness, monkeypatch):
    _, sessions = api_harness
    live_id = uuid.uuid4()
    deleted_id = uuid.uuid4()

    async def seed():
        async with sessions() as db:
            db.add_all(
                [
                    Note(id=live_id, user_id=TEST_USER_ID, title="Live"),
                    Note(
                        id=deleted_id,
                        user_id=TEST_USER_ID,
                        title="Deleted",
                        deleted_at=datetime.now(timezone.utc),
                    ),
                ]
            )
            await db.commit()

    asyncio.run(seed())
    ensured = []
    queued = []
    point_batches = []

    async def fake_embed(texts):
        return [[0.3] * 768 for _ in texts]

    async def fake_facets(_db, _note):
        return None

    monkeypatch.setattr(tasks_index, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(tasks_index, "embed_documents", fake_embed)
    monkeypatch.setattr(tasks_index, "extract_and_store_facets", fake_facets)
    monkeypatch.setattr(tasks_index, "upsert", lambda collection, points: point_batches.append((collection, points)))
    monkeypatch.setattr(tasks_index, "delete_stale_chunks", lambda *_args: None)
    asyncio.run(tasks_index._index_note(str(live_id)))
    original_point = point_batches[0][1][0]
    point_batches.clear()

    monkeypatch.setattr(rebuild_index, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(rebuild_index, "ensure_collections", lambda: ensured.append(True))
    monkeypatch.setattr(rebuild_index.index_note, "delay", lambda note_id: queued.append(note_id))
    assert asyncio.run(rebuild_index.enqueue_rebuild()) == 1
    assert ensured == [True]
    assert queued == [str(live_id)]
    asyncio.run(tasks_index._index_note(queued[0]))
    rebuilt_point = point_batches[0][1][0]
    assert rebuilt_point["id"] == original_point["id"]
    assert rebuilt_point["payload"]["text"] == original_point["payload"]["text"]


def test_deleting_vectors_covers_chunks_and_facets(monkeypatch):
    calls = []

    class FakeClient:
        def delete(self, **kwargs):
            calls.append(kwargs["collection_name"])

    monkeypatch.setattr(qdrant_client, "_get_client", lambda: FakeClient())
    qdrant_client.delete_note_vectors(str(uuid.uuid4()))
    assert calls == ["note_chunks", "note_facets"]
