"""
Firestore client for The Cinematic Narrator.
Stores session state and scene manifests.
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

USE_FIRESTORE = os.getenv("USE_FIRESTORE", "false").lower() == "true"
FIRESTORE_COLLECTION = os.getenv("FIRESTORE_COLLECTION", "narrator-sessions")
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")

# In-memory fallback when Firestore is disabled
_in_memory_store: dict = {}

_firestore_client = None


def _get_client():
    global _firestore_client
    if _firestore_client is None:
        from google.cloud import firestore
        _firestore_client = firestore.Client(project=GOOGLE_CLOUD_PROJECT)
    return _firestore_client


def create_session(session_id: str, filename: str, user_prompt: str, gcs_uri: str) -> None:
    """Create a new session document."""
    data = {
        "session_id": session_id,
        "filename": filename,
        "user_prompt": user_prompt,
        "gcs_uri": gcs_uri,
        "status": "processing",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "scenes": [],
    }
    if USE_FIRESTORE:
        try:
            client = _get_client()
            client.collection(FIRESTORE_COLLECTION).document(session_id).set(data)
            logger.info(f"Created Firestore session: {session_id}")
        except Exception as e:
            logger.error(f"Firestore create_session failed: {e}")
            _in_memory_store[session_id] = data
    else:
        _in_memory_store[session_id] = data


def append_scene(session_id: str, scene: dict) -> None:
    """Append a completed scene to the session manifest."""
    if USE_FIRESTORE:
        try:
            from google.cloud import firestore
            client = _get_client()
            ref = client.collection(FIRESTORE_COLLECTION).document(session_id)
            ref.update({"scenes": firestore.ArrayUnion([scene])})
        except Exception as e:
            logger.error(f"Firestore append_scene failed: {e}")
    else:
        if session_id in _in_memory_store:
            _in_memory_store[session_id]["scenes"].append(scene)


def complete_session(session_id: str) -> None:
    """Mark session as complete."""
    if USE_FIRESTORE:
        try:
            client = _get_client()
            client.collection(FIRESTORE_COLLECTION).document(session_id).update(
                {"status": "complete", "completed_at": datetime.now(timezone.utc).isoformat()}
            )
        except Exception as e:
            logger.error(f"Firestore complete_session failed: {e}")
    else:
        if session_id in _in_memory_store:
            _in_memory_store[session_id]["status"] = "complete"


def get_session(session_id: str) -> Optional[dict]:
    """Retrieve a session document."""
    if USE_FIRESTORE:
        try:
            client = _get_client()
            doc = client.collection(FIRESTORE_COLLECTION).document(session_id).get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:
            logger.error(f"Firestore get_session failed: {e}")
            return _in_memory_store.get(session_id)
    else:
        return _in_memory_store.get(session_id)
