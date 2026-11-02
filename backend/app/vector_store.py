from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import sqlite3
import threading
from array import array
from collections.abc import Awaitable, Callable, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import numpy as np
from fastapi import HTTPException
from usearch.index import Index

from .config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1600
CHUNK_OVERLAP = 200
EMBED_BATCH_SIZE = 64


def user_key(uid: str) -> str:
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()


def note_text(note: dict) -> str:
    body = note.get("body", "")
    if not isinstance(body, str):
        body = ""
    readable = note.get("htmlReadableText", "")
    if isinstance(readable, str) and readable:
        body = f"{body}\n{readable}"
    tags = note.get("tags", [])
    if not isinstance(tags, (list, tuple)):
        tags = []
    fields = [
        str(note.get("title") or "Untitled note"),
        str(note.get("subject") or ""),
        str(note.get("folderPath") or ""),
        " ".join(str(tag) for tag in tags if isinstance(tag, (str, int, float))),
        body,
    ]
    return "\n".join(part for part in fields if part).strip()[:200_000]


def split_chunks(text: str) -> list[str]:
    clean = " ".join(text.split())
    if not clean:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + CHUNK_SIZE)
        if end < len(clean):
            boundary = clean.rfind(" ", start + CHUNK_SIZE // 2, end)
            if boundary > start:
                end = boundary
        chunks.append(clean[start:end].strip())
        if end >= len(clean):
            break
        start = max(start + 1, end - CHUNK_OVERLAP)
    return chunks


class HnswIndexManager:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = (data_dir or settings.data_dir).expanduser().resolve()
        self.database_path = self.data_dir / "notez-vectors.sqlite3"
        self.index_dir = self.data_dir / "indexes"
        self._locks: dict[str, asyncio.Lock] = {}
        self._lock_guard = threading.Lock()
        self._database_lock = threading.Lock()
        self._database_ready = False
        self._indexes: dict[str, tuple[Index, int]] = {}

    def _async_lock(self, owner_key: str) -> asyncio.Lock:
        with self._lock_guard:
            return self._locks.setdefault(owner_key, asyncio.Lock())

    def _initialize_database(self) -> None:
        if self._database_ready:
            return
        with self._database_lock:
            if self._database_ready:
                return
            self.data_dir.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.database_path, timeout=30)
            try:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS note_states (
                        owner_key TEXT NOT NULL,
                        note_id TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        embedding_model TEXT NOT NULL,
                        chunk_count INTEGER NOT NULL,
                        PRIMARY KEY (owner_key, note_id)
                    );
                    CREATE TABLE IF NOT EXISTS note_chunks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_key TEXT NOT NULL,
                        note_id TEXT NOT NULL,
                        position INTEGER NOT NULL,
                        content_hash TEXT NOT NULL,
                        title TEXT NOT NULL,
                        folder_path TEXT NOT NULL,
                        chunk_text TEXT NOT NULL,
                        embedding BLOB NOT NULL,
                        UNIQUE (owner_key, note_id, position)
                    );
                    CREATE INDEX IF NOT EXISTS note_chunks_owner_note
                        ON note_chunks (owner_key, note_id);
                    CREATE TABLE IF NOT EXISTS index_revisions (
                        owner_key TEXT PRIMARY KEY,
                        revision INTEGER NOT NULL,
                        indexed_revision INTEGER NOT NULL
                    );
                    """
                )
            finally:
                connection.close()
            self._database_ready = True

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._initialize_database()
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    def _index_path(self, owner_key: str) -> Path:
        return self.index_dir / f"{owner_key}.usearch"

    def _new_index(self) -> Index:
        return Index(ndim=settings.embedding_dimensions, metric="cos", dtype="f32")

    @staticmethod
    def _encode_vector(vector: Sequence[float]) -> bytes:
        return array("f", vector).tobytes()

    @staticmethod
    def _decode_vector(vector: bytes) -> np.ndarray:
        values = array("f")
        values.frombytes(vector)
        return np.asarray(values, dtype=np.float32)

    def _revision(self, owner_key: str) -> tuple[int, int]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT revision, indexed_revision FROM index_revisions WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()
        return (int(row["revision"]), int(row["indexed_revision"])) if row else (0, 0)

    def _load_index_at_revision(self, owner_key: str, revision: int) -> Index | None:
        cached = self._indexes.get(owner_key)
        if cached and cached[1] == revision:
            return cached[0]
        current_revision, indexed_revision = self._revision(owner_key)
        path = self._index_path(owner_key)
        if current_revision >= revision and indexed_revision == revision and path.is_file():
            try:
                return Index.restore(str(path))
            except (OSError, RuntimeError, ValueError) as exc:
                logger.warning("Could not restore HNSW index %s; rebuilding from SQLite: %s", owner_key, exc)
        return None

    def _build_index_from_database(self, owner_key: str) -> Index:
        index = self._new_index()
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, embedding FROM note_chunks WHERE owner_key = ? ORDER BY id",
                (owner_key,),
            ).fetchall()
        if rows:
            keys = np.asarray([int(row["id"]) for row in rows], dtype=np.uint64)
            vectors = np.stack([self._decode_vector(row["embedding"]) for row in rows])
            index.add(keys, vectors)
        return index

    def _save_index(self, owner_key: str, index: Index, revision: int) -> None:
        self.index_dir.mkdir(parents=True, exist_ok=True)
        path = self._index_path(owner_key)
        temporary = path.with_name(f"{path.name}.tmp")
        index.save(str(temporary))
        os.replace(temporary, path)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET indexed_revision = excluded.indexed_revision
                """,
                (owner_key, revision, revision),
            )
            connection.commit()
        self._indexes[owner_key] = (index, revision)

    def _current_index(self, owner_key: str) -> tuple[Index, int]:
        revision, indexed_revision = self._revision(owner_key)
        cached = self._indexes.get(owner_key)
        if cached and cached[1] == revision:
            return cached
        path = self._index_path(owner_key)
        if indexed_revision == revision and path.is_file():
            try:
                index = Index.restore(str(path))
                self._indexes[owner_key] = (index, revision)
                return index, revision
            except (OSError, RuntimeError, ValueError) as exc:
                logger.warning("Could not restore HNSW index %s; rebuilding from SQLite: %s", owner_key, exc)
        index = self._build_index_from_database(owner_key)
        self._save_index(owner_key, index, revision)
        return index, revision

    def _apply_index_delta(
        self,
        owner_key: str,
        previous_revision: int,
        revision: int,
        removed_ids: list[int],
        added_ids: list[int],
        added_vectors: list[list[float]],
    ) -> None:
        index = self._load_index_at_revision(owner_key, previous_revision)
        if index is None:
            index = self._build_index_from_database(owner_key)
        else:
            if removed_ids:
                index.remove(np.asarray(removed_ids, dtype=np.uint64))
            if added_ids:
                index.add(
                    np.asarray(added_ids, dtype=np.uint64),
                    np.asarray(added_vectors, dtype=np.float32),
                )
        self._save_index(owner_key, index, revision)

    async def _embed(
        self,
        chunks: list[str],
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    ) -> list[list[float]]:
        vectors: list[list[float]] = []
        for offset in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[offset:offset + EMBED_BATCH_SIZE]
            batch_vectors = await embed(batch)
            if len(batch_vectors) != len(batch):
                raise HTTPException(status_code=502, detail="Embedding count did not match the note's chunks.")
            for vector in batch_vectors:
                if (
                    not isinstance(vector, (list, tuple))
                    or len(vector) != settings.embedding_dimensions
                    or any(
                        not isinstance(value, (int, float)) or not math.isfinite(value)
                        for value in vector
                    )
                ):
                    raise HTTPException(status_code=502, detail="The embedding provider returned an incompatible vector.")
                vectors.append([float(value) for value in vector])
        return vectors

    def _upsert_sync(
        self,
        owner_key: str,
        note_id: str,
        note: dict,
        digest: str,
        chunks: list[str],
        vectors: list[list[float]],
    ) -> bool:
        title = str(note.get("title") or "Untitled note")
        folder_path = str(note.get("folderPath") or "")
        with self._connect() as connection:
            previous_revision, _ = self._revision(owner_key)
            existing = connection.execute(
                "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ? ORDER BY id",
                (owner_key, note_id),
            ).fetchall()
            removed_ids = [int(row["id"]) for row in existing]
            current = connection.execute(
                "SELECT 1 FROM note_states WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            ).fetchone()
            if current is None:
                note_count = connection.execute(
                    "SELECT COUNT(*) FROM note_states WHERE owner_key = ?",
                    (owner_key,),
                ).fetchone()[0]
                if note_count >= settings.max_indexed_notes:
                    raise HTTPException(status_code=413, detail="This account has reached its indexed-note limit.")
            current_chunks = connection.execute(
                "SELECT COUNT(*) FROM note_chunks WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()[0]
            if current_chunks - len(removed_ids) + len(chunks) > settings.max_chunks_per_user:
                raise HTTPException(status_code=413, detail="This user's semantic index has reached its configured chunk limit.")

            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            )
            connection.execute(
                """
                INSERT INTO note_states (owner_key, note_id, content_hash, embedding_model, chunk_count)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(owner_key, note_id) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    embedding_model = excluded.embedding_model,
                    chunk_count = excluded.chunk_count
                """,
                (owner_key, note_id, digest, settings.embedding_model, len(chunks)),
            )
            added_ids: list[int] = []
            for position, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                cursor = connection.execute(
                    """
                    INSERT INTO note_chunks (
                        owner_key, note_id, position, content_hash, title, folder_path, chunk_text, embedding
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        owner_key,
                        note_id,
                        position,
                        digest,
                        title,
                        folder_path,
                        chunk,
                        self._encode_vector(vector),
                    ),
                )
                added_ids.append(int(cursor.lastrowid))
            revision = previous_revision + 1
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET revision = excluded.revision
                """,
                (owner_key, revision, previous_revision),
            )
            connection.commit()

        self._apply_index_delta(owner_key, previous_revision, revision, removed_ids, added_ids, vectors)
        return True

    async def upsert(
        self,
        uid: str,
        note_id: str,
        note: dict,
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    ) -> bool:
        text = note_text(note)
        if not text:
            return await self.delete(uid, note_id)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        chunks = split_chunks(text)
        if len(chunks) > settings.max_chunks_per_user:
            raise HTTPException(status_code=413, detail="This note has too many chunks.")

        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            with self._connect() as connection:
                state = connection.execute(
                    """
                    SELECT content_hash, embedding_model, chunk_count FROM note_states
                    WHERE owner_key = ? AND note_id = ?
                    """,
                    (owner_key, note_id),
                ).fetchone()
            if (
                state
                and state["content_hash"] == digest
                and state["embedding_model"] == settings.embedding_model
                and state["chunk_count"] == len(chunks)
            ):
                return False
            vectors = await self._embed(chunks, embed)
            return await asyncio.to_thread(
                self._upsert_sync,
                owner_key,
                note_id,
                note,
                digest,
                chunks,
                vectors,
            )

    def _delete_sync(self, owner_key: str, note_id: str) -> bool:
        with self._connect() as connection:
            previous_revision, _ = self._revision(owner_key)
            rows = connection.execute(
                "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            ).fetchall()
            state = connection.execute(
                "SELECT 1 FROM note_states WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            ).fetchone()
            if not rows and state is None:
                return False
            removed_ids = [int(row["id"]) for row in rows]
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            )
            connection.execute(
                "DELETE FROM note_states WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            )
            revision = previous_revision + 1
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET revision = excluded.revision
                """,
                (owner_key, revision, previous_revision),
            )
            connection.commit()
        self._apply_index_delta(owner_key, previous_revision, revision, removed_ids, [], [])
        return True

    async def delete(self, uid: str, note_id: str) -> bool:
        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            return await asyncio.to_thread(self._delete_sync, owner_key, note_id)

    def _rebuild_sync(
        self,
        owner_key: str,
        prepared: dict[str, tuple[dict, str, list[str], list[list[float]]]],
    ) -> None:
        with self._connect() as connection:
            previous_revision, _ = self._revision(owner_key)
            existing_notes = connection.execute(
                "SELECT note_id FROM note_states WHERE owner_key = ?",
                (owner_key,),
            ).fetchall()
            existing_ids = {
                str(row["note_id"]) for row in existing_notes
            }
            desired_ids = set(prepared)
            changed_ids = existing_ids - desired_ids
            removed_ids: list[int] = []
            for note_id in changed_ids:
                removed_ids.extend(
                    int(row["id"])
                    for row in connection.execute(
                        "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                        (owner_key, note_id),
                    ).fetchall()
                )
            added_ids: list[int] = []
            added_vectors: list[list[float]] = []
            for note_id, (_, digest, chunks, vectors) in prepared.items():
                state = connection.execute(
                    """
                    SELECT content_hash, embedding_model, chunk_count FROM note_states
                    WHERE owner_key = ? AND note_id = ?
                    """,
                    (owner_key, note_id),
                ).fetchone()
                if (
                    state
                    and state["content_hash"] == digest
                    and state["embedding_model"] == settings.embedding_model
                    and state["chunk_count"] == len(chunks)
                ):
                    continue
                old_rows = connection.execute(
                    "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                    (owner_key, note_id),
                ).fetchall()
                removed_ids.extend(int(row["id"]) for row in old_rows)
                changed_ids.add(note_id)

            if not changed_ids and not removed_ids:
                return

            connection.execute("BEGIN IMMEDIATE")
            for note_id in changed_ids:
                connection.execute(
                    "DELETE FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                    (owner_key, note_id),
                )
                if note_id not in desired_ids:
                    connection.execute(
                        "DELETE FROM note_states WHERE owner_key = ? AND note_id = ?",
                        (owner_key, note_id),
                    )
            for note_id, (note, digest, chunks, vectors) in prepared.items():
                if note_id not in changed_ids:
                    continue
                title = str(note.get("title") or "Untitled note")
                folder_path = str(note.get("folderPath") or "")
                connection.execute(
                    """
                    INSERT INTO note_states (owner_key, note_id, content_hash, embedding_model, chunk_count)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(owner_key, note_id) DO UPDATE SET
                        content_hash = excluded.content_hash,
                        embedding_model = excluded.embedding_model,
                        chunk_count = excluded.chunk_count
                    """,
                    (owner_key, note_id, digest, settings.embedding_model, len(chunks)),
                )
                for position, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                    cursor = connection.execute(
                        """
                        INSERT INTO note_chunks (
                            owner_key, note_id, position, content_hash, title, folder_path, chunk_text, embedding
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            owner_key,
                            note_id,
                            position,
                            digest,
                            title,
                            folder_path,
                            chunk,
                            self._encode_vector(vector),
                        ),
                    )
                    added_ids.append(int(cursor.lastrowid))
                    added_vectors.append(vector)

            revision = previous_revision + 1
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET revision = excluded.revision
                """,
                (owner_key, revision, previous_revision),
            )
            connection.commit()
        self._apply_index_delta(owner_key, previous_revision, revision, removed_ids, added_ids, added_vectors)

    async def rebuild(
        self,
        uid: str,
        notes: dict[str, dict],
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    ) -> int:
        if len(notes) > settings.max_indexed_notes:
            raise HTTPException(status_code=413, detail="This account has more notes than the configured rebuild limit.")
        prepared: dict[str, tuple[dict, str, list[str], list[list[float]]]] = {}
        total_chunks = 0
        for note_id, note in notes.items():
            text = note_text(note)
            chunks = split_chunks(text)
            total_chunks += len(chunks)
            if total_chunks > settings.max_chunks_per_user:
                raise HTTPException(status_code=413, detail="The semantic index has reached its configured chunk limit.")
            if chunks:
                digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
                prepared[note_id] = (note, digest, chunks, [])

        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            with self._connect() as connection:
                existing = {
                    str(row["note_id"]): row
                    for row in connection.execute(
                        """
                        SELECT note_id, content_hash, embedding_model, chunk_count FROM note_states
                        WHERE owner_key = ?
                        """,
                        (owner_key,),
                    ).fetchall()
                }
            chunks_to_embed: list[str] = []
            changed_notes: list[str] = []
            for note_id, (_, digest, chunks, _) in prepared.items():
                state = existing.get(note_id)
                if not (
                    state
                    and state["content_hash"] == digest
                    and state["embedding_model"] == settings.embedding_model
                    and state["chunk_count"] == len(chunks)
                ):
                    changed_notes.append(note_id)
                    chunks_to_embed.extend(chunks)
            vectors = await self._embed(chunks_to_embed, embed)
            vector_offset = 0
            for note_id in changed_notes:
                note, digest, chunks, _ = prepared[note_id]
                prepared[note_id] = (
                    note,
                    digest,
                    chunks,
                    vectors[vector_offset:vector_offset + len(chunks)],
                )
                vector_offset += len(chunks)
            await asyncio.to_thread(self._rebuild_sync, owner_key, prepared)
        return total_chunks

    def _search_sync(self, owner_key: str, vector: list[float], limit: int) -> list[dict]:
        index, _ = self._current_index(owner_key)
        if index.size == 0:
            return []
        matches = index.search(np.asarray(vector, dtype=np.float32), count=min(limit * 8, settings.max_chunks_per_user))
        keys = [int(key) for key in matches.keys.tolist()]
        distances = [float(distance) for distance in matches.distances.tolist()]
        if not keys:
            return []
        placeholders = ",".join("?" for _ in keys)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, note_id, content_hash, title, folder_path, chunk_text
                FROM note_chunks
                WHERE owner_key = ? AND id IN ({placeholders})
                """,
                (owner_key, *keys),
            ).fetchall()
        by_id = {int(row["id"]): row for row in rows}
        best_by_note: dict[str, dict] = {}
        for chunk_id, distance in zip(keys, distances, strict=True):
            row = by_id.get(chunk_id)
            if row is None:
                continue
            similarity = 1 - distance
            if not math.isfinite(similarity) or similarity < settings.min_similarity:
                continue
            note_id = str(row["note_id"])
            result = {
                "id": note_id,
                "title": str(row["title"] or "Untitled note"),
                "folderPath": str(row["folder_path"] or ""),
                "text": str(row["chunk_text"]),
                "similarity": similarity,
                "contentHash": str(row["content_hash"]),
            }
            current = best_by_note.get(note_id)
            if current is None or similarity > current["similarity"]:
                best_by_note[note_id] = result
        return sorted(
            best_by_note.values(),
            key=lambda result: result["similarity"],
            reverse=True,
        )[:limit]

    async def search(self, uid: str, vector: list[float], limit: int) -> list[dict]:
        if (
            not isinstance(vector, (list, tuple))
            or len(vector) != settings.embedding_dimensions
            or any(
                not isinstance(value, (int, float)) or not math.isfinite(value)
                for value in vector
            )
        ):
            raise HTTPException(status_code=502, detail="The query embedding has an incompatible vector dimension.")
        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            return await asyncio.to_thread(self._search_sync, owner_key, vector, limit)
