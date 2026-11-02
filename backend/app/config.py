from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, default))))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("FIREBASE_DATABASE_URL", "")
    firebase_project_id: str = os.getenv("FIREBASE_PROJECT_ID", "ai-notez")
    firebase_service_account_json: str = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    data_dir: Path = Path(
        os.getenv("NOTEZ_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data"))
    ).expanduser()
    cors_origins: tuple[str, ...] = tuple(
        origin.strip().rstrip("/")
        for origin in os.getenv("NOTEZ_CORS_ORIGINS", "").split(",")
        if origin.strip()
    )
    default_provider: str = os.getenv("AI_DEFAULT_PROVIDER", "gemini").lower()
    gemini_models: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv(
            "AI_GEMINI_MODELS",
            "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-3-flash-preview",
        ).split(",") if item.strip()
    )
    groq_models: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv(
            "AI_GROQ_MODELS",
            "llama-3.3-70b-versatile,openai/gpt-oss-120b,openai/gpt-oss-20b,meta-llama/llama-4-scout-17b-16e-instruct,qwen/qwen3-32b,llama-3.1-8b-instant",
        ).split(",") if item.strip()
    )
    gemini_key: str = os.getenv("AI_GEMINI_API_KEY", "")
    groq_key: str = os.getenv("AI_GROQ_API_KEY", "")
    embedding_key: str = os.getenv("AI_EMBEDDING_API_KEY", "")
    embedding_provider: str = os.getenv("AI_EMBEDDING_PROVIDER", "gemini").lower()
    embedding_model: str = os.getenv("AI_EMBEDDING_MODEL", "gemini-embedding-001")
    embedding_dimensions: int = _integer("AI_EMBEDDING_DIMENSIONS", 768, 64, 3072)
    request_timeout_seconds: int = _integer("AI_REQUEST_TIMEOUT_SECONDS", 60, 5, 180)
    rate_limit_requests: int = _integer("AI_RATE_LIMIT_REQUESTS", 30, 1, 1000)
    rate_limit_window_seconds: int = _integer("AI_RATE_LIMIT_WINDOW_SECONDS", 60, 1, 3600)
    guest_rate_limit_requests: int = _integer("AI_GUEST_RATE_LIMIT_REQUESTS", 5, 1, 100)
    guest_rate_limit_window_seconds: int = _integer("AI_GUEST_RATE_LIMIT_WINDOW_SECONDS", 60, 1, 3600)
    guest_max_prompt_chars: int = _integer("AI_GUEST_MAX_PROMPT_CHARS", 12000, 1000, 60000)
    max_prompt_chars: int = _integer("AI_MAX_PROMPT_CHARS", 60000, 1000, 200000)
    max_chunks_per_user: int = _integer("AI_MAX_CHUNKS_PER_USER", 20000, 100, 100000)
    max_indexed_notes: int = _integer("AI_MAX_INDEXED_NOTES", 5000, 1, 50000)
    max_search_results: int = _integer("AI_MAX_SEARCH_RESULTS", 8, 1, 25)
    min_similarity: float = float(os.getenv("AI_MIN_SIMILARITY", "0.18"))

settings = Settings()

if settings.default_provider not in {"gemini", "groq"}:
    raise ValueError("AI_DEFAULT_PROVIDER must be 'gemini' or 'groq'.")
if not settings.gemini_models or not settings.groq_models:
    raise ValueError("AI_GEMINI_MODELS and AI_GROQ_MODELS must each contain at least one model.")
if settings.embedding_provider != "gemini":
    raise ValueError("This backend currently supports Gemini embeddings only.")
if not 0 <= settings.min_similarity <= 1:
    raise ValueError("AI_MIN_SIMILARITY must be between 0 and 1.")
