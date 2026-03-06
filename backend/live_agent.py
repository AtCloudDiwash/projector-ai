"""
Gemini Live Agent relay for The Cinematic Narrator.

Bridges browser WebSocket ↔ Gemini Live API using live.start_stream().
  Browser mic (PCM Int16 16kHz) → WebSocket → Gemini Live
  Gemini Live (PCM Int16 24kHz) → WebSocket → Browser speaker

JSON control messages:
  Browser → Server:  {"type": "end"}           — stop session cleanly
  Server → Browser:  {"type": "ready"}         — Live session established
                     {"type": "turn_complete"}  — Gemini finished speaking
                     {"type": "error", "message": "..."}
Binary frames:
  Browser → Server:  raw PCM Int16 bytes (16kHz mono)
  Server → Browser:  raw PCM Int16 bytes (24kHz mono)
"""

import os
import json
import asyncio
import logging
from fastapi import WebSocket, WebSocketDisconnect
from google import genai

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVE_MODEL     = "gemini-2.5-flash-native-audio-latest"
MIC_MIME_TYPE  = "audio/pcm;rate=16000"


def _build_context(session: dict | None) -> str:
    if not session:
        return "No document context available."
    parts = [
        f"Document: {session.get('filename', 'Unknown')}",
        f"User prompt: {session.get('user_prompt', '')}",
    ]
    scenes: list[dict] = session.get("scenes", [])
    if scenes:
        parts.append("\nScene summaries from the cinematic presentation:")
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
            f"You are an intelligent narrator assistant for a live cinematic documentary experience.\n\n"
            f"The user is watching a presentation based on this content:\n{context}\n\n"
            f"Rules:\n"
            f"- Answer voice questions concisely (2-4 sentences max).\n"
            f"- Stay grounded in the document content — do not invent facts.\n"
            f"- Speak naturally, like a documentary narrator answering a viewer's question.\n"
            f"- If asked something unrelated to the document, gently redirect to the content."
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
    audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=50)

    async def recv_from_browser() -> None:
        """Read WebSocket frames → queue mic audio chunks."""
        try:
            while not stop_event.is_set():
                message = await websocket.receive()
                if "bytes" in message and message["bytes"]:
                    try:
                        audio_queue.put_nowait(message["bytes"])
                    except asyncio.QueueFull:
                        # Drop oldest to prevent lag build-up
                        try:
                            audio_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                        audio_queue.put_nowait(message["bytes"])
                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    if data.get("type") == "end":
                        break
        except (WebSocketDisconnect, Exception) as exc:
            logger.info(f"Browser disconnected: {exc}")
        finally:
            await audio_queue.put(None)  # sentinel to end mic_stream
            stop_event.set()

    async def mic_stream():
        """Async generator that feeds queued PCM chunks to start_stream."""
        while not stop_event.is_set():
            chunk = await audio_queue.get()
            if chunk is None:
                return
            yield chunk

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as live:
            logger.info(f"Gemini Live session opened (model={LIVE_MODEL})")
            await websocket.send_json({"type": "ready"})

            async def run_stream() -> None:
                """
                Pipe mic audio → Gemini via start_stream() and relay responses
                back to the browser as binary PCM frames.
                """
                try:
                    async for response in live.start_stream(
                        stream=mic_stream(),
                        mime_type=MIC_MIME_TYPE,
                    ):
                        if stop_event.is_set():
                            break

                        # PCM audio from Gemini → browser
                        if response.server_content and response.server_content.model_turn:
                            for part in response.server_content.model_turn.parts:
                                if (
                                    part.inline_data
                                    and isinstance(part.inline_data.data, bytes)
                                    and part.inline_data.data
                                ):
                                    await websocket.send_bytes(part.inline_data.data)

                        # Turn complete
                        if (
                            response.server_content
                            and response.server_content.turn_complete
                        ):
                            await websocket.send_json({"type": "turn_complete"})

                except Exception as exc:
                    logger.error(f"Stream error: {exc}")
                finally:
                    stop_event.set()

            await asyncio.gather(
                recv_from_browser(),
                run_stream(),
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
