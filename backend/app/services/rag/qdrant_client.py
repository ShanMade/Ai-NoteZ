from __future__ import annotations

import logging
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models

from ...core.config import settings

logger = logging.getLogger(__name__)
QDRANT_COLLECTIONS = {
    "note_chunks": {"size": 768, "distance": models.Distance.COSINE},
    "note_facets": {"size": 768, "distance": models.Distance.COSINE},
    "session_speakers": {"size": 256, "distance": models.Distance.COSINE},
}
_client: QdrantClient | None = None


def _get_client() -> QdrantClient:
    global _client
    if _client is None:
        if not settings.qdrant_url:
            raise RuntimeError("QDRANT_URL is not configured.")
        api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None
        _client = QdrantClient(url=settings.qdrant_url, api_key=api_key, timeout=20)
    return _client


def ensure_collections() -> None:
    client = _get_client()
    for collection, config in QDRANT_COLLECTIONS.items():
        if not client.collection_exists(collection):
            client.create_collection(
                collection_name=collection,
                vectors_config=models.VectorParams(size=config["size"], distance=config["distance"]),
            )
            logger.info("Created Qdrant collection %s.", collection)


def upsert(collection: str, points: list[dict[str, Any]]) -> None:
    if not points:
        return
    encoded = [models.PointStruct(**point) for point in points]
    _get_client().upsert(collection_name=collection, points=encoded, wait=True)


def search(
    collection: str,
    vector: list[float],
    *,
    user_id: str,
    limit: int,
    note_id: str | None = None,
) -> list[dict[str, Any]]:
    conditions = [
        models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id)),
    ]
    if note_id is not None:
        conditions.append(models.FieldCondition(key="note_id", match=models.MatchValue(value=note_id)))
    response = _get_client().query_points(
        collection_name=collection,
        query=vector,
        query_filter=models.Filter(must=conditions),
        limit=limit,
        with_payload=True,
    )
    return [
        {
            "id": str(point.id),
            "score": float(point.score),
            "payload": dict(point.payload or {}),
        }
        for point in response.points
    ]


def delete_note_vectors(note_id: str) -> None:
    client = _get_client()
    selector = models.FilterSelector(
        filter=models.Filter(
            must=[models.FieldCondition(key="note_id", match=models.MatchValue(value=note_id))]
        )
    )
    for collection in ("note_chunks", "note_facets"):
        client.delete(collection_name=collection, points_selector=selector, wait=True)


def delete_stale_chunks(note_id: str, chunk_count: int) -> None:
    _get_client().delete(
        collection_name="note_chunks",
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(key="note_id", match=models.MatchValue(value=note_id)),
                    models.FieldCondition(key="chunk_index", range=models.Range(gte=chunk_count)),
                ]
            )
        ),
        wait=True,
    )


def delete_facet_vectors(note_id: str) -> None:
    _get_client().delete(
        collection_name="note_facets",
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[models.FieldCondition(key="note_id", match=models.MatchValue(value=note_id))]
            )
        ),
        wait=True,
    )
