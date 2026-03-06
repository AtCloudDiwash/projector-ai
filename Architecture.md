# The Cinematic Narrator — System Architecture

## What It Does

Accepts any uploaded file (PDF, text, image, CSV, etc.) and a user prompt,
then transforms the content into a real-time cinematic experience:
AI-generated visuals + TTS narration + word-by-word subtitles + an always-on
Gemini Live voice agent that listens, answers questions, searches the web,
and can see the user's screen.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER (React/TS)                         │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐  │
│  │ UploadScreen │    │              PlayerScreen                │  │
│  │              │    │                                          │  │
│  │ File + Prompt│    │  SceneImage  TitleCard  CaptionHeader   │  │
│  │     ↓        │    │  SubtitleRenderer  GeminiWave           │  │
│  │  POST /upload│    │  SearchOverlay  Controls  UnlockOverlay │  │
│  └──────┬───────┘    └──────────┬──────────────────────────────┘  │
│         │                       │                                   │
│         │           ┌───────────┴────────────┐                     │
│         │           │       React Hooks       │                     │
│         │           │  useSceneQueue          │                     │
│         │           │  useAudioPlayer         │                     │
│         │           │  useNarrationRenderer   │                     │
│         │           │  useGeminiLive ─────────┼──── WebSocket ──┐  │
│         │           └────────────────────────┘                  │  │
└─────────┼──────────────────────────────────────────────────────┼──┘
          │ HTTP                                                  │ WS
          ▼                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BACKEND (FastAPI / Python)                   │
│                                                                     │
│  POST /upload ──→ narrator.py ──→ SSE stream → GET /stream/:id     │
│                                                                     │
│  WS /ws/live/:id ──→ live_agent.py ──→ Gemini Live API             │
│                                                                     │
│  main.py  firestore_client.py  storage_client.py  tts_client.py   │
│  prompts.py                                                         │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
          ┌────────────┼──────────────────────────┐
          ▼            ▼                           ▼
   ┌─────────────┐  ┌──────────────────┐   ┌────────────────┐
   │ Gemini API  │  │  Google Cloud TTS│   │ Cloud Storage  │
   │ (text+image │  │  (optional)      │   │ (optional)     │
   │  +live+web  │  └──────────────────┘   └────────────────┘
   │  search)    │
   └─────────────┘
          │
   ┌──────┴──────────┐
   │   Firestore     │
   │   (optional)    │
   └─────────────────┘
```

---

## Pipeline 1 — Scene Generation (HTTP + SSE)

```
User uploads file + prompt
         │
         ▼
POST /upload
  → validates file type & size
  → creates session_id (uuid)
  → stores file to GCS (or memory if disabled)
  → creates Firestore session doc
  → spawns asyncio background task → returns session_id immediately
         │
         ▼
Background: narrator.stream_cinematic_experience()
  │
  ├─ Step 1: Scene Breakdown
  │    Gemini 2.5 Flash (text) reads file + prompt
  │    Returns JSON: [{scene_num, title, narration, caption, visual_style, visual_prompt}]
  │
  ├─ Step 2: For each scene (parallel):
  │    ├─ Image: Gemini 2.0 Flash image-gen → base64 PNG/JPEG
  │    │         (3-model fallback chain)
  │    └─ Audio: Google Cloud TTS or gTTS fallback → base64 MP3
  │
  └─ Step 3: Emit SSE events per scene:
       scene_start → status → caption → narration_text → image → audio → scene_end
       … repeat for all scenes …
       complete

Client: GET /stream/{session_id}  (EventSource / SSE)
  useSceneQueue collects events → assembles Scene objects → feeds PlayerScreen queue
```

---

## Pipeline 2 — Gemini Live Voice Agent (WebSocket)

```
PlayerScreen mounts → useGeminiLive connects WS /ws/live/{session_id}
         │
         ▼
live_agent.run_live_relay()  runs 5 concurrent asyncio tasks:

┌─────────────────────────────────────────────────────────────────────┐
│ Task 1: recv_from_browser                                           │
│   binary frame → input_queue  (mic PCM audio)                      │
│   {"type":"context"} → input_queue  (scene text updates)           │
│   {"type":"frame"}   → tool_response_queue  (screen JPEG)          │
│   {"type":"end"}     → sentinels + stop_event                      │
└─────────────────────────────────────────────────────────────────────┘
         │ input_queue           │ tool_response_queue   │ backend_tool_queue
         ▼                       ▼                       ▼
┌──────────────────┐  ┌────────────────────┐  ┌─────────────────────┐
│ Task 2:          │  │ Task 3:            │  │ Task 4:             │
│ forward_inputs   │  │ handle_tool_       │  │ handle_backend_     │
│                  │  │ responses          │  │ tools               │
│ bytes → Gemini   │  │                    │  │                     │
│   PCM audio      │  │ capture_screen:    │  │ web_search:         │
│ str → Gemini     │  │  decode JPEG →     │  │  execute_web_search │
│   [SCENE UPDATE] │  │  send image →      │  │  → send             │
│   end_of_turn=T  │  │  LiveClientTool    │  │  search_result      │
│                  │  │  Response          │  │  to browser +       │
│                  │  │                    │  │  LiveClientTool     │
│                  │  │                    │  │  Response to Gemini │
└──────────────────┘  └────────────────────┘  └─────────────────────┘
         │                       ▲                       ▲
         └───────────────────────┤                       │
                                 │                       │
┌─────────────────────────────────────────────────────────────────────┐
│ Task 5: forward_from_gemini                                         │
│   response.server_content.model_turn.parts → send PCM audio binary │
│   response.server_content.turn_complete    → {"type":"turn_complete"}│
│   response.tool_call:                                               │
│     capture_screen → {"type":"tool_call","tool":"capture_screen"}  │
│     web_search     → backend_tool_queue                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Browser Side of Gemini Live

```
useGeminiLive (hook)
  │
  ├─ ws.onopen
  │    ScriptProcessorNode (4096 samples)
  │    onaudioprocess: if (!muted) downsample nativeRate→16kHz → send Int16 binary
  │
  ├─ ws.onmessage (binary) → PCM 24kHz Int16 → AudioContext → scheduled playback
  │    nextPlayTimeRef prevents audio chunk overlap
  │
  ├─ ws.onmessage (text)
  │    ready         → setIsConnected(true)
  │    turn_complete → reset nextPlayTime, set mode idle/listening after 400ms
  │    tool_call:
  │      capture_screen → captureFrame() → video element → canvas → JPEG base64
  │                     → ws.send({"type":"frame","data":...,"call_id":...})
  │    search_result → setSearchResult({query, summary, sources})
  │    error         → disconnect()
  │
  ├─ toggleMic()  → flips micMutedRef (no re-render) + setIsMicActive
  ├─ sendContext() → ws.send({"type":"context","text":...})  [guarded by hasSpokenRef]
  ├─ shareScreen() → getDisplayMedia(preferCurrentTab) → stored in screenStreamRef
  └─ clearSearchResult() → setSearchResult(null)
```

---

## Tool System

| Tool | Handled by | Trigger |
|------|-----------|---------|
| `capture_screen` | Browser + Backend relay | User asks about screen content |
| `web_search` | Backend only (Gemini grounded search) | User asks about real-world facts/events |

### capture_screen flow
```
Gemini Live → tool_call(capture_screen)
  → Task 5 sends {"type":"tool_call"} to browser
  → Browser: captureFrame() grabs 1 JPEG frame via <video> element
  → Browser: ws.send({"type":"frame", "data":"<base64>", "call_id":"..."})
  → Task 1 routes to tool_response_queue
  → Task 3: decode JPEG → LiveClientRealtimeInput(image/jpeg) → 50ms yield
           → LiveClientToolResponse → Gemini describes image aloud
```

### web_search flow
```
Gemini Live → tool_call(web_search, {query: "..."})
  → Task 5 puts into backend_tool_queue
  → Task 4: execute_web_search(client, query)
           → client.aio.models.generate_content(gemini-2.5-flash,
               tools=[Tool(google_search=GoogleSearch())])
           → extracts response.text (summary)
           → extracts grounding_metadata.grounding_chunks (sources)
  → sends {"type":"search_result", query, summary, sources} to browser
  → sends LiveClientToolResponse to Gemini → Gemini speaks summary aloud
  → Browser: SearchOverlay appears with summary + clickable source links
```

---

## Data Flow — Scene Playback

```
SSE events arrive → useSceneQueue assembles PendingScene objects
                  → queue fills up
PlayerScreen.tryPlayNext()
  → checks: audioUnlocked, !isDisplaying, !isMicActive, !Gemini speaking
  → popScene() from queue
  → plays audio (useAudioPlayer) + renders subtitles (useNarrationRenderer)
  → on scene done: 1s pause → tryPlayNext()

Gemini Live interrupts:
  isMicActive OR mode==='speaking'
    → audio.pause() + narrator.stop()
  returns to idle
    → audio.resume()
```

---

## File Reference

### Backend

| File | Role | Key Parts |
|------|------|-----------|
| `main.py` | FastAPI app entry point | `POST /upload` → starts narrator task; `GET /stream/:id` → SSE endpoint; `WS /ws/live/:id` → Gemini Live relay; static file serving (`FRONTEND_VERSION=v2` for React build) |
| `narrator.py` | Core scene generation agent | `stream_cinematic_experience()` async generator; `_get_scene_breakdown()` calls Gemini text model; `_generate_scene_image()` with 3-model fallback chain; parallel image+audio tasks per scene |
| `live_agent.py` | Gemini Live WebSocket relay | `TOOLS` list (capture_screen + web_search); `execute_web_search()` with Google Search grounding; `run_live_relay()` with 5 concurrent asyncio tasks; `backend_tool_queue` for server-side tool execution |
| `prompts.py` | Gemini prompt templates | `SCENE_BREAKDOWN_PROMPT` (file → JSON scenes); `SCENE_IMAGE_PROMPT` (scene → image generation prompt) |
| `tts_client.py` | Text-to-speech wrapper | Google Cloud TTS primary; gTTS fallback; returns base64 MP3 |
| `storage_client.py` | Google Cloud Storage wrapper | `upload_file_bytes()` for input files; `upload_image_base64()` for generated images; falls back to data-URI if GCS disabled |
| `firestore_client.py` | Firestore session persistence | `create_session()`, `get_session()`, `append_scene()`, `complete_session()`; stores scene manifests so Gemini Live has full document context |
| `requirements.txt` | Python dependencies | `google-genai`, `fastapi`, `uvicorn`, `google-cloud-texttospeech`, `google-cloud-firestore`, `google-cloud-storage`, `gtts`, `python-dotenv` |
| `Dockerfile` | Container definition | Python 3.12 slim; installs deps; runs uvicorn on PORT env var |
| `cloudbuild.yaml` | Cloud Build CI/CD | Builds Docker image → pushes to Artifact Registry → deploys to Cloud Run |

### Frontend (`frontend-2/src/`)

| File | Role | Key Parts |
|------|------|-----------|
| `App.tsx` | Root component + screen router | Manages `appScreen` state (`upload → loading → player`); owns `sessionId`; wires `useSceneQueue` |
| `types.ts` | Shared TypeScript types | `Scene`, `PendingScene`, `SSEEventType`, `GeminiWaveMode`, `SearchResult` |
| `main.tsx` | React entry point | Mounts `<App>` into DOM |
| `index.css` | Global styles | Tailwind base; `@keyframes word-in` (subtitle animation — defined here to avoid Tailwind tree-shaking); film grain, vignette, gold pulse utilities |

#### Components

| Component | Role | Key Parts |
|-----------|------|-----------|
| `PlayerScreen.tsx` | Main cinematic player | Owns all playback state; wires `useAudioPlayer`, `useNarrationRenderer`, `useGeminiLive`; `tryPlayNext()` scene advance logic; `handleMicToggle()` with `hasSpokenRef` guard; pause/resume on mic+speaking; top status bar; bottom control bar |
| `UploadScreen.tsx` | File upload UI | File picker + prompt input; calls `POST /upload` → returns session_id |
| `LoadingScreen.tsx` | SSE consumer + loading UI | Opens `EventSource /stream/:id`; fires `onScene()` callbacks as events arrive |
| `SearchOverlay.tsx` | Web search result UI | Semi-transparent dark panel (`bg-zinc-950/88 backdrop-blur`); query label, summary text, clickable source links; ✕ close button; appears on `search_result` WS message |
| `GeminiWave.tsx` | Audio activity visualizer | Animated waveform bars; active when `isMicActive` or `mode==='speaking'` |
| `SceneImage.tsx` | Full-bleed scene image | Crossfade transitions between scenes |
| `TitleCard.tsx` | Centered scene title | Fade-in/out animation |
| `CaptionHeader.tsx` | Key insight text overlay | Gold-tinted top caption |
| `SubtitleRenderer.tsx` | Word-by-word subtitle | `forwardRef` pure DOM container; words injected directly via `useNarrationRenderer` for performance |
| `Controls.tsx` | Back + Replay buttons | Hover-only visibility (`group-hover:opacity-100`); top-right corner |
| `UnlockOverlay.tsx` | Audio context unlock gate | Shown on mount; dismissed by user click which calls `AudioContext.resume()` |
| `ErrorToast.tsx` | Error notification | Temporary toast for upload/stream errors |

#### Hooks

| Hook | Role | Key Parts |
|------|------|-----------|
| `useGeminiLive.ts` | Gemini Live WebSocket session | Auto-connects on `sessionId`; `isConnectingRef` prevents duplicate sessions; `micMutedRef` instant mute (no re-render); manual 16kHz downsampling in `onaudioprocess`; sequential audio playback via `nextPlayTimeRef`; `captureFrame()` via hidden `<video>` element; `searchResult` state; tool dispatch for `capture_screen` + `search_result` |
| `useAudioPlayer.ts` | Scene audio playback | HTMLAudioElement wrapper; `play()`, `pause()`, `resume()`, `stop()`, `replayCurrent()`, `audioUnlocked` state |
| `useNarrationRenderer.ts` | Word-by-word subtitle animation | Splits narration into words; schedules each word's DOM insertion at proportional time offsets across audio duration |
| `useSceneQueue.ts` | SSE → scene queue | Parses SSE events; accumulates `PendingScene` fields; pushes complete `Scene` objects into a queue; exposes `queueSize`, `popScene()`, `totalScenes` |

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | — | Required. Powers all Gemini calls (text, image, live, web search) |
| `FRONTEND_VERSION` | `v1` | Set to `v2` to serve the React/TS build from `backend/static_v2/` |
| `USE_CLOUD_TTS` | `false` | Enable Google Cloud Text-to-Speech (falls back to gTTS) |
| `USE_CLOUD_STORAGE` | `false` | Enable GCS for file + image storage (falls back to in-memory data URIs) |
| `USE_FIRESTORE` | `false` | Enable Firestore session persistence (falls back to in-memory dict) |
| `PORT` | `8080` | uvicorn listen port |
| `CORS_ORIGINS` | `http://localhost:8080,...` | Allowed CORS origins |

---

## Models Used

| Model | Used For |
|-------|----------|
| `gemini-2.5-flash` | Scene breakdown (text), web search grounding |
| `gemini-2.0-flash-exp-image-generation` | Scene image generation (primary) |
| `gemini-2.5-flash-image` | Scene image generation (fallback 1) |
| `gemini-2.5-flash-native-audio-latest` | Gemini Live voice agent (always-on) |
| Google Cloud TTS / gTTS | Scene narration audio |

---

## Key Design Decisions

**Always-on Live session** — Gemini Live connects when the player mounts, not when the user presses Space. Space only mutes/unmutes the mic. This means Gemini has full memory across all turns in a session.

**`hasSpokenRef` guard** — Scene context is NOT sent to Gemini on auto-play until the user has pressed Space at least once. This prevents Gemini from speaking unprompted during scene playback.

**`micMutedRef` not state** — Mic mute is a `useRef` so `onaudioprocess` (called 60×/sec) can check it without causing React re-renders.

**Backend tool queue separation** — `tool_response_queue` handles browser-side tools (capture_screen). `backend_tool_queue` handles server-side tools (web_search). Clean separation means adding new tools doesn't touch existing paths.

**Sequential audio scheduling** — Gemini Live sends many small PCM chunks. `nextPlayTimeRef` chains them end-to-end via `AudioContext.createBufferSource().start(scheduledTime)` to prevent gaps or overlaps.

**Screen capture via `<video>` element** — `ImageCapture.grabFrame()` is unreliable on tab-capture streams. A hidden `<video>` element + `requestAnimationFrame` + canvas draw is used instead.
