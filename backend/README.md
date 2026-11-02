# Notez API foundation

The v2 API foundation lives alongside the existing v1 AI endpoints while the rebuild is in
progress. The FastAPI Cloud entry point is `app.v2_main:app`; it mounts the earlier
`app.main:app` as a fallback so its existing AI endpoints remain available until their migration
is complete.

## Local setup

Use Python 3.12, PostgreSQL, and Redis. Copy `.env.example` to `.env`, then supply a real Firebase
service-account JSON value for authenticated local use. Never commit `.env` or service-account
credentials.

```powershell
Set-Location .\backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\uvicorn.exe app.v2_main:app --reload
```

The API uses Postgres as its source of truth and Redis for shared rate limits and Celery. Apply
migrations explicitly before deploying; the application checks migration state at startup but
does not modify the schema automatically. Celery workers should load
`app.core.celery_app:celery_app`; Celery Beat runs the outbox dispatcher every two seconds.

## API contract

- `GET/POST /v1/notes`, `GET/PATCH/DELETE /v1/notes/{id}`
- `GET /v1/notes/{id}/children`, `POST /v1/notes/{id}/share`,
  `POST /v1/notes/{id}/facets`
- Public read-only `GET /v1/notes/shared/{token}`
- `GET /v1/sync/delta?since=...`, ordered `POST /v1/sync/batch`
- `GET /v1/account/export`
- Recording sessions and multipart transcription under `/v1/record/sessions`
- Grounded AI chat, history, semantic search, and save-answer endpoints under `/v1/ai`
- `GET /healthz`

Note content updates use an integer `version`; stale patches return `409` with the current
version and note. Writes and their indexing outbox events share one database transaction.

## Recording and transcription

Create a note with `kind="recording"`, create a session for that note, upload numbered audio
parts, then finish with the expected part count. The session endpoint reports `processing` until
all expected uploads and transcription jobs complete. Poll the session and part endpoints for
transcripts and speaker identities; speaker edits are retained against later automatic
classification.

The browser keeps committed audio slices in IndexedDB and uploads completed parts for
transcription. The worker uses `GEMINI_API_KEY` (or the existing `AI_GEMINI_API_KEY` setting)
and `GEMINI_TRANSCRIPTION_MODEL`; `MAX_PART_SIZE_MB` bounds uploads. Audio is stored locally
under `RECORDING_AUDIO_DIR` unless all four `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` values are configured. Local audio storage must be on
persistent storage when running workers separately; configure R2 for shared storage and
replacement-upload retries across instances.

## AI indexing and chat

The indexing worker keeps `note_chunks` and `note_facets` in Qdrant synchronized through the
Postgres outbox. Configure `GEMINI_API_KEY` (or `AI_GEMINI_API_KEY`), `QDRANT_URL`, and an optional
`QDRANT_API_KEY`; document and query embeddings use the same 768-dimensional Gemini model with
their respective retrieval task types. `AI_RAG_MIN_CONFIDENCE` defaults to `0.65`. The Qdrant
collections are created idempotently when an indexing worker starts.

Run the indexing and outbox workers from `backend` with
`celery -A app.core.celery_app:celery_app worker -Q default,indexing,transcription`. Run Beat
separately for outbox dispatch and six-month chat-history cleanup. After a Qdrant loss, run
`python -m scripts.rebuild_index` from `backend` to recreate collections and enqueue every
non-deleted note from Postgres. Chat history is private to the authenticated user and older than
six months is purged daily.

## Production process checklist

Run the schema migration once as a release job, then supervise the API, worker, and Beat as
separate processes that share the same environment:

```sh
alembic upgrade head
uvicorn app.v2_main:app --host 0.0.0.0 --port "${PORT:-8000}"
celery -A app.core.celery_app:celery_app worker -Q default,indexing,transcription
celery -A app.core.celery_app:celery_app beat
```

Configure PostgreSQL, Redis, Firebase Admin credentials, and
`PUBLIC_FRONTEND_URL=https://ai-notez.web.app` in the hosting provider's environment or secret
manager. The public frontend URL is automatically allowed by the v2 API's CORS middleware; set
`CORS_ORIGINS` to a comma-separated list when allowing additional exact origins. The legacy API
uses the separate `NOTEZ_CORS_ORIGINS` setting. Set `GEMINI_API_KEY`
for managed AI and transcription; configure `QDRANT_URL` (and `QDRANT_API_KEY` when required) for
semantic retrieval. Configure all four `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` values to share recording audio across API/worker
instances. The local filesystem audio fallback is not suitable for ephemeral or horizontally
scaled hosts.

Use `/livez` for process liveness and `/healthz` for readiness; readiness returns HTTP 503 unless
both PostgreSQL and Redis are available. Confirm that at least one Celery worker and one Beat
scheduler are running before enabling transcription or background indexing in production.

Run `pytest -q` from `backend` as part of the release checks. Keep deployment credentials out of
the frontend's `VITE_*` variables and browser bundle.
