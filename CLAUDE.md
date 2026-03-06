## ⚠️ Behavior Rules for Claude Code
- Do NOT build or generate code unless explicitly told to.
- Always present a plan first and wait for approval before acting.
- Never modify existing files unless the user specifically names them.
- If unsure about scope, ask before acting.

---

## Project Context
I am participating in the **Gemini Live Agent Challenge**, under the 
**Creative Storyteller** category — focused on multimodal storytelling 
with interleaved output. The goal is to move beyond "text-in/text-out" 
interactions and create an immersive, real-time experience where the AI 
acts as a **creative director**.

---

## Project Vision: "The Cinematic Narrator"
An agent that accepts **any uploaded file** (text reports, story outlines, 
PDFs, data files, etc.) and a **user prompt**, and transforms the content 
into a dynamic, **cinematic multimedia experience**.

### The Experience
- Not a static video or a slide deck.
- A fluid, real-time stream that weaves together:
  - **AI-generated visuals** — styled images, poster-like compositions, 
    or scene illustrations that best represent the content 
    (style is context-driven: could be cinematic, infographic, 
    documentary, dramatic — not limited to manga).
  - **Audio narration** — a voice that walks the user through the content.
  - **On-screen text** — captions, highlights, and key points overlaid 
    on the visuals.
- The visual style adapts to the content and the user's prompt. 
  A scientific report might produce clean infographic-style panels. 
  A fantasy story might produce dramatic painted scenes. 
  A news article might produce bold editorial poster compositions.

### Key Feature
It should feel like a **live, interactive film** — context-aware and 
driven by Gemini's native capability to blend media types into a single, 
seamless output stream.

---

## Technical Constraints & Requirements
1. **Model:** Gemini 1.5 Pro (Google GenAI SDK or ADK).
2. **SDK:** Google GenAI SDK or Agent Development Kit (ADK).
3. **Interleaved Output:** Must use Gemini's native interleaved/mixed 
   output — images, audio, and text generated in a cohesive flow, 
   not separate sequential calls.
4. **Google Cloud:** Backend hosted on Cloud Run. Must integrate at least 
   one additional service: Cloud Storage (input files + generated assets) 
   and/or Firestore (scene manifests).
5. **Judging Focus:** Demonstrate Innovation & Multimodal UX — break the 
   "text box" paradigm. The experience must feel "Live", not turn-based.

---

## Your Tasks (in order, plan before building)
1. **System Architecture** — How Gemini, GenAI SDK/ADK, and Google Cloud 
   services interact to process any uploaded file and stream interleaved 
   visuals and audio.
2. **Implementation Strategy** — Logic for handling interleaved output so 
   visuals and audio narration are synchronized in a cohesive flow.
3. **Grounding** — Ensure the agent stays grounded in the uploaded file 
   and user prompt to avoid hallucinations while remaining visually creative.