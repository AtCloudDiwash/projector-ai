"""
The Cinematic Narrator — FastAPI Backend
Receives file uploads and streams a cinematic multimedia experience via SSE.
"""

import os
import uuid
import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Session queue registry: session_id -> asyncio.Queue of SSE strings
_session_queues: dict[str, asyncio.Queue] = {}
_session_tasks: dict[str, asyncio.Task] = {}

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(",")
MAX_FILE_SIZE_MB = 20
ALLOWED_EXTENSIONS = {
    "txt", "md", "pdf", "csv", "json", "yaml", "yml",
    "png", "jpg", "jpeg", "webp", "gif", "xml", "html",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("The Cinematic Narrator is starting up...")
    yield
    logger.info("Shutting down — cancelling active tasks.")
    for task in _session_tasks.values():
        task.cancel()


app = FastAPI(
    title="The Cinematic Narrator",
    description="Transform any document into a real-time cinematic multimedia experience.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
# Set FRONTEND_VERSION=v2 in .env to use the React/TS frontend (frontend-2/dist)
_frontend_version = os.getenv("FRONTEND_VERSION", "v1")
if _frontend_version == "v2":
    FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "static_v2")
else:
    FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets") if os.path.isdir(os.path.join(FRONTEND_DIR, "assets")) else None


# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serve the frontend index.html."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Cinematic Narrator API</h1><p>Frontend not found.</p>")


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "cinematic-narrator"}


@app.post("/upload")
async def upload_and_start(
    file: UploadFile = File(...),
    prompt: str = Form(...),
):
    """
    Accept a file upload + user prompt.
    Starts background processing and returns a session_id.
    The client should then connect to GET /stream/{session_id}.
    """
    # --- Validate file ---
    filename = file.filename or "upload.txt"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '.{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE_MB}MB.",
        )

    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")

    # --- Create session ---
    session_id = uuid.uuid4().hex

    # Store to Cloud Storage + Firestore
    from storage_client import upload_file_bytes
    from firestore_client import create_session

    gcs_uri = upload_file_bytes(file_bytes, filename, file.content_type or "application/octet-stream")
    create_session(session_id, filename, prompt, gcs_uri)

    # --- Create SSE queue and start background processing ---
    queue: asyncio.Queue = asyncio.Queue()
    _session_queues[session_id] = queue

    async def run_narrator():
        from narrator import stream_cinematic_experience
        try:
            async for event in stream_cinematic_experience(
                session_id=session_id,
                file_bytes=file_bytes,
                filename=filename,
                user_prompt=prompt,
            ):
                await queue.put(event)
        except Exception as e:
            import json
            await queue.put(f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n")
        finally:
            await queue.put(None)  # Sentinel: stream done

    task = asyncio.create_task(run_narrator())
    _session_tasks[session_id] = task

    logger.info(f"Session {session_id} started for file '{filename}'")
    return JSONResponse({
        "session_id": session_id,
        "filename": filename,
        "message": "Processing started. Connect to /stream/{session_id} for live output.",
    })


@app.get("/stream/{session_id}")
async def stream_experience(session_id: str, request: Request):
    """
    SSE endpoint. Streams the cinematic experience events to the client.
    """
    if session_id not in _session_queues:
        raise HTTPException(status_code=404, detail="Session not found or already expired.")

    queue = _session_queues[session_id]

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    logger.info(f"Client disconnected from session {session_id}")
                    break

                try:
                    event = await asyncio.wait_for(queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ": keepalive\n\n"
                    continue

                if event is None:
                    # Sentinel received — stream complete
                    break

                yield event

        finally:
            # Cleanup
            _session_queues.pop(session_id, None)
            task = _session_tasks.pop(session_id, None)
            if task and not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@app.get("/session/{session_id}")
async def get_session_info(session_id: str):
    """Retrieve stored session manifest from Firestore."""
    from firestore_client import get_session
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return JSONResponse(session)


@app.websocket("/ws/live/{session_id}")
async def gemini_live_ws(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for Gemini Live voice agent.
    Bridges browser mic (PCM 16kHz) ↔ Gemini Live API (PCM 24kHz).
    """
    await websocket.accept()
    from firestore_client import get_session
    from live_agent import run_live_relay
    session = get_session(session_id)
    await run_live_relay(websocket, session)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
