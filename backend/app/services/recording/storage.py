from __future__ import annotations

import io
from pathlib import Path
from urllib.parse import urlparse

import boto3
from botocore.config import Config as BotoConfig

from ...core.config import settings


def _r2_enabled() -> bool:
    return all(
        (
            settings.r2_account_id,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
            settings.r2_bucket,
        )
    )


def _s3_client():
    if not _r2_enabled():
        raise RuntimeError("R2 credentials are not configured.")
    account_id = settings.r2_account_id
    access_key = settings.r2_access_key_id
    secret_key = settings.r2_secret_access_key
    bucket = settings.r2_bucket
    if not account_id or access_key is None or secret_key is None or not bucket:
        raise RuntimeError("R2 account, access key, secret key, and bucket must all be configured.")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key.get_secret_value(),
        aws_secret_access_key=secret_key.get_secret_value(),
        region_name="auto",
        config=BotoConfig(signature_version="s3v4"),
    )


def store_audio(storage_key: str, audio: bytes, content_type: str) -> str:
    if _r2_enabled():
        _s3_client().upload_fileobj(
            io.BytesIO(audio),
            settings.r2_bucket,
            storage_key,
            ExtraArgs={"ContentType": content_type},
        )
        return f"r2://{settings.r2_bucket}/{storage_key}"

    root = settings.recording_audio_dir.resolve()
    destination = (root / storage_key).resolve()
    if root not in destination.parents:
        raise ValueError("Invalid recording audio storage key.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(audio)
    return str(destination)


def read_audio(storage_key: str) -> bytes:
    if storage_key.startswith("r2://"):
        parsed = urlparse(storage_key)
        response = _s3_client().get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()
    path = Path(storage_key)
    root = settings.recording_audio_dir.resolve()
    resolved = path.resolve()
    if root not in resolved.parents:
        raise ValueError("Invalid recording audio storage path.")
    return resolved.read_bytes()


def upload_url(storage_key: str, *, expires_in: int = 900) -> str:
    return _s3_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket,
            "Key": storage_key,
            "ContentType": "audio/wav",
        },
        ExpiresIn=expires_in,
    )


def migrate_audio_to_r2(storage_key: str) -> str:
    if storage_key.startswith("r2://"):
        return storage_key
    if not _r2_enabled():
        return storage_key
    audio = read_audio(storage_key)
    key = f"manual-retry/{Path(storage_key).name}"
    return store_audio(key, audio, "audio/wav")
