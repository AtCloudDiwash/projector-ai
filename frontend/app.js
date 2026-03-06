/**
 * The Cinematic Narrator — Frontend Player
 *
 * Handles:
 * - File upload + prompt submission
 * - SSE event stream consumption
 * - Cinematic player: image crossfade, audio narration, captions, title cards
 */

'use strict';

// ─── State ───────────────────────────────────────────────
const state = {
  file: null,
  sessionId: null,
  eventSource: null,
  currentScene: 0,
  totalScenes: 0,
  activeImageSlot: 'a',   // 'a' or 'b' for crossfade
  audioQueue: [],
  isPlaying: false,
  currentAudio: null,
  lastNarration: '',
};

// ─── DOM refs ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const uploadScreen   = $('upload-screen');
const loadingScreen  = $('loading-screen');
const playerScreen   = $('player-screen');
const dropZone       = $('drop-zone');
const fileInput      = $('file-input');
const filePreview    = $('file-preview');
const fileNameEl     = $('file-name');
const removeFileBtn  = $('remove-file');
const promptInput    = $('prompt-input');
const startBtn       = $('start-btn');
const uploadForm     = $('upload-form');
const loadingMsg     = $('loading-message');
const progressBar    = $('progress-bar');
const progressLabel  = $('progress-label');
const imageA         = $('image-a');
const imageB         = $('image-b');
const sceneCounter   = $('scene-counter');
const captionOverlay = $('caption-overlay');
const narrationPanel = $('narration-panel');
const narrationText  = $('narration-text');
const titleCard      = $('title-card');
const titleCardText  = $('title-card-text');
const noImageEl      = $('no-image-placeholder');
const backBtn        = $('back-btn');
const replayAudioBtn = $('replay-audio-btn');
const errorToast     = $('error-toast');
const errorMessage   = $('error-message');
const errorClose     = $('error-close');

// ─── API Base URL ──────────────────────────────────────────
// If the page is served from the backend, use relative URLs
const API_BASE = '';

// ─── Screen transitions ────────────────────────────────────
function showScreen(screenEl) {
  [uploadScreen, loadingScreen, playerScreen].forEach(s => s.classList.remove('active'));
  screenEl.classList.add('active');
}

// ─── Error toast ───────────────────────────────────────────
function showError(msg) {
  errorMessage.textContent = msg;
  errorToast.classList.remove('hidden');
  setTimeout(() => errorToast.classList.add('hidden'), 8000);
}
errorClose.addEventListener('click', () => errorToast.classList.add('hidden'));

// ─── File handling ─────────────────────────────────────────
function setFile(file) {
  state.file = file;
  fileNameEl.textContent = file.name;
  filePreview.classList.remove('hidden');
  dropZone.classList.add('hidden');
  updateStartBtn();
}

function clearFile() {
  state.file = null;
  fileInput.value = '';
  filePreview.classList.add('hidden');
  dropZone.classList.remove('hidden');
  updateStartBtn();
}

function updateStartBtn() {
  startBtn.disabled = !(state.file && promptInput.value.trim());
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});
removeFileBtn.addEventListener('click', clearFile);
promptInput.addEventListener('input', updateStartBtn);

// Drag and drop
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

// ─── Form submit ───────────────────────────────────────────
uploadForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!state.file || !promptInput.value.trim()) return;

  showScreen(loadingScreen);
  setProgress(2, 'Uploading your file...');

  const formData = new FormData();
  formData.append('file', state.file);
  formData.append('prompt', promptInput.value.trim());

  try {
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Upload failed (${res.status})`);
    }
    const data = await res.json();
    state.sessionId = data.session_id;
    connectSSE(state.sessionId);
  } catch (err) {
    showError(err.message);
    showScreen(uploadScreen);
  }
});

// ─── Progress ──────────────────────────────────────────────
function setProgress(pct, msg) {
  progressBar.style.width = `${pct}%`;
  progressLabel.textContent = `${Math.round(pct)}%`;
  if (msg) loadingMsg.textContent = msg;
}

// ─── SSE Connection ────────────────────────────────────────
function connectSSE(sessionId) {
  if (state.eventSource) state.eventSource.close();

  const es = new EventSource(`${API_BASE}/stream/${sessionId}`);
  state.eventSource = es;

  es.onmessage = e => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch (err) {
      console.warn('Failed to parse SSE event:', e.data, err);
    }
  };

  es.onerror = () => {
    console.error('SSE connection error');
    es.close();
    // Only show error if we haven't completed yet
    if (!playerScreen.classList.contains('active')) {
      showError('Lost connection to the server. Please try again.');
      showScreen(uploadScreen);
    }
  };
}

// ─── Event Router ─────────────────────────────────────────
function handleEvent(event) {
  switch (event.type) {
    case 'status':
      handleStatus(event);
      break;
    case 'scene_start':
      handleSceneStart(event);
      break;
    case 'image':
      handleImage(event);
      break;
    case 'caption':
      handleCaption(event);
      break;
    case 'narration_text':
      handleNarrationText(event);
      break;
    case 'audio':
      handleAudio(event);
      break;
    case 'scene_end':
      handleSceneEnd(event);
      break;
    case 'complete':
      handleComplete(event);
      break;
    case 'error':
      showError(event.message || 'An error occurred.');
      if (!playerScreen.classList.contains('active')) showScreen(uploadScreen);
      break;
    default:
      console.log('Unknown event type:', event.type, event);
  }
}

// ─── Event Handlers ────────────────────────────────────────

function handleStatus(event) {
  const pct = event.progress || 0;
  setProgress(pct, event.message || '');
}

function handleSceneStart(event) {
  state.currentScene = event.scene_num;
  state.totalScenes = event.total_scenes || state.totalScenes;

  // First scene: transition to player
  if (event.scene_num === 1) {
    showScreen(playerScreen);
  }

  // Show title card
  showTitleCard(event.title || `Scene ${event.scene_num}`);

  // Update HUD
  sceneCounter.textContent = `Scene ${event.scene_num} / ${state.totalScenes}`;

  // Hide previous caption/narration
  captionOverlay.classList.remove('visible');
  narrationPanel.classList.remove('visible');

  // Show no-image placeholder while generating
  noImageEl.classList.remove('hidden');
}

function handleImage(event) {
  noImageEl.classList.add('hidden');

  if (event.delivery === 'none' || (!event.data && !event.url)) {
    noImageEl.classList.remove('hidden');
    return;
  }

  let src;
  if (event.delivery === 'url' && event.url) {
    src = event.url;
  } else if (event.data) {
    const mime = event.mime_type || 'image/png';
    src = `data:${mime};base64,${event.data}`;
  }

  if (!src) return;
  crossfadeImage(src);
}

function crossfadeImage(src) {
  const incoming = state.activeImageSlot === 'a' ? imageB : imageA;
  const outgoing = state.activeImageSlot === 'a' ? imageA : imageB;

  incoming.style.backgroundImage = `url("${src}")`;
  incoming.classList.add('active');
  incoming.classList.remove('fade-in');

  // Fade out old
  outgoing.classList.remove('active');

  state.activeImageSlot = state.activeImageSlot === 'a' ? 'b' : 'a';
}

function handleCaption(event) {
  if (!event.text) return;
  captionOverlay.textContent = `"${event.text}"`;
  captionOverlay.classList.add('visible');
}

function handleNarrationText(event) {
  if (!event.text) return;
  state.lastNarration = event.text;
  narrationText.textContent = event.text;

  // Reveal narration panel with slight delay after caption
  setTimeout(() => {
    narrationPanel.classList.add('visible');
    hideTitleCard();
  }, 800);
}

function handleAudio(event) {
  if (!event.data) return;
  const audioSrc = `data:${event.mime_type || 'audio/mpeg'};base64,${event.data}`;
  playAudio(audioSrc);
}

function handleSceneEnd(event) {
  // Nothing needed — next scene_start will handle transitions
}

function handleComplete(event) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  // Add a subtle "complete" indicator
  sceneCounter.textContent = `Experience Complete`;
  console.log('Cinematic experience complete:', event);
}

// ─── Title Card ────────────────────────────────────────────
let titleCardTimer = null;

function showTitleCard(title) {
  titleCardText.textContent = title;
  titleCard.classList.add('visible');
  clearTimeout(titleCardTimer);
  // Auto-hide after narration text appears (handled in handleNarrationText)
  // Failsafe: hide after 5s
  titleCardTimer = setTimeout(hideTitleCard, 5000);
}

function hideTitleCard() {
  titleCard.classList.remove('visible');
}

// ─── Audio ─────────────────────────────────────────────────
function playAudio(src) {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }
  const audio = new Audio(src);
  state.currentAudio = audio;
  audio.play().catch(err => {
    // Autoplay blocked — user interaction needed
    console.warn('Audio autoplay blocked:', err);
    // Show a subtle replay button affordance
    replayAudioBtn.style.opacity = '1';
  });
}

replayAudioBtn.addEventListener('click', () => {
  if (state.currentAudio) {
    state.currentAudio.currentTime = 0;
    state.currentAudio.play().catch(console.warn);
  }
});

// ─── Back button ───────────────────────────────────────────
backBtn.addEventListener('click', () => {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }
  // Reset player state
  imageA.style.backgroundImage = '';
  imageB.style.backgroundImage = '';
  imageA.classList.add('active');
  imageB.classList.remove('active');
  state.activeImageSlot = 'a';
  captionOverlay.classList.remove('visible');
  narrationPanel.classList.remove('visible');
  hideTitleCard();

  showScreen(uploadScreen);
});
