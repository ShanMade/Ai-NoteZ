from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import uuid

from sqlalchemy import select, update
from fastapi.testclient import TestClient

from app.api.deps import rate_limit
from app.auth import current_user as legacy_current_user
from app.models import Note, Outbox
from app.schemas.common import AuthedUser
from app.main import app as legacy_app
from app.v2_main import app

TEST_USER_ID = "test-user"


def create_note(client, *, title: str, folder_path: str = "Studio / Notes") -> dict:
    response = client.post(
        "/v1/notes",
        json={"title": title, "body": "A note body.", "folder_path": folder_path},
    )
    assert response.status_code == 200
    return response.json()


def test_note_create_patch_conflict_delete_and_outbox(api_harness):
    client, sessions = api_harness
    note = create_note(client, title="Versioned note")
    note_id = note["id"]
    assert note["version"] == 1

    stale = client.patch(f"/v1/notes/{note_id}", json={"version": 7, "title": "Stale edit"})
    assert stale.status_code == 409
    assert stale.json()["current_version"] == 1
    assert stale.json()["current"]["title"] == "Versioned note"

    updated = client.patch(f"/v1/notes/{note_id}", json={"version": 1, "title": "Updated note"})
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    assert updated.json()["title"] == "Updated note"

    async def pending_events():
        async with sessions() as db:
            return list((await db.execute(select(Outbox).where(Outbox.note_id == uuid.UUID(note_id)))).scalars())

    outbox_rows = asyncio.run(pending_events())
    assert len(outbox_rows) == 1
    assert outbox_rows[0].status == "pending"
    assert outbox_rows[0].event == "upsert"

    deleted = client.delete(f"/v1/notes/{note_id}")
    assert deleted.status_code == 204
    assert client.get(f"/v1/notes/{note_id}").status_code == 404

    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    delta = client.get("/v1/sync/delta", params={"since": since})
    assert delta.status_code == 200
    deleted_item = next(item for item in delta.json()["items"] if item["id"] == note_id)
    assert deleted_item["deleted"] is True
    assert deleted_item["version"] == 3

    outbox_rows = asyncio.run(pending_events())
    assert len(outbox_rows) == 1
    assert outbox_rows[0].event == "delete"


def test_user_scoping_folder_filter_pagination_and_shared_note(api_harness):
    client, sessions = api_harness
    first = create_note(client, title="First studio note")
    create_note(client, title="Second studio note")
    outside = create_note(client, title="Library note", folder_path="Library / Books")

    async def align_note_timestamps():
        async with sessions() as db:
            await db.execute(
                update(Note)
                .where(Note.folder_path.startswith("Studio"))
                .values(updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
            )
            await db.commit()

    asyncio.run(align_note_timestamps())

    app.dependency_overrides[rate_limit] = lambda: AuthedUser(id="another-user", email="other@example.com")
    assert client.get(f"/v1/notes/{outside['id']}").status_code == 404
    app.dependency_overrides[rate_limit] = lambda: AuthedUser(id=TEST_USER_ID, email="test@example.com")
    folder_notes = client.get("/v1/notes", params={"folder": "Studio", "limit": 1})
    assert folder_notes.status_code == 200
    assert len(folder_notes.json()["items"]) == 1
    assert folder_notes.json()["next_cursor"]

    next_page = client.get(
        "/v1/notes",
        params={"folder": "Studio", "limit": 1, "cursor": folder_notes.json()["next_cursor"]},
    )
    assert next_page.status_code == 200
    assert len(next_page.json()["items"]) == 1, {
        "first_page": folder_notes.json(),
        "second_page": next_page.json(),
    }
    assert next_page.json()["items"][0]["id"] != folder_notes.json()["items"][0]["id"]

    wrong_user = client.get(f"/v1/notes/{uuid.uuid4()}")
    assert wrong_user.status_code == 404

    share = client.post(f"/v1/notes/{first['id']}/share")
    assert share.status_code == 200
    token = share.json()["shared_token"]
    public = client.get(f"/v1/notes/shared/{token}")
    assert public.status_code == 200
    assert public.json()["id"] == first["id"]
    assert "user_id" not in public.json()


def test_parent_children_orphaning_and_facet_edits(api_harness):
    client, _ = api_harness
    parent = create_note(client, title="Parent note", folder_path="Studio / Product")
    child_response = client.post(
        "/v1/notes",
        json={
            "title": "Child note",
            "body": "Child content",
            "folder_path": "Studio / Product",
            "parent_id": parent["id"],
        },
    )
    assert child_response.status_code == 200
    child = child_response.json()
    assert [item["id"] for item in client.get(f"/v1/notes/{parent['id']}/children").json()] == [child["id"]]

    facet = client.post(
        f"/v1/notes/{child['id']}/facets",
        json={"name": "project", "value": "Notez"},
    )
    assert facet.status_code == 200
    assert facet.json()["name"] == "project"
    assert facet.json()["user_edited"] is True
    assert facet.json()["facet_type"] == "attribute"

    assert client.delete(f"/v1/notes/{parent['id']}").status_code == 204
    child_after = client.get(f"/v1/notes/{child['id']}").json()
    assert child_after["parent_id"] is None
    assert child_after["folder_path"] == "Studio / Product"


def test_account_export_includes_soft_deleted_notes(api_harness):
    client, _ = api_harness
    note = create_note(client, title="Export me")
    assert client.delete(f"/v1/notes/{note['id']}").status_code == 204
    response = client.get("/v1/account/export")
    assert response.status_code == 200
    exported = next(item for item in response.json()["notes"] if item["id"] == note["id"])
    assert exported["deleted_at"] is not None


def test_v2_entrypoint_keeps_existing_ai_routes(api_harness):
    client, _ = api_harness
    legacy_app.dependency_overrides[legacy_current_user] = lambda: {"uid": TEST_USER_ID}
    try:
        response = client.get("/v1/config")
    finally:
        legacy_app.dependency_overrides.clear()
    assert response.status_code == 200
    assert "managedProviders" in response.json()
