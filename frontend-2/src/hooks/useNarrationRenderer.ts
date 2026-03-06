import { useRef, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════
// NARRATION RENDERER HOOK
//
// Performs direct DOM manipulation on a subtitle container ref.
// Words are rendered one-by-one into two explicit line divs.
// Character-count based line detection — no scroll-height hacks.
//
// TO SWAP IN GEMINI LIVE:
//   1. Remove start() call from PlayerScreen.
//   2. Call renderWord() directly from Gemini Live transcript events.
//   3. Call stop() when the session turn ends.
//   The 2-line rolling logic is unchanged.
// ═══════════════════════════════════════════════════════════

interface UseNarrationRendererReturn {
  // SWAP POINT: call this from Gemini Live transcript events instead of start()
  renderWord: (word: string) => void;
  // Current timer-based source — delete when using Gemini Live
  start:      (words: string[], totalDurationMs: number) => void;
  stop:       () => void;
}

export function useNarrationRenderer(
  containerRef: React.RefObject<HTMLDivElement | null>,
): UseNarrationRendererReturn {
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const line1Ref   = useRef<HTMLDivElement | null>(null);
  const line2Ref   = useRef<HTMLDivElement | null>(null);
  const curLineRef = useRef<1 | 2>(1);
  const l1CharsRef = useRef(0);
  const l2CharsRef = useRef(0);
  const maxCharsRef = useRef(55);

  const _initDOM = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const l1 = document.createElement('div');
    l1.className = 'subtitle-line';
    const l2 = document.createElement('div');
    l2.className = 'subtitle-line';
    container.appendChild(l1);
    container.appendChild(l2);

    line1Ref.current   = l1;
    line2Ref.current   = l2;
    curLineRef.current = 1;
    l1CharsRef.current = 0;
    l2CharsRef.current = 0;

    // Compute chars per line from actual container width + font size
    const w  = container.offsetWidth || window.innerWidth * 0.70;
    const fs = parseFloat(getComputedStyle(container).fontSize) || 18;
    maxCharsRef.current = Math.floor(w / (fs * 0.52));
  }, [containerRef]);

  // ── SWAP POINT: this function is the only entry point for words ──
  const renderWord = useCallback((word: string) => {
    if (!word.trim()) return;

    const l1   = line1Ref.current;
    const l2   = line2Ref.current;
    if (!l1 || !l2) return;

    const wordLen = word.length + 1;

    if (curLineRef.current === 1) {
      if (l1CharsRef.current > 0 && l1CharsRef.current + wordLen > maxCharsRef.current) {
        curLineRef.current = 2;
      }
    } else {
      if (l2CharsRef.current > 0 && l2CharsRef.current + wordLen > maxCharsRef.current) {
        // Both lines full — wipe and restart from line 1
        l1.innerHTML = '';
        l2.innerHTML = '';
        l1CharsRef.current = 0;
        l2CharsRef.current = 0;
        curLineRef.current = 1;
      }
    }

    const span = document.createElement('span');
    span.className = 'subtitle-word';
    span.textContent = word + ' ';

    if (curLineRef.current === 1) {
      l1.appendChild(span);
      l1CharsRef.current += wordLen;
    } else {
      l2.appendChild(span);
      l2CharsRef.current += wordLen;
    }
  }, []);

  // ── Timer-based source — delete when using Gemini Live ──
  const start = useCallback((words: string[], totalDurationMs: number) => {
    stop();
    // Guard: container must be mounted before we can inject DOM nodes
    if (!containerRef.current) {
      console.warn('SubtitleRenderer ref not ready — retrying in 100ms');
      setTimeout(() => start(words, totalDurationMs), 100);
      return;
    }
    _initDOM();
    if (words.length === 0) return;

    const leadIn     = 800;
    const intervalMs = Math.max(80, (totalDurationMs - leadIn) / words.length);
    let i = 0;

    const tick = () => {
      if (i >= words.length) return;
      renderWord(words[i++]);
      timerRef.current = setTimeout(tick, intervalMs);
    };
    timerRef.current = setTimeout(tick, leadIn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_initDOM, renderWord]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    curLineRef.current = 1;
    l1CharsRef.current = 0;
    l2CharsRef.current = 0;
    if (containerRef.current) containerRef.current.innerHTML = '';
    line1Ref.current = null;
    line2Ref.current = null;
  }, [containerRef]);

  return { renderWord, start, stop };
}
