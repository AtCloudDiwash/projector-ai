"""
Text-to-Speech client for The Cinematic Narrator.
Uses Google Cloud TTS when enabled, otherwise returns empty audio.
"""

import os
import base64
import logging

logger = logging.getLogger(__name__)

USE_CLOUD_TTS = os.getenv("USE_CLOUD_TTS", "false").lower() == "true"

_tts_client = None


def _get_client():
    global _tts_client
    if _tts_client is None:
        from google.cloud import texttospeech
        _tts_client = texttospeech.TextToSpeechClient()
    return _tts_client


def synthesize_narration(text: str, voice_style: str = "cinematic") -> str:
    """
    Synthesize speech from text. Returns base64-encoded MP3.
    Falls back to empty string if TTS is disabled or fails.

    voice_style: cinematic | documentary | dramatic
    """
    if not USE_CLOUD_TTS:
        logger.info("Cloud TTS disabled — skipping audio synthesis.")
        return ""

    # Voice selection based on style
    voice_name_map = {
        "cinematic": "en-US-Neural2-J",    # Deep, warm male voice
        "documentary": "en-US-Neural2-D",  # Clear, authoritative
        "dramatic": "en-US-Neural2-F",     # Expressive female
        "editorial": "en-US-Neural2-A",    # Neutral, professional
    }
    voice_name = voice_name_map.get(voice_style, "en-US-Neural2-J")

    try:
        from google.cloud import texttospeech

        client = _get_client()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(
            language_code="en-US",
            name=voice_name,
        )
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=0.90,      # Slightly slower for cinematic feel
            pitch=-1.0,              # Slightly lower pitch
            effects_profile_id=["headphone-class-device"],
        )
        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config,
        )
        audio_b64 = base64.b64encode(response.audio_content).decode("utf-8")
        logger.info(f"Synthesized {len(text)} chars of narration.")
        return audio_b64
    except Exception as e:
        logger.error(f"TTS synthesis failed: {e}")
        return ""
