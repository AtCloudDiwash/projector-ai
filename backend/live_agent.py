"""
Gemini Live Agent relay — always-on, context-aware, tool-enabled.

Streams:
  Browser → Server  binary: PCM Int16 16kHz mic audio (when mic unmuted)
  Browser → Server  JSON:   context updates | screen_frame (continuous 1fps JPEG)
  Server  → Browser binary: PCM Int16 24kHz Gemini voice
  Server  → Browser JSON:   ready | turn_complete | search_result | error

Tools:
  web_search — Gemini calls it → backend executes Gemini grounded search → returns summary+sources
               to both Gemini (LiveClientToolResponse) and browser (search_result JSON)
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
LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"

# ── Tool definitions ──────────────────────────────────────────────────────────
TOOLS = [
    {
        "function_declarations": [
            {
                "name": "web_search",
                "description": (
                    "Search the web for current, factual information on any topic. "
                    "Call this when the user asks about recent events, real-world facts, statistics, "
                    "people, places, or anything that benefits from up-to-date web sources."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "A concise search query.",
                        }
                    },
                    "required": ["query"],
                },
            },
        ]
    }
]

# ── Tools execution──────────────────────────────────────────────────────────


async def execute_web_search(client: genai.Client, query: str) -> dict:
    """
    Run a Gemini generate_content call with Google Search grounding.
    Returns {"summary": str, "sources": [{"title": str, "url": str}]}.
    """
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=(
                f"Search the web for reliable information about '{query}'. "
                "Return a concise factual summary (5-7 bullet points). "
                "Include key facts, numbers, dates, and recent developments. "
                "Avoid speculation and opinions."
            ),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0.1,
            ),
        )

        summary = response.text or "No results found."
        sources: list[dict] = []

        if response.candidates:
            gm = response.candidates[0].grounding_metadata
            if gm and gm.grounding_chunks:
                seen: set[str] = set()
                for chunk in gm.grounding_chunks:
                    web = getattr(chunk, "web", None)
                    if web and getattr(web, "uri", None):
                        url = web.uri
                        if url not in seen:
                            seen.add(url)
                            sources.append(
                                {
                                    "title": getattr(web, "title", None) or url,
                                    "url": url,
                                }
                            )
                        if len(sources) >= 5:
                            break

        return {"summary": summary, "sources": sources}

    except Exception as exc:
        logger.error(f"execute_web_search error: {exc}")
        return {"summary": f"Search failed: {exc}", "sources": []}


# ── Context builder ──────────────────────────────────────────────────────────


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


# ── Gemini Live Agent's task: Each time the function is called gemini agent executes the tasks defined in this function  ──────────────────────────────────────────────────────────


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
            "- If the user says anything like 'stop', 'enough', 'ok thanks', 'that's all', 'quiet', or any signal they want silence — stop speaking immediately and go completely silent. Do not respond or acknowledge. Wait until they speak to you again.\n"
            "- Answer voice questions concisely (2-4 sentences max). Donot over explain unless and untill you are asked to do so.\n"
            "- Stay grounded in the document and your knowledge— do not invent facts.\n"
            "- Speak naturally, like a documentary narrator answering a viewer's question.\n"
            "- You continuously receive the user's screen as image frames. Use them to answer any question about what's on their screen naturally and concisely.\n"
            "- When the user asks about real-world facts, current events, people, places, or anything requiring web knowledge, call web_search.\n"
            "- After a web_search result is returned, summarize the key facts concisely in your voice response.\n"
            "- If asked something unrelated, gently redirect to the content."
        ),
        "speech_config": {
            "voice_config": {"prebuilt_voice_config": {"voice_name": "Charon"}}
        },
    }

    client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options={"api_version": "v1beta"},
    )

    stop_event = asyncio.Event()

    # ── Queues definition for each category ──────────────────────────────────────────────────────────────────

    # Mixed input queue: bytes = mic audio | str = context text | None = sentinel
    input_queue: asyncio.Queue[bytes | str | None] = asyncio.Queue(maxsize=100)

    # Screen frame queue: browser → backend continuous JPEG frames
    screen_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=4)

    # Backend tool queue: Gemini tool calls handled entirely on the backend (e.g. web_search)
    backend_tool_queue: asyncio.Queue[dict | None] = asyncio.Queue()

    # ── Receive from browser: this function listens to the browser for the type of input and puts the appropriate input category to its respective queue ──────────────────────────────────────────────────
    async def recv_from_browser() -> None:
        try:
            while not stop_event.is_set():
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Mic audio — drop oldest chunk if lagging
                    if input_queue.full():
                        try:
                            input_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
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

                    elif msg_type == "screen_frame":
                        # Continuous screen frame: decode and queue for Gemini
                        b64 = data.get("data", "")
                        if b64:
                            try:
                                jpeg_bytes = base64.b64decode(b64)
                                # Drop oldest frame if queue is full (non-blocking)
                                if screen_queue.full():
                                    try:
                                        screen_queue.get_nowait()
                                    except asyncio.QueueEmpty:
                                        pass
                                screen_queue.put_nowait(jpeg_bytes)
                            except Exception as e:
                                logger.warning(f"screen_frame decode error: {e}")

        except (WebSocketDisconnect, Exception) as exc:
            logger.info(f"Browser disconnected: {exc}")
        finally:
            await input_queue.put(None)
            await screen_queue.put(None)
            await backend_tool_queue.put(None)
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
                        media_chunks=[
                            types.Blob(data=item, mime_type="audio/pcm;rate=16000")
                        ]
                    )
                )
            elif isinstance(item, str):
                await live.send(input=f"[SCENE UPDATE] {item}", end_of_turn=True)

    # ── Forward continuous screen frames to Gemini ────────────────────────────
    async def forward_screen_frames(live) -> None:
        while not stop_event.is_set():
            item = await screen_queue.get()
            if item is None:
                break
            await live.send(
                input=types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(data=item, mime_type="image/jpeg")
                    ]
                )
            )

    # ── Handle backend-side tool calls (web_search executed here, not browser) ─
    async def handle_backend_tools(live) -> None:
        while not stop_event.is_set():
            item = await backend_tool_queue.get()
            if item is None:
                break

            if item.get("name") == "web_search":
                call_id = item["call_id"]
                query = item["args"].get("query", "")
                logger.info(f"Executing web_search: {query!r}")

                # Notify browser that search is in progress
                try:
                    await websocket.send_json({"type": "searching", "query": query})
                except Exception:
                    pass

                result = await execute_web_search(client, query)

                # Send search result to browser for the UI overlay
                try:
                    await websocket.send_json(
                        {
                            "type": "search_result",
                            "query": query,
                            "summary": result["summary"],
                            "sources": result["sources"],
                        }
                    )
                except Exception as exc:
                    logger.warning(f"Failed to send search_result to browser: {exc}")

                # Return result to Gemini so it can speak its summary
                await live.send(
                    input=types.LiveClientToolResponse(
                        function_responses=[
                            types.FunctionResponse(
                                id=call_id,
                                name="web_search",
                                response={
                                    "summary": result["summary"],
                                    "sources": [s["url"] for s in result["sources"]],
                                },
                            )
                        ]
                    )
                )

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
                    if (
                        response.server_content
                        and response.server_content.turn_complete
                    ):
                        await websocket.send_json({"type": "turn_complete"})

                    # Tool calls from Gemini → dispatch by tool name
                    if response.tool_call:
                        for fn_call in response.tool_call.function_calls:
                            if fn_call.name == "web_search":
                                # Backend-side tool: handle entirely on server
                                await backend_tool_queue.put(
                                    {
                                        "name": "web_search",
                                        "call_id": fn_call.id,
                                        "args": dict(fn_call.args)
                                        if fn_call.args
                                        else {},
                                    }
                                )
                                logger.info(
                                    f"Gemini requested web_search: {fn_call.args}"
                                )

        except Exception as exc:
            logger.error(f"Gemini receive error: {exc}")
        finally:
            stop_event.set()

    try:
        # Gemini live client

        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as live:
            logger.info(f"Gemini Live session opened (model={LIVE_MODEL})")
            await websocket.send_json({"type": "ready"})

            await asyncio.gather(
                recv_from_browser(),
                forward_inputs(live),
                forward_screen_frames(live),
                handle_backend_tools(live),
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
