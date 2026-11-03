from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import select

from app.api.deps import rate_limit
from app.core.config import settings
from app.models import Note, RecordingPart, RecordingSession, SessionSpeaker, TranscriptSegment
from app.schemas.common import AuthedUser
from app.services.recording import storage
from app.services.recording.transcription import DiarizedSegment
from app.v2_main import app
from app.workers import tasks_transcribe

TEST_USER_ID = "test-user"


def create_recording_note(client) -> dict:
    response = client.post(
        "/v1/notes",
        json={"title": "Classroom", "body": "", "kind": "recording"},
    )
    assert response.status_code == 200
    return response.json()


def create_session(client, note_id: str, context_prompt: str = "classroom, one teacher") -> str:
    response = client.post(
        "/v1/record/sessions",
        json={"note_id": note_id, "context_prompt": context_prompt},
    )
    assert response.status_code == 201
    return response.json()["session_id"]


def upload_part(client, session_id: str, index: int, *, is_empty: bool = False) -> dict:
    response = client.post(
        f"/v1/record/sessions/{session_id}/parts",
        data={"part_index": str(index), "is_empty": str(is_empty).lower()},
        files={"audio": (f"part-{index}.wav", b"fake audio", "audio/wav")},
    )
    return response


def test_recording_parts_are_tenant_scoped_multipart_and_empty_skips_transcription(
    api_harness, monkeypatch
):
    client, _ = api_harness
    dispatched: list[tuple[str, list[str | int]]] = []
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    monkeypatch.setattr(
        tasks_transcribe.celery_app,
        "send_task",
        lambda task, *, args: dispatched.append((task, args)),
    )
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])

    queued = upload_part(client, session_id, 0)
    assert queued.status_code == 202
    assert queued.json()["status"] == "queued"
    assert dispatched == [("transcription.transcribe_part", [session_id, 0])]
    duplicate = upload_part(client, session_id, 0)
    assert duplicate.status_code == 202
    assert duplicate.json()["part_id"] == queued.json()["part_id"]
    assert len(dispatched) == 1

    empty = upload_part(client, session_id, 1, is_empty=True)
    assert empty.status_code == 202
    assert empty.json()["status"] == "done"
    assert len(dispatched) == 1
    empty_state = client.get(f"/v1/record/sessions/{session_id}/parts/1")
    assert empty_state.status_code == 200
    assert empty_state.json()["is_empty"] is True
    assert [segment["text"] for segment in empty_state.json()["segments"]] == [""]

    app.dependency_overrides[rate_limit] = lambda: AuthedUser(id="other-user")
    try:
        assert client.get(f"/v1/record/sessions/{session_id}").status_code == 404
        assert upload_part(client, session_id, 2).status_code == 404
    finally:
        app.dependency_overrides[rate_limit] = lambda: AuthedUser(id=TEST_USER_ID)


def test_upload_size_limit_precedes_task_dispatch(api_harness, monkeypatch):
    from app.api import recording as recording_api

    client, _ = api_harness
    monkeypatch.setattr(recording_api, "_MAX_UPLOAD_BYTES", 4)
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])
    response = client.post(
        f"/v1/record/sessions/{session_id}/parts",
        data={"part_index": "0", "is_empty": "false"},
        files={"audio": ("large.wav", b"12345", "audio/wav")},
    )
    assert response.status_code == 413


def test_retry_url_is_only_available_after_three_failed_attempts(api_harness, monkeypatch):
    client, sessions = api_harness
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    monkeypatch.setattr(storage, "upload_url", lambda key: f"https://r2.invalid/{key}")
    monkeypatch.setattr(tasks_transcribe.celery_app, "send_task", lambda *_args, **_kwargs: None)
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])
    uploaded = upload_part(client, session_id, 0)
    assert uploaded.status_code == 202

    async def set_failed_part():
        async with sessions() as db:
            part = await db.get(RecordingPart, uuid.UUID(uploaded.json()["part_id"]))
            part.status = "failed"
            part.attempts = 2
            await db.commit()

    asyncio.run(set_failed_part())
    not_ready = client.get(f"/v1/record/sessions/{session_id}/parts/0/upload-url")
    assert not_ready.status_code == 409

    async def make_retry_available():
        async with sessions() as db:
            part = await db.get(RecordingPart, uuid.UUID(uploaded.json()["part_id"]))
            part.attempts = 3
            await db.commit()

    asyncio.run(make_retry_available())
    signed_url = client.get(f"/v1/record/sessions/{session_id}/parts/0/upload-url")
    assert signed_url.status_code == 200
    assert signed_url.json()["upload_url"].startswith("https://r2.invalid/")


def test_speaker_identity_persists_across_parts_and_finish_updates_note(
    api_harness, monkeypatch
):
    client, sessions = api_harness
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    monkeypatch.setattr(tasks_transcribe.storage, "read_audio", lambda _key: b"fake audio")
    monkeypatch.setattr(tasks_transcribe.celery_app, "send_task", lambda *_args, **_kwargs: None)
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])
    for index in range(2):
        assert upload_part(client, session_id, index).status_code == 202

    monkeypatch.setattr(
        tasks_transcribe,
        "transcribe_audio",
        lambda *_args, **_kwargs: asyncio.sleep(
            0,
            result=[
                DiarizedSegment(
                    label="Sir Bilal",
                    text="We will examine the force and the motion.",
                    start_ms=100,
                    end_ms=1700,
                )
            ],
        ),
    )
    monkeypatch.setattr(
        tasks_transcribe,
        "classify_speaker_roles",
        lambda *_args, **_kwargs: asyncio.sleep(0, result={"Sir Bilal": "teacher"}),
    )
    monkeypatch.setattr(tasks_transcribe, "AsyncSessionLocal", sessions)
    asyncio.run(tasks_transcribe.process_part(session_id, 0))
    asyncio.run(tasks_transcribe.process_part(session_id, 1))

    async def read_resolved_segments():
        async with sessions() as db:
            return list(
                (
                    await db.execute(
                        select(TranscriptSegment, SessionSpeaker)
                        .join(SessionSpeaker, TranscriptSegment.speaker_id == SessionSpeaker.id)
                        .where(TranscriptSegment.session_id == uuid.UUID(session_id))
                        .order_by(TranscriptSegment.part_index)
                    )
                ).all()
            )

    resolved = asyncio.run(read_resolved_segments())
    assert len(resolved) == 2
    assert resolved[0][0].speaker_id == resolved[1][0].speaker_id
    assert all(speaker.display_name == "Sir Bilal" for _, speaker in resolved)
    assert all(speaker.role == "teacher" for _, speaker in resolved)

    speaker_id = str(resolved[0][0].speaker_id)
    rename = client.patch(
        f"/v1/record/sessions/{session_id}/speakers/{speaker_id}",
        json={"display_name": "Bilal", "role": "instructor"},
    )
    assert rename.status_code == 200
    assert rename.json()["user_confirmed"] is True
    assert upload_part(client, session_id, 2).status_code == 202
    asyncio.run(tasks_transcribe.process_part(session_id, 2))
    segment = client.get(f"/v1/record/sessions/{session_id}/parts/2").json()["segments"][0]
    assert segment["display_name"] == "Bilal"
    assert segment["role"] == "instructor"

    finish = client.post(
        f"/v1/record/sessions/{session_id}/finish",
        json={"expected_part_count": 3},
    )
    assert finish.status_code == 200
    assert finish.json()["status"] == "done"
    response = client.get(f"/v1/notes/{note['id']}")
    assert response.json()["body"].count("Bilal (instructor):") == 3


def test_dispatch_failure_is_recoverable_by_reupload(api_harness, monkeypatch):
    """Regression: a 503 from the transcription broker must not strand a part.

    Previously the part row was committed, dispatch failed with 503, and
    every re-upload returned the existing failed part without storing the
    audio or dispatching again — the UI's retries could never succeed.
    """
    client, sessions = api_harness
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)

    def failing_send_task(*_args, **_kwargs):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(tasks_transcribe.celery_app, "send_task", failing_send_task)
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])

    failed_upload = upload_part(client, session_id, 0)
    assert failed_upload.status_code == 503
    state = client.get(f"/v1/record/sessions/{session_id}/parts/0")
    assert state.status_code == 200
    assert state.json()["status"] == "failed"

    dispatched: list[tuple[str, list[str | int]]] = []
    monkeypatch.setattr(
        tasks_transcribe.celery_app,
        "send_task",
        lambda task, *, args: dispatched.append((task, args)),
    )
    retried = upload_part(client, session_id, 0)
    assert retried.status_code == 202
    assert retried.json()["status"] == "queued"
    assert dispatched == [("transcription.transcribe_part", [session_id, 0])]
    state = client.get(f"/v1/record/sessions/{session_id}/parts/0")
    assert state.json()["status"] == "queued"
    assert state.json()["attempts"] == 0

    async def part_rows():
        async with sessions() as db:
            rows = await db.execute(
                select(RecordingPart).where(RecordingPart.session_id == uuid.UUID(session_id))
            )
            return list(rows.scalars().all())

    # The re-upload replaced the failed row instead of creating a second part.
    rows = asyncio.run(part_rows())
    assert len(rows) == 1
    assert str(rows[0].id) == retried.json()["part_id"]


def test_failed_part_can_be_reuploaded_after_session_has_failed_parts(api_harness, monkeypatch):
    client, sessions = api_harness
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    dispatched: list[tuple[str, list[str | int]]] = []
    monkeypatch.setattr(
        tasks_transcribe.celery_app,
        "send_task",
        lambda task, *, args: dispatched.append((task, args)),
    )
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])
    uploaded = upload_part(client, session_id, 0)
    assert uploaded.status_code == 202

    async def mark_failed():
        async with sessions() as db:
            part = await db.get(RecordingPart, uuid.UUID(uploaded.json()["part_id"]))
            part.status = "failed"
            part.attempts = 1
            part.error_code = "RuntimeError"
            await db.commit()

    asyncio.run(mark_failed())
    finish = client.post(
        f"/v1/record/sessions/{session_id}/finish",
        json={"expected_part_count": 1},
    )
    assert finish.status_code == 200
    assert finish.json()["status"] == "has_failed_parts"

    # Manual retry re-uploads the audio; a finished-with-failures session
    # must accept the replacement for its failed part (and only those).
    retried = upload_part(client, session_id, 0)
    assert retried.status_code == 202
    assert retried.json()["status"] == "queued"
    assert len(dispatched) == 2
    session_state = client.get(f"/v1/record/sessions/{session_id}")
    assert session_state.json()["status"] == "processing"
    rejected = upload_part(client, session_id, 1)
    assert rejected.status_code == 409


def test_retry_endpoint_redispatches_stuck_queued_part(api_harness, monkeypatch):
    client, _ = api_harness
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    dispatched: list[tuple[str, list[str | int]]] = []
    monkeypatch.setattr(
        tasks_transcribe.celery_app,
        "send_task",
        lambda task, *, args: dispatched.append((task, args)),
    )
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])
    assert upload_part(client, session_id, 0).status_code == 202
    # The part is still "queued" (its dispatch was lost). Retrying it used
    # to return 409 because only "failed" parts could be retried.
    retry = client.post(f"/v1/record/sessions/{session_id}/parts/0/retry")
    assert retry.status_code == 200
    assert retry.json()["status"] == "queued"
    assert len(dispatched) == 2


def test_upload_url_strips_r2_uri_prefix(monkeypatch):
    captured: dict = {}

    class FakeS3Client:
        def generate_presigned_url(self, operation, *, Params, ExpiresIn):
            captured.update(operation=operation, params=Params, expires=ExpiresIn)
            return "https://r2.invalid/signed"

    monkeypatch.setattr(storage, "_s3_client", lambda: FakeS3Client())
    monkeypatch.setattr(storage.settings, "r2_bucket", "notez-audio")
    url = storage.upload_url("r2://notez-audio/recordings/session/0.audio")
    assert url == "https://r2.invalid/signed"
    assert captured["params"] == {
        "Bucket": "notez-audio",
        "Key": "recordings/session/0.audio",
        "ContentType": "audio/wav",
    }


def test_finishing_waits_for_expected_offline_parts(api_harness, monkeypatch):
    client, _ = api_harness
    monkeypatch.setattr(storage, "store_audio", lambda key, _audio, _mime: key)
    monkeypatch.setattr(tasks_transcribe.celery_app, "send_task", lambda *_args, **_kwargs: None)
    note = create_recording_note(client)
    session_id = create_session(client, note["id"])
    finish = client.post(
        f"/v1/record/sessions/{session_id}/finish",
        json={"expected_part_count": 1},
    )
    assert finish.status_code == 200
    assert finish.json()["status"] == "processing"
    assert upload_part(client, session_id, 0).status_code == 202
