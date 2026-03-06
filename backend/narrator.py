"""
Core Cinematic Narrator agent.

Orchestrates Gemini 2.0 Flash to produce interleaved text + image output,
then synthesizes audio via TTS, streaming all events to the frontend.
"""

import os
import json
import base64
import logging
import asyncio
import uuid
import mimetypes
from typing import AsyncGenerator

from google import genai
from google.genai import types

from prompts import SCENE_BREAKDOWN_PROMPT, SCENE_IMAGE_PROMPT
from tts_client import synthesize_narration
from storage_client import upload_image_base64
from firestore_client import create_session, append_scene, complete_session

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
IMAGE_MODELS = [
    "gemini-2.0-flash-exp-image-generation",  # primary
    "gemini-2.5-flash-image",                  # fallback 1
    "gemini-3.1-flash-image-preview",          # fallback 2
]
TEXT_MODEL = "gemini-2.5-flash"
NUM_SCENES = 5

_gemini_client: genai.Client | None = None


def _get_gemini() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set in environment variables.")
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


def _extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """Extract text content from uploaded file bytes."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext in ("txt", "md", "csv", "json", "yaml", "yml", "xml", "html", "htm"):
        try:
            return file_bytes.decode("utf-8", errors="replace")
        except Exception:
            return file_bytes.decode("latin-1", errors="replace")

    # For PDFs and other binary formats, pass raw bytes to Gemini via inline_data
    return None  # Signal to use inline_data path


def _build_gemini_contents_for_breakdown(
    file_bytes: bytes,
    filename: str,
    user_prompt: str,
    num_scenes: int,
) -> list:
    """Build the contents list for the scene breakdown call."""
    text_content = _extract_text_from_file(file_bytes, filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "txt"
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    prompt_text = SCENE_BREAKDOWN_PROMPT.format(
        user_prompt=user_prompt,
        content=text_content if text_content is not None else "[Binary file — see attached]",
        num_scenes=num_scenes,
    )

    if text_content is not None:
        return [prompt_text]
    else:
        # Pass binary file inline (PDF, images, etc.)
        return [
            types.Part.from_bytes(data=file_bytes, mime_type=mime),
            prompt_text,
        ]


def _clean_json(raw: str) -> str:
    """Strip markdown fences and extract the JSON array from Gemini output."""
    raw = raw.strip()
    # Remove markdown code fences
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()
    # Find the outermost JSON array
    start = raw.find("[")
    end   = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        raw = raw[start:end + 1]
    return raw


async def _get_scene_breakdown(
    client: genai.Client,
    file_bytes: bytes,
    filename: str,
    user_prompt: str,
) -> list[dict]:
    """Ask Gemini to break the content into cinematic scenes."""
    contents = _build_gemini_contents_for_breakdown(
        file_bytes, filename, user_prompt, NUM_SCENES
    )

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: client.models.generate_content(
            model=TEXT_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT"],
                temperature=0.7,
                max_output_tokens=16384,  # large enough for 5-scene JSON
            ),
        ),
    )

    raw = _clean_json(response.text or "")
    scenes = json.loads(raw)
    logger.info(f"Got {len(scenes)} scenes from Gemini.")
    return scenes


async def _generate_scene_image(
    client: genai.Client,
    scene: dict,
) -> tuple[str, str]:
    """
    Generate an image for a scene using Gemini 2.0 Flash image generation.
    Returns (base64_image_data, mime_type).
    """
    image_prompt = SCENE_IMAGE_PROMPT.format(
        visual_style=scene.get("visual_style", "cinematic"),
        title=scene.get("title", ""),
        visual_prompt=scene.get("visual_prompt", ""),
    )

    loop = asyncio.get_event_loop()
    last_error = None

    for model in IMAGE_MODELS:
        try:
            response = await loop.run_in_executor(
                None,
                lambda m=model: client.models.generate_content(
                    model=m,
                    contents=image_prompt,
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE", "TEXT"],
                        temperature=1.0,
                    ),
                ),
            )

            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    img_data = part.inline_data.data
                    mime_type = part.inline_data.mime_type or "image/png"
                    if isinstance(img_data, bytes):
                        img_b64 = base64.b64encode(img_data).decode("utf-8")
                    else:
                        img_b64 = img_data
                    logger.info(f"Generated image via {model} for scene '{scene.get('title')}'")
                    return img_b64, mime_type

            logger.warning(f"No image part from {model} for scene '{scene.get('title')}'")
            last_error = "no image part in response"

        except Exception as e:
            logger.warning(f"Image model {model} failed: {e} — trying next")
            last_error = e

    logger.error(f"All image models failed for scene '{scene.get('title')}': {last_error}")
    return None, None


def _sse(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event string."""
    payload = json.dumps({"type": event_type, **data})
    return f"data: {payload}\n\n"


async def stream_cinematic_experience(
    session_id: str,
    file_bytes: bytes,
    filename: str,
    user_prompt: str,
) -> AsyncGenerator[str, None]:
    """
    Main async generator that yields SSE strings for the full cinematic experience.

    Event types emitted:
      - status        : progress messages
      - scene_start   : beginning of a new scene
      - image         : base64-encoded scene image
      - caption       : on-screen text overlay
      - narration_text: the narration script (for display)
      - audio         : base64-encoded MP3 narration audio
      - scene_end     : scene complete
      - complete      : full experience done
      - error         : something went wrong
    """
    try:
        client = _get_gemini()

        yield _sse("status", {"message": "Analyzing your content...", "progress": 5})

        # --- Scene Breakdown ---
        try:
            scenes = await _get_scene_breakdown(client, file_bytes, filename, user_prompt)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse scene JSON: {e}")
            yield _sse("error", {"message": "Failed to parse scene breakdown from Gemini. Try again."})
            return
        except Exception as e:
            logger.error(f"Scene breakdown failed: {e}")
            yield _sse("error", {"message": f"Scene breakdown error: {str(e)}"})
            return

        total_scenes = len(scenes)
        yield _sse("status", {
            "message": f"Creating {total_scenes} cinematic scenes...",
            "progress": 10,
            "total_scenes": total_scenes,
        })

        # --- Process Each Scene ---
        for idx, scene in enumerate(scenes):
            scene_num = scene.get("scene_num", idx + 1)
            title = scene.get("title", f"Scene {scene_num}")
            narration = scene.get("narration", "")
            caption = scene.get("caption", "")
            visual_style = scene.get("visual_style", "cinematic")

            progress_base = 10 + int((idx / total_scenes) * 85)

            yield _sse("scene_start", {
                "scene_num": scene_num,
                "total_scenes": total_scenes,
                "title": title,
                "visual_style": visual_style,
            })

            yield _sse("status", {
                "message": f"Generating visuals for scene {scene_num}: {title}...",
                "progress": progress_base + 5,
            })

            # --- Generate Image & Audio in parallel ---
            img_task = asyncio.create_task(_generate_scene_image(client, scene))
            tts_task = asyncio.get_event_loop().run_in_executor(
                None, synthesize_narration, narration, visual_style
            )

            img_b64, img_mime = await img_task
            audio_b64 = await tts_task

            # --- Emit Caption ---
            if caption:
                yield _sse("caption", {"text": caption, "scene_num": scene_num})

            # --- Emit Narration Text ---
            if narration:
                yield _sse("narration_text", {"text": narration, "scene_num": scene_num})

            # --- Emit Image ---
            if img_b64:
                # Upload to GCS if enabled, else send inline
                img_url = upload_image_base64(img_b64, session_id, scene_num)
                # If returned as data URL, send inline; if GCS URL, send reference
                if img_url.startswith("data:"):
                    yield _sse("image", {
                        "scene_num": scene_num,
                        "data": img_b64,
                        "mime_type": img_mime or "image/png",
                        "delivery": "inline",
                    })
                else:
                    yield _sse("image", {
                        "scene_num": scene_num,
                        "url": img_url,
                        "delivery": "url",
                    })
            else:
                yield _sse("image", {
                    "scene_num": scene_num,
                    "data": None,
                    "delivery": "none",
                })

            # --- Emit Audio ---
            if audio_b64:
                yield _sse("audio", {
                    "scene_num": scene_num,
                    "data": audio_b64,
                    "mime_type": "audio/mpeg",
                })

            # --- Save scene to Firestore ---
            scene_manifest = {
                "scene_num": scene_num,
                "title": title,
                "narration": narration,
                "caption": caption,
                "visual_style": visual_style,
            }
            append_scene(session_id, scene_manifest)

            yield _sse("scene_end", {
                "scene_num": scene_num,
                "progress": progress_base + 15,
            })

            # Small pause between scenes for smoother streaming feel
            await asyncio.sleep(0.1)

        # --- Complete ---
        complete_session(session_id)
        yield _sse("complete", {
            "session_id": session_id,
            "total_scenes": total_scenes,
            "message": "Your cinematic experience is ready.",
            "progress": 100,
        })

    except Exception as e:
        logger.exception(f"Unhandled error in cinematic stream: {e}")
        yield _sse("error", {"message": f"Unexpected error: {str(e)}"})
