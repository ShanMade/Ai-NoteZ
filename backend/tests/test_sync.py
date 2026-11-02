from __future__ import annotations

import uuid


def create_note(client, title: str) -> dict:
    response = client.post("/v1/notes", json={"title": title, "body": title})
    assert response.status_code == 200
    return response.json()


def test_batch_commits_each_operation_and_reports_conflicts(api_harness):
    client, _ = api_harness
    stale_note = create_note(client, "Stale note")
    target_note = create_note(client, "Target note")
    assert client.patch(
        f"/v1/notes/{stale_note['id']}",
        json={"version": 1, "title": "Current note"},
    ).status_code == 200

    response = client.post(
        "/v1/sync/batch",
        json={
            "ops": [
                {
                    "op": "create",
                    "client_id": "created-first",
                    "fields": {"title": "Offline create", "body": "created"},
                },
                {
                    "op": "patch",
                    "client_id": "stale-second",
                    "note_id": stale_note["id"],
                    "version": 1,
                    "fields": {"title": "Stale overwrite"},
                },
                {
                    "op": "patch",
                    "client_id": "updated-third",
                    "note_id": target_note["id"],
                    "version": 1,
                    "fields": {"title": "Third operation succeeds"},
                },
            ]
        },
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert [result["status"] for result in results] == ["ok", "conflict", "ok"]
    assert results[1]["current_version"] == 2
    assert results[0]["note"]["title"] == "Offline create"
    assert results[2]["note"]["version"] == 2
    assert client.get(f"/v1/notes/{target_note['id']}").json()["title"] == "Third operation succeeds"


def test_batch_reports_missing_records_and_invalid_cursors(api_harness):
    client, _ = api_harness
    missing = client.post(
        "/v1/sync/batch",
        json={
            "ops": [
                {
                    "op": "delete",
                    "client_id": "missing",
                    "note_id": str(uuid.uuid4()),
                    "version": 1,
                }
            ]
        },
    )
    assert missing.status_code == 200
    assert missing.json()["results"] == [{"client_id": "missing", "status": "not_found", "note": None, "current_version": None}]
    assert client.get("/v1/notes", params={"cursor": "not-a-cursor"}).status_code == 422
