"""
Gemini Live Agent relay — always-on, context-aware.

One session per player screen load. Mic mute/unmute via Space key.
Scene context is pushed automatically whenever the scene changes.

Binary frames:  Browser → Server  raw PCM Int16 16kHz (only when mic unmuted)
                Server → Browser  raw PCM Int16 24kHz (Gemini voice response)
JSON frames:
  Browser → Server:
    {"type": "end"}                    — disconnect cleanly
    {"type": "context", "text": "..."} — current scene update (no audio reply expected)
  Server → Browser:
    {"type": "ready"}                  — session established
    {"type": "turn_complete"}          — Gemini finished speaking
    {"type": "error", "message": "..."}
"""

import os
import json
import asyncio
import logging
from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVE_MODEL     = "gemini-2.5-flash-native-audio-latest"


def _build_context(session: dict | None) -> str:
    if not session:
        return "No document context available."
    parts = [
        f"Document: {session.get('filename', 'Unknown')}",
        f"User prompt: {session.get('user_prompt', '')}",
    ]
    scenes: list[dict] = session.get("scenes", [])
    if scenes:
        parts.append("\nAll scenes in the presentation:")
        for s in scenes:
            parts.append(f"\nScene {s.get('scene_num', '?')}: {s.get('title', '')}")
            if s.get("narration"):
                parts.append(f"  {s['narration']}")
            if s.get("caption"):
                parts.append(f"  Key insight: {s['caption']}")
    return "\n".join(parts)


async def run_live_relay(websocket: WebSocket, session: dict | None) -> None:
    context = _build_context(session)

    config = {
        "response_modalities": ["AUDIO"],
        "system_instruction": (
            "You are an intelligent narrator assistant monitoring a live cinematic documentary experience.\n\n"
            "You run continuously in the background. The user will occasionally press Space to speak to you.\n"
            "You will receive scene context updates automatically as scenes change — use them to stay aware.\n\n"
            f"Document content:\n{context}\n\n"
            "Rules:\n"
            "- Answer voice questions concisely (2-4 sentences max).\n"
            "- Stay grounded in the document — do not invent facts.\n"
            "- Speak naturally, like a documentary narrator answering a viewer's question.\n"
            "- When you receive a [SCENE UPDATE] message, silently acknowledge it — do NOT speak unless asked.\n"
            "- If asked something unrelated, gently redirect to the content."
        ),
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {"voice_name": "Charon"}
            }
        },
    }

    client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options={"api_version": "v1beta"},
    )

    stop_event  = asyncio.Event()
    # Mixed queue: bytes = audio chunk, str = context update, None = sentinel
    input_queue: asyncio.Queue[bytes | str | None] = asyncio.Queue(maxsize=100)

    async def recv_from_browser() -> None:
        try:
            while not stop_event.is_set():
                message = await websocket.receive()
                if "bytes" in message and message["bytes"]:
                    # Mic audio — drop oldest if lagging
                    if input_queue.full():
                        try: input_queue.get_nowait()
                        except asyncio.QueueEmpty: pass
                    input_queue.put_nowait(message["bytes"])
                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    if data.get("type") == "end":
                        break
                    elif data.get("type") == "context":
                        text = data.get("text", "").strip()
                        if text:
                            await input_queue.put(text)
        except (WebSocketDisconnect, Exception) as exc:
            logger.info(f"Browser disconnected: {exc}")
        finally:
            await input_queue.put(None)
            stop_event.set()

    async def forward_inputs(live) -> None:
        """Route audio chunks and context text to Gemini."""
        while not stop_event.is_set():
            item = await input_queue.get()
            if item is None:
                break
            if isinstance(item, bytes):
                # Real-time mic audio
                await live.send(
                    input=types.LiveClientRealtimeInput(
                        media_chunks=[types.Blob(data=item, mime_type="audio/pcm;rate=16000")]
                    )
                )
            elif isinstance(item, str):
                # Scene context update — end_of_turn=True so Gemini commits it.
                # System instruction tells Gemini not to speak in response to these.
                await live.send(input=f"[SCENE UPDATE] {item}", end_of_turn=True)

    async def forward_from_gemini(live) -> None:
        """Multi-turn receive loop — persistent across user turns."""
        try:
            while not stop_event.is_set():
                turn = live.receive()
                async for response in turn:
                    if stop_event.is_set():
                        return
                    if response.server_content and response.server_content.model_turn:
                        for part in response.server_content.model_turn.parts:
                            if (
                                part.inline_data
                                and isinstance(part.inline_data.data, bytes)
                                and part.inline_data.data
                            ):
                                await websocket.send_bytes(part.inline_data.data)
                    if response.server_content and response.server_content.turn_complete:
                        await websocket.send_json({"type": "turn_complete"})
        except Exception as exc:
            logger.error(f"Gemini receive error: {exc}")
        finally:
            stop_event.set()

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as live:
            logger.info(f"Gemini Live session opened (model={LIVE_MODEL})")
            await websocket.send_json({"type": "ready"})

            await asyncio.gather(
                recv_from_browser(),
                forward_inputs(live),
                forward_from_gemini(live),
                return_exceptions=True,
            )

    except Exception as exc:
        logger.error(f"Live session failed: {exc}")
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        logger.info("Gemini Live session closed")
