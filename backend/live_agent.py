"""
Gemini Live Agent relay — always-on, context-aware, tool-enabled.

Streams:
  Browser → Server  binary: PCM Int16 16kHz mic audio (when mic unmuted)
  Browser → Server  JSON:   context updates, tool responses (frame / future: search result)
  Server  → Browser binary: PCM Int16 24kHz Gemini voice
  Server  → Browser JSON:   ready | turn_complete | tool_call | error

Tool protocol (extensible — add new tools to TOOLS list + dispatch in handle_tool_responses):
  Currently:   capture_screen  — Gemini requests a screenshot, frontend sends JPEG frame back
  Future slot: google_search   — Gemini requests a web search, backend fetches and returns results
"""

import os
import json
import base64
import asyncio
import logging
from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVE_MODEL     = "gemini-2.5-flash-native-audio-latest"

# ── Tool definitions (extend this list to add new tools) ─────────────────────
TOOLS = [
    {
        "function_declarations": [
            {
                "name": "capture_screen",
                "description": (
                    "Capture the user's current screen as an image to see what they are looking at. "
                    "Call this when the user asks about what's on their screen, what image is displayed, "
                    "what they see, or any visual question about the current content on screen."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
            # ── Future tool slot ──────────────────────────────────────────────
            # {
            #     "name": "google_search",
            #     "description": "Search the web for up-to-date information on a topic.",
            #     "parameters": {
            #         "type": "object",
            #         "properties": {
            #             "query": {"type": "string", "description": "The search query."}
            #         },
            #         "required": ["query"],
            #     },
            # },
        ]
    }
]


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
        "tools": TOOLS,
        "system_instruction": (
            "You are an intelligent narrator assistant monitoring a live cinematic documentary experience.\n\n"
            "You run continuously in the background. The user will occasionally press Space to speak to you.\n"
            "You will receive scene context updates automatically as scenes change — use them to stay aware.\n\n"
            f"Document content:\n{context}\n\n"
            "Rules:\n"
            "- CRITICAL: Do NOT speak at session start. Do NOT greet. Do NOT introduce yourself. Stay completely silent until the user speaks to you via voice.\n"
            "- CRITICAL: When you receive a [SCENE UPDATE] message, process it silently. Do NOT respond. Do NOT confirm. Do NOT speak at all.\n"
            "- Only speak when the user directly asks you a voice question.\n"
            "- Answer voice questions concisely (2-4 sentences max).\n"
            "- Stay grounded in the document — do not invent facts.\n"
            "- Speak naturally, like a documentary narrator answering a viewer's question.\n"
            "- When the user asks about what's on screen or what image they see, call capture_screen.\n"
            "- After receiving the screen capture, describe what you see naturally and concisely.\n"
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

    stop_event = asyncio.Event()

    # Mixed input queue: bytes = mic audio | str = context text | None = sentinel
    input_queue: asyncio.Queue[bytes | str | None] = asyncio.Queue(maxsize=100)

    # Tool response queue: one dict per tool call response from the browser
    # Dict shape: {"tool": str, "call_id": str, "data": any}
    # Extend: add more shapes for future tools (e.g. search results)
    tool_response_queue: asyncio.Queue[dict | None] = asyncio.Queue()

    # ── Receive from browser ──────────────────────────────────────────────────
    async def recv_from_browser() -> None:
        try:
            while not stop_event.is_set():
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Mic audio — drop oldest chunk if lagging
                    if input_queue.full():
                        try: input_queue.get_nowait()
                        except asyncio.QueueEmpty: pass
                    input_queue.put_nowait(message["bytes"])

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type", "")

                    if msg_type == "end":
                        break

                    elif msg_type == "context":
                        # Scene context update — route to input queue as text
                        text = data.get("text", "").strip()
                        if text:
                            await input_queue.put(text)

                    elif msg_type == "frame":
                        # Tool response: screen capture JPEG (base64) from browser
                        await tool_response_queue.put({
                            "tool":    "capture_screen",
                            "call_id": data.get("call_id", ""),
                            "data":    data.get("data", ""),   # base64 JPEG
                        })

                    # ── Future tool response slot ─────────────────────────
                    # elif msg_type == "search_result":
                    #     await tool_response_queue.put({
                    #         "tool":    "google_search",
                    #         "call_id": data.get("call_id", ""),
                    #         "data":    data.get("results", []),
                    #     })

        except (WebSocketDisconnect, Exception) as exc:
            logger.info(f"Browser disconnected: {exc}")
        finally:
            await input_queue.put(None)
            await tool_response_queue.put(None)
            stop_event.set()

    # ── Forward mic audio + context text to Gemini ───────────────────────────
    async def forward_inputs(live) -> None:
        while not stop_event.is_set():
            item = await input_queue.get()
            if item is None:
                break
            if isinstance(item, bytes):
                await live.send(
                    input=types.LiveClientRealtimeInput(
                        media_chunks=[types.Blob(data=item, mime_type="audio/pcm;rate=16000")]
                    )
                )
            elif isinstance(item, str):
                await live.send(input=f"[SCENE UPDATE] {item}", end_of_turn=True)

    # ── Handle tool responses from browser ───────────────────────────────────
    async def handle_tool_responses(live) -> None:
        """
        Routes tool responses back to Gemini.
        Extend: add elif blocks for future tools.
        """
        while not stop_event.is_set():
            item = await tool_response_queue.get()
            if item is None:
                break

            tool    = item.get("tool", "")
            call_id = item.get("call_id", "")

            if tool == "capture_screen":
                b64_data = item.get("data", "")
                if b64_data:
                    try:
                        jpeg_bytes = base64.b64decode(b64_data)
                        # Send image as realtime media so Gemini can see it,
                        # then immediately close the tool call referencing it.
                        await live.send(
                            input=types.LiveClientRealtimeInput(
                                media_chunks=[types.Blob(data=jpeg_bytes, mime_type="image/jpeg")]
                            )
                        )
                        # Small yield so the image is flushed before the tool response
                        await asyncio.sleep(0.05)
                        fn_response = {
                            "result": "success",
                            "description": (
                                "The user's screen has been captured and sent to you as an image "
                                "in this same turn. Look at the image above and describe what you see."
                            ),
                        }
                    except Exception as e:
                        logger.error(f"Frame decode error: {e}")
                        fn_response = {"result": "error", "description": "Screen capture failed to decode."}
                else:
                    fn_response = {
                        "result": "unavailable",
                        "description": "The user has not shared their screen yet. Ask them to click 'Share Screen' first.",
                    }

                await live.send(
                    input=types.LiveClientToolResponse(
                        function_responses=[
                            types.FunctionResponse(
                                id=call_id,
                                name="capture_screen",
                                response=fn_response,
                            )
                        ]
                    )
                )

            # ── Future tool slot ──────────────────────────────────────────────
            # elif tool == "google_search":
            #     results = item.get("data", [])
            #     await live.send(input=types.LiveClientToolResponse(
            #         function_responses=[types.FunctionResponse(
            #             id=call_id, name="google_search",
            #             response={"results": results}
            #         )]
            #     ))

    # ── Receive from Gemini (multi-turn + tool call handling) ─────────────────
    async def forward_from_gemini(live) -> None:
        try:
            while not stop_event.is_set():
                turn = live.receive()
                async for response in turn:
                    if stop_event.is_set():
                        return

                    # Audio chunks → browser
                    if response.server_content and response.server_content.model_turn:
                        for part in response.server_content.model_turn.parts:
                            if (
                                part.inline_data
                                and isinstance(part.inline_data.data, bytes)
                                and part.inline_data.data
                            ):
                                await websocket.send_bytes(part.inline_data.data)

                    # Turn complete
                    if response.server_content and response.server_content.turn_complete:
                        await websocket.send_json({"type": "turn_complete"})

                    # Tool calls from Gemini → forward request to browser
                    if response.tool_call:
                        for fn_call in response.tool_call.function_calls:
                            if fn_call.name == "capture_screen":
                                await websocket.send_json({
                                    "type":    "tool_call",
                                    "tool":    "capture_screen",
                                    "call_id": fn_call.id,
                                })
                                logger.info("Gemini requested screen capture")

                            # ── Future tool dispatch slot ─────────────────────
                            # elif fn_call.name == "google_search":
                            #     await websocket.send_json({
                            #         "type":    "tool_call",
                            #         "tool":    "google_search",
                            #         "call_id": fn_call.id,
                            #         "args":    fn_call.args,
                            #     })

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
                handle_tool_responses(live),
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
