from __future__ import annotations

import json
from functools import lru_cache
import os
from typing import Annotated, Any
from pathlib import Path

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    firebase_project_id: str
    firebase_service_account_json: SecretStr
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    public_frontend_url: str = "https://ai-notez.web.app"
    qdrant_url: str | None = None
    qdrant_api_key: SecretStr | None = None
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = Field(default=768, ge=768, le=768)
    r2_account_id: str | None = None
    r2_access_key_id: SecretStr | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_bucket: str | None = None
    gemini_api_key: SecretStr | None = None
    ai_chat_model: str = "gemini-3.5-flash-lite"
    gemini_transcription_model: str = "gemini-3.5-transcribe"
    recording_audio_dir: Path = Path(os.getenv("RECORDING_AUDIO_DIR", "data/recordings"))
    ai_rag_min_confidence: float = Field(default=0.65, ge=0, le=1)
    max_part_size_mb: int = Field(default=25, ge=1, le=250)
    rate_limit_per_minute: int = Field(default=60, ge=1, le=10000)
    polling_rate_limit_per_minute: int = Field(default=120, ge=1, le=10000)
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("database_url")
    @classmethod
    def async_database_url(cls, value: str) -> str:
        value = value.strip()
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value[len("postgresql://") :]
        if value.startswith("sqlite://"):
            return "sqlite+aiosqlite://" + value[len("sqlite://") :]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return json.loads(stripped)
            return [origin.strip() for origin in stripped.split(",") if origin.strip()]
        return value

    @field_validator("public_frontend_url")
    @classmethod
    def normalize_frontend_url(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @model_validator(mode="after")
    def validate_firebase_service_account(self) -> Settings:
        try:
            credentials = json.loads(self.firebase_service_account_json.get_secret_value())
        except json.JSONDecodeError as exc:
            raise ValueError("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.") from exc
        if not isinstance(credentials, dict) or credentials.get("type") != "service_account":
            raise ValueError("FIREBASE_SERVICE_ACCOUNT_JSON must contain a service-account object.")
        if not self.firebase_project_id.strip():
            raise ValueError("FIREBASE_PROJECT_ID must not be empty.")
        r2_values = (self.r2_account_id, self.r2_access_key_id, self.r2_secret_access_key, self.r2_bucket)
        if any(value is not None for value in r2_values) and any(value is None for value in r2_values):
            raise ValueError("Configure all R2 account, access key, secret key, and bucket settings together.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
