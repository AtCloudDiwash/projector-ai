"""
Google Cloud Storage client for The Cinematic Narrator.
Handles file uploads and asset storage.
"""

import os
import uuid
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)

USE_CLOUD_STORAGE = os.getenv("USE_CLOUD_STORAGE", "false").lower() == "true"
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "cinematic-narrator-assets")
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")

_storage_client = None


def _get_client():
    global _storage_client
    if _storage_client is None:
        from google.cloud import storage
        _storage_client = storage.Client(project=GOOGLE_CLOUD_PROJECT)
    return _storage_client


def upload_file_bytes(file_bytes: bytes, filename: str, content_type: str) -> str:
    """Upload raw bytes to GCS and return the GCS URI."""
    if not USE_CLOUD_STORAGE:
        logger.info("Cloud Storage disabled — returning local placeholder URI.")
        return f"local://{filename}"

    try:
        client = _get_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob_name = f"uploads/{uuid.uuid4().hex}/{filename}"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(file_bytes, content_type=content_type)
        uri = f"gs://{GCS_BUCKET_NAME}/{blob_name}"
        logger.info(f"Uploaded file to {uri}")
        return uri
    except Exception as e:
        logger.error(f"Failed to upload to GCS: {e}")
        return f"local://{filename}"


def upload_image_base64(image_b64: str, session_id: str, scene_num: int) -> str:
    """Upload a base64-encoded image to GCS and return the public URL."""
    if not USE_CLOUD_STORAGE:
        return f"data:image/png;base64,{image_b64}"

    try:
        image_bytes = base64.b64decode(image_b64)
        client = _get_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob_name = f"scenes/{session_id}/scene_{scene_num:02d}.png"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(image_bytes, content_type="image/png")
        blob.make_public()
        url = blob.public_url
        logger.info(f"Uploaded scene image to {url}")
        return url
    except Exception as e:
        logger.error(f"Failed to upload image to GCS: {e}")
        return f"data:image/png;base64,{image_b64}"
