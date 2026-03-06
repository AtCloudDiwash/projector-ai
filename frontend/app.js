/**
 * The Cinematic Narrator — Frontend Player
 *
 * Queue system: scenes are buffered as they stream in.
 * A scene is only displayed after the previous scene's audio finishes.
 */

'use strict';

// ─── State ───────────────────────────────────────────────
const state = {
  file: null,
  sessionId: null,
  eventSource: null,
  totalScenes: 0,
  activeImageSlot: 'a',
  currentAudio: null,

  // Scene queue system
  sceneQueue: [],          // fully assembled scenes waiting to be displayed
  pendingScene: null,      // scene currently being assembled from SSE events
  isDisplaying: false,     // true while a scene is on screen playing audio
  streamComplete: false,   // true when SSE 'complete' event received
  audioUnlocked: false,    // true after user click unlocks browser autoplay
};

// ─── DOM refs ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const uploadScreen    = $('upload-screen');
const loadingScreen   = $('loading-screen');
const playerScreen    = $('player-screen');
const dropZone        = $('drop-zone');
const fileInput       = $('file-input');
const filePreview     = $('file-preview');
const fileNameEl      = $('file-name');
const removeFileBtn   = $('remove-file');
const promptInput     = $('prompt-input');
const startBtn        = $('start-btn');
const uploadForm      = $('upload-form');
const loadingMsg      = $('loading-message');
const progressBar     = $('progress-bar');
const progressLabel   = $('progress-label');
const imageA          = $('image-a');
const imageB          = $('image-b');
const sceneCounter    = $('scene-counter');
const captionHeader   = $('caption-header');
const subtitleContainer = $('subtitle-container');
const titleCard       = $('title-card');
const titleCardText   = $('title-card-text');
const noImageEl       = $('no-image-placeholder');
const unlockOverlay   = $('unlock-overlay');
const backBtn         = $('back-btn');
const replayAudioBtn  = $('replay-audio-btn');
const errorToast      = $('error-toast');
const errorMessage    = $('error-message');
const errorClose      = $('error-close');

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
      handleEvent(JSON.parse(e.data));
    } catch (err) {
      console.warn('Failed to parse SSE event:', e.data, err);
    }
  };

  es.onerror = () => {
    es.close();
    if (!playerScreen.classList.contains('active')) {
      showError('Lost connection to the server. Please try again.');
      showScreen(uploadScreen);
    }
  };
}

// ─── Event Router ─────────────────────────────────────────
function handleEvent(event) {
  switch (event.type) {
    case 'status':         handleStatus(event);        break;
    case 'scene_start':    handleSceneStart(event);    break;
    case 'image':          handleImage(event);         break;
    case 'caption':        handleCaption(event);       break;
    case 'narration_text': handleNarrationText(event); break;
    case 'audio':          handleAudio(event);         break;
    case 'scene_end':      handleSceneEnd(event);      break;
    case 'complete':       handleComplete(event);      break;
    case 'error':
      showError(event.message || 'An error occurred.');
      if (!playerScreen.classList.contains('active')) showScreen(uploadScreen);
      break;
    default:
      console.log('Unknown event:', event.type);
  }
}

// ─── SSE Event Handlers (accumulate into pendingScene) ────

function handleStatus(event) {
  setProgress(event.progress || 0, event.message || '');
}

function handleSceneStart(event) {
  state.totalScenes = event.total_scenes || state.totalScenes;

  // Start accumulating a new pending scene
  state.pendingScene = {
    scene_num:    event.scene_num,
    title:        event.title || `Scene ${event.scene_num}`,
    visual_style: event.visual_style || 'cinematic',
    image:        null,   // base64 or url, set by handleImage
    caption:      null,
    narration:    null,
    audio:        null,
  };

  // Update loading screen progress message while first scene is assembling
  if (!playerScreen.classList.contains('active')) {
    setProgress(
      10 + Math.round(((event.scene_num - 1) / state.totalScenes) * 40),
      `Preparing scene ${event.scene_num}: ${event.title}...`
    );
  }
}

function handleImage(event) {
  if (!state.pendingScene) return;
  if (event.delivery === 'url' && event.url) {
    state.pendingScene.image = event.url;
  } else if (event.data) {
    state.pendingScene.image = `data:${event.mime_type || 'image/png'};base64,${event.data}`;
  }
}

function handleCaption(event) {
  if (!state.pendingScene) return;
  state.pendingScene.caption = event.text || null;
}

function handleNarrationText(event) {
  if (!state.pendingScene) return;
  state.pendingScene.narration = event.text || null;
}

function handleAudio(event) {
  if (!state.pendingScene) return;
  if (event.data) {
    state.pendingScene.audio = `data:${event.mime_type || 'audio/mpeg'};base64,${event.data}`;
  }
}

function handleSceneEnd(event) {
  if (!state.pendingScene) return;

  // Scene is fully assembled — push to display queue
  state.sceneQueue.push(state.pendingScene);
  state.pendingScene = null;

  // First scene ready: leave loading screen, show player + unlock overlay
  if (state.sceneQueue.length === 1 && !playerScreen.classList.contains('active')) {
    showScreen(playerScreen);
    showUnlockOverlay();
  }

  // Try to play — will only proceed after user unlocks audio
  tryPlayNext();
}

function handleComplete(event) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.streamComplete = true;
  console.log('Stream complete. Queue length:', state.sceneQueue.length);
}

// ─── Audio Unlock ─────────────────────────────────────────

function showUnlockOverlay() {
  unlockOverlay.classList.remove('hidden');
}

function unlockAndPlay() {
  if (state.audioUnlocked) return;
  state.audioUnlocked = true;
  unlockOverlay.classList.add('hidden');

  // Play a silent sound to unlock the audio context for all future playback
  const silent = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAAnHOPBVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/84AEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAACcQCAgA==');
  silent.play().catch(() => {});

  tryPlayNext();
}

unlockOverlay.addEventListener('click', unlockAndPlay);

// ─── Queue Player ─────────────────────────────────────────

function tryPlayNext() {
  // Wait for user to unlock audio first
  if (!state.audioUnlocked) return;

  // Already displaying a scene — wait for it to finish
  if (state.isDisplaying) return;

  // Nothing in the queue yet
  if (state.sceneQueue.length === 0) return;

  const scene = state.sceneQueue.shift();
  displayScene(scene);
}

function displayScene(scene) {
  state.isDisplaying = true;

  // Hide unlock overlay as scene starts
  unlockOverlay.classList.add('hidden');

  // Update HUD
  sceneCounter.textContent = `Scene ${scene.scene_num} / ${state.totalScenes}`;

  // Clear subtitle and caption from previous scene
  NarrationRenderer.stop();
  captionHeader.textContent = '';
  captionHeader.classList.remove('visible');
  hideTitleCard();

  // Show title card
  showTitleCard(scene.title);

  // Show image
  if (scene.image) {
    noImageEl.classList.add('hidden');
    crossfadeImage(scene.image);
  } else {
    noImageEl.classList.remove('hidden');
  }

  // Show short yellow caption at top after 600ms
  if (scene.caption) {
    setTimeout(() => {
      captionHeader.textContent = `— ${scene.caption} —`;
      captionHeader.classList.add('visible');
    }, 600);
  }

  // Play audio + start word-by-word subtitle in sync
  if (scene.audio) {
    playAudio(scene.audio, scene.narration, () => {
      setTimeout(() => {
        NarrationRenderer.stop();
        state.isDisplaying = false;
        tryPlayNext();
      }, 1000);
    });
  } else {
    // No audio — estimate timing from word count (130 words/min)
    const words = scene.narration ? scene.narration.split(/\s+/) : [];
    const displayMs = Math.max(4000, (words.length / 130) * 60000);
    if (scene.narration) NarrationRenderer.start(words, displayMs);
    setTimeout(() => {
      NarrationRenderer.stop();
      state.isDisplaying = false;
      tryPlayNext();
    }, displayMs);
  }
}

// ════════════════════════════════════════════════════════════
// NARRATION RENDERER MODULE
//
// Renders narration text word-by-word into a strict 2-line
// rolling subtitle. Uses character-count to detect line full.
// When both lines are full, wipes and restarts from line 1.
//
// TO SWAP IN GEMINI LIVE:
//   1. Delete the start() function and its setTimeout chain.
//   2. Call NarrationRenderer.renderWord(word) directly from
//      your Gemini Live transcript event handler.
//   3. Call NarrationRenderer.stop() when the turn ends.
//   The 2-line rolling display and wipe logic stay unchanged.
// ════════════════════════════════════════════════════════════
const NarrationRenderer = (() => {
  let _timer    = null;
  let _line1El  = null;
  let _line2El  = null;
  let _curLine  = 1;
  let _l1Chars  = 0;
  let _l2Chars  = 0;
  let _maxChars = 55; // recalculated on init

  function _init() {
    subtitleContainer.innerHTML = '';

    _line1El = document.createElement('div');
    _line1El.className = 'subtitle-line';
    _line2El = document.createElement('div');
    _line2El.className = 'subtitle-line';
    subtitleContainer.appendChild(_line1El);
    subtitleContainer.appendChild(_line2El);

    _curLine = 1;
    _l1Chars = 0;
    _l2Chars = 0;

    // Estimate how many characters fit per line:
    // container width ÷ (fontSize × 0.52 avg char width for serif)
    const containerW = subtitleContainer.offsetWidth || (window.innerWidth * 0.70);
    const fontSize   = parseFloat(getComputedStyle(subtitleContainer).fontSize) || 18;
    _maxChars = Math.floor(containerW / (fontSize * 0.52));
  }

  // ── Public: render one word ─────────────────────────────
  // SWAP POINT: call this from Gemini Live transcript events
  function renderWord(word) {
    if (!word || !word.trim()) return;

    const wordLen = word.length + 1; // +1 for trailing space

    if (_curLine === 1) {
      // Would this word overflow line 1?
      if (_l1Chars > 0 && _l1Chars + wordLen > _maxChars) {
        _curLine = 2; // advance to line 2
      }
    } else {
      // Would this word overflow line 2?
      if (_l2Chars > 0 && _l2Chars + wordLen > _maxChars) {
        // Both lines full — wipe and restart
        _line1El.innerHTML = '';
        _line2El.innerHTML = '';
        _l1Chars = 0;
        _l2Chars = 0;
        _curLine = 1;
      }
    }

    const span = document.createElement('span');
    span.className = 'subtitle-word';
    span.textContent = word + ' ';

    if (_curLine === 1) {
      _line1El.appendChild(span);
      _l1Chars += wordLen;
    } else {
      _line2El.appendChild(span);
      _l2Chars += wordLen;
    }
  }

  // ── Public: start timed rendering (timer-based source) ──
  // SWAP POINT: delete this when using Gemini Live
  function start(words, totalDurationMs) {
    stop();
    _init();
    if (!words || words.length === 0) return;

    const leadIn     = 800; // wait for title card to clear
    const intervalMs = Math.max(80, (totalDurationMs - leadIn) / words.length);
    let i = 0;

    _timer = setTimeout(function tick() {
      if (i >= words.length) return;
      renderWord(words[i++]);
      _timer = setTimeout(tick, intervalMs);
    }, leadIn);
  }

  // ── Public: stop and clear ──────────────────────────────
  function stop() {
    clearTimeout(_timer);
    _timer   = null;
    _curLine = 1;
    _l1Chars = 0;
    _l2Chars = 0;
    subtitleContainer.innerHTML = '';
  }

  return { start, stop, renderWord };
})();

// ─── Title Card ────────────────────────────────────────────
let titleCardTimer = null;

function showTitleCard(title) {
  titleCardText.textContent = title;
  titleCard.classList.add('visible');
  clearTimeout(titleCardTimer);
  titleCardTimer = setTimeout(hideTitleCard, 4000);
}

function hideTitleCard() {
  titleCard.classList.remove('visible');
}

// ─── Image crossfade ──────────────────────────────────────
function crossfadeImage(src) {
  const incoming = state.activeImageSlot === 'a' ? imageB : imageA;
  const outgoing  = state.activeImageSlot === 'a' ? imageA : imageB;

  incoming.style.backgroundImage = `url("${src}")`;
  incoming.classList.add('active');
  outgoing.classList.remove('active');

  state.activeImageSlot = state.activeImageSlot === 'a' ? 'b' : 'a';
}

// ─── Audio ─────────────────────────────────────────────────
function playAudio(src, narration, onEnded) {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.removeEventListener('ended', state.currentAudio._onEnded);
    state.currentAudio = null;
  }

  const audio = new Audio(src);
  state.currentAudio = audio;

  // Once we know the audio duration, start the word-by-word subtitle
  audio.addEventListener('loadedmetadata', () => {
    const words = narration ? narration.split(/\s+/) : [];
    const durationMs = audio.duration * 1000;
    if (words.length > 0 && durationMs > 0) {
      NarrationRenderer.start(words, durationMs);
    }
  }, { once: true });

  audio._onEnded = onEnded;
  audio.addEventListener('ended', onEnded, { once: true });

  audio.play().catch(err => {
    console.warn('Audio play failed:', err);
    replayAudioBtn.classList.add('pulse');
    replayAudioBtn.style.opacity = '1';
    replayAudioBtn._pendingOnEnded = onEnded;
    // Still show subtitles estimated — fallback timing
    const words = narration ? narration.split(/\s+/) : [];
    if (words.length > 0) {
      const estimatedMs = Math.max(4000, (words.length / 130) * 60000);
      NarrationRenderer.start(words, estimatedMs);
    }
  });
}

replayAudioBtn.addEventListener('click', () => {
  replayAudioBtn.classList.remove('pulse');
  if (state.currentAudio) {
    state.currentAudio.currentTime = 0;
    state.currentAudio.play().catch(console.warn);
  } else if (replayAudioBtn._pendingOnEnded) {
    // Audio failed entirely — manually advance queue
    const cb = replayAudioBtn._pendingOnEnded;
    replayAudioBtn._pendingOnEnded = null;
    cb();
  }
});

// ─── Back button ───────────────────────────────────────────
backBtn.addEventListener('click', () => {
  // Stop everything
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
  if (state.currentAudio) { state.currentAudio.pause(); state.currentAudio = null; }

  // Reset queue state
  state.sceneQueue = [];
  state.pendingScene = null;
  state.isDisplaying = false;
  state.streamComplete = false;
  state.audioUnlocked = false;
  state.totalScenes = 0;
  unlockOverlay.classList.add('hidden');

  // Reset player visuals
  NarrationRenderer.stop();
  imageA.style.backgroundImage = '';
  imageB.style.backgroundImage = '';
  imageA.classList.add('active');
  imageB.classList.remove('active');
  state.activeImageSlot = 'a';
  captionHeader.textContent = '';
  captionHeader.classList.remove('visible');
  hideTitleCard();
  noImageEl.classList.add('hidden');

  showScreen(uploadScreen);
});
