from sqlalchemy.engine import make_url

from app.core.config import Settings


def test_async_postgres_url_removes_unsupported_channel_binding_parameter():
    settings = Settings(
        database_url=(
            "postgresql://notez:local-test-secret@db.example/neondb"
            "?sslmode=require&channel_binding=require"
        ),
        redis_url="redis://localhost:6379/0",
        firebase_project_id="ai-notez",
        firebase_service_account_json='{"type":"service_account","project_id":"ai-notez"}',
        _env_file=None,
    )

    url = make_url(settings.database_url)

    assert url.drivername == "postgresql+asyncpg"
    assert url.query == {"ssl": "require"}
