# The Cinematic Narrator

> Transform any document into a live, cinematic multimedia experience — powered by Gemini 2.0 Flash.

Built for the **Gemini Live Agent Challenge** (Creative Storyteller category).

---

## What It Does

Upload any file (PDF, text, CSV, image, markdown...) + describe the story you want told.
The agent analyzes the content, breaks it into cinematic scenes, and streams:

- **AI-generated scene visuals** (Gemini 2.0 Flash image generation)
- **Voice narration** (Google Cloud TTS)
- **On-screen captions** and title cards
- All delivered as a **live SSE stream** — not a pre-rendered video

The result feels like a live interactive film, not a slideshow.

---

## Architecture

```
User Browser
    │
    │  POST /upload (file + prompt)
    ▼
FastAPI on Cloud Run
    │
    ├── Cloud Storage ──── store raw upload + generated images
    ├── Firestore ───────── session manifest (scene order, metadata)
    │
    └── Gemini 2.0 Flash
            ├── TEXT model ──── scene breakdown (JSON)
            └── IMAGE model ─── per-scene visuals (interleaved TEXT+IMAGE)
                    │
                    └── Google Cloud TTS ── narration audio (MP3)
    │
    │  GET /stream/{session_id} (SSE)
    ▼
Browser Player
    ├── Crossfading full-screen images (Ken Burns effect)
    ├── Audio narration playback
    └── Animated captions + title cards
```

---

## Quick Start (Local)

### 1. Clone & configure

```bash
cd backend
cp ../.env .env
# Edit .env and fill in: GEMINI_API_KEY (minimum required)
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the server

```bash
python main.py
```

### 4. Open in browser

Navigate to `http://localhost:8080`

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | From Google AI Studio |
| `GOOGLE_CLOUD_PROJECT` | For GCS/Firestore/TTS | Your GCP project ID |
| `GCS_BUCKET_NAME` | If `USE_CLOUD_STORAGE=true` | Cloud Storage bucket name |
| `FIRESTORE_COLLECTION` | If `USE_FIRESTORE=true` | Firestore collection name |
| `GOOGLE_APPLICATION_CREDENTIALS` | For cloud services | Path to service account JSON |
| `USE_CLOUD_STORAGE` | No (default: false) | Enable GCS for file/image storage |
| `USE_FIRESTORE` | No (default: false) | Enable Firestore for session manifests |
| `USE_CLOUD_TTS` | No (default: false) | Enable Google Cloud TTS for audio |

**Minimum to run locally:** Only `GEMINI_API_KEY` is required. Images are delivered inline, audio is skipped unless TTS is enabled.

---

## Deploy to Cloud Run

See [SETUP.md](SETUP.md) for the complete step-by-step Google Cloud setup guide.

```bash
# Quick deploy
gcloud run deploy cinematic-narrator \
  --source ./backend \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --set-env-vars GEMINI_API_KEY=your-key,GOOGLE_CLOUD_PROJECT=your-project
```

---

## SSE Event Reference

The stream emits JSON events:

| Event Type | Payload | Description |
|---|---|---|
| `status` | `{message, progress}` | Progress update |
| `scene_start` | `{scene_num, total_scenes, title, visual_style}` | New scene begins |
| `image` | `{scene_num, data?, url?, mime_type, delivery}` | Scene visual |
| `caption` | `{scene_num, text}` | On-screen caption |
| `narration_text` | `{scene_num, text}` | Narration script |
| `audio` | `{scene_num, data, mime_type}` | Base64 MP3 narration |
| `scene_end` | `{scene_num, progress}` | Scene complete |
| `complete` | `{session_id, total_scenes}` | Full experience done |
| `error` | `{message}` | Error occurred |

---

## Tech Stack

- **Model:** Gemini 2.0 Flash (text + image generation)
- **Backend:** Python 3.12 / FastAPI / uvicorn
- **Streaming:** Server-Sent Events (SSE)
- **Audio:** Google Cloud Text-to-Speech
- **Storage:** Google Cloud Storage
- **State:** Firestore
- **Hosting:** Cloud Run
- **Frontend:** Vanilla JS + CSS (no build step)
