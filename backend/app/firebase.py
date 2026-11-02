from __future__ import annotations

import json
import threading

from google.auth.exceptions import DefaultCredentialsError
import firebase_admin
from firebase_admin import auth, credentials, db
from firebase_admin.exceptions import FirebaseError

from .config import settings

_app = None
_lock = threading.Lock()


def firebase_app():
    global _app
    if _app:
        return _app
    with _lock:
        if _app:
            return _app
        options = {"projectId": settings.firebase_project_id}
        if settings.database_url:
            options["databaseURL"] = settings.database_url
        try:
            _app = firebase_admin.get_app()
        except ValueError:
            initialize_options = {"options": options}
            if settings.firebase_service_account_json:
                try:
                    service_account_info = json.loads(settings.firebase_service_account_json)
                except json.JSONDecodeError as exc:
                    raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.") from exc
                if not isinstance(service_account_info, dict):
                    raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON must contain a service-account object.")
                initialize_options["credential"] = credentials.Certificate(service_account_info)
            _app = firebase_admin.initialize_app(**initialize_options)
        return _app


def verify_id_token(token: str) -> dict:
    try:
        return auth.verify_id_token(token, app=firebase_app(), check_revoked=True)
    except DefaultCredentialsError as exc:
        raise RuntimeError(
            "Firebase Admin credentials are unavailable. Configure FIREBASE_SERVICE_ACCOUNT_JSON."
        ) from exc
    except (ValueError, FirebaseError) as exc:
        raise ValueError("The Firebase ID token is invalid or expired.") from exc


def user_note(uid: str, note_id: str) -> dict | None:
    if not settings.database_url:
        raise RuntimeError("FIREBASE_DATABASE_URL is required for note indexing.")
    value = db.reference(f"users/{uid}/notes/{note_id}", app=firebase_app()).get()
    return value if isinstance(value, dict) else None


def user_notes(uid: str) -> dict[str, dict]:
    if not settings.database_url:
        raise RuntimeError("FIREBASE_DATABASE_URL is required for index rebuilds.")
    value = db.reference(f"users/{uid}/notes", app=firebase_app()).get()
    return value if isinstance(value, dict) else {}
