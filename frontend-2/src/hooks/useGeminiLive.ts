/**
 * Gemini Live voice agent hook.
 *
 * Browser mic (PCM Int16 16kHz) → WebSocket → backend → Gemini Live
 * Gemini Live (PCM Int16 24kHz) → WebSocket → browser AudioContext
 *
 * Usage:
 *   const live = useGeminiLive(sessionId);
 *   // Press Space → live.toggle()
 *   // Wire to <GeminiWave isActive={live.isActive} mode={live.mode} />
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { GeminiWaveMode } from '../types';

interface UseGeminiLiveReturn {
  isActive: boolean;
  mode: GeminiWaveMode;
  toggle: () => void;
  disconnect: () => void;
}

export function useGeminiLive(sessionId: string | null): UseGeminiLiveReturn {
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode]         = useState<GeminiWaveMode>('idle');

  const wsRef            = useRef<WebSocket | null>(null);
  const micCtxRef        = useRef<AudioContext | null>(null);
  const playCtxRef       = useRef<AudioContext | null>(null);
  const micStreamRef     = useRef<MediaStream | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef  = useRef<number>(0);
  const speakTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: flips true synchronously when connect() starts, prevents double-sessions
  const isConnectingRef  = useRef<boolean>(false);

  // ── Teardown ─────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    // Reset guard immediately so toggle() can reconnect cleanly after this
    isConnectingRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (micCtxRef.current) {
      micCtxRef.current.close().catch(() => {});
      micCtxRef.current = null;
    }
    if (playCtxRef.current) {
      playCtxRef.current.close().catch(() => {});
      playCtxRef.current = null;
    }
    // Close WebSocket — forcefully, no waiting
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;           // null first so no other code re-uses it
      try { ws.send(JSON.stringify({ type: 'end' })); } catch {}
      ws.onmessage = null;            // stop processing any in-flight messages
      ws.onclose   = null;            // prevent onclose from firing setIsActive
      ws.onerror   = null;
      ws.close();
    }
    if (speakTimerRef.current) {
      clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    setIsActive(false);
    setMode('idle');
  }, []);

  // ── Connect ───────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!sessionId) return;
    // Hard guard — flip synchronously before any await so rapid calls can't
    // slip through the isActive state lag and spawn a second session
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    // Kill any leftover session before opening a new one
    disconnect();
    // Re-set guard because disconnect() resets it
    isConnectingRef.current = true;

    try {
      // 1. Mic stream — let browser choose native rate (Chrome ignores forced rates)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      // 2. Mic AudioContext — use browser's native rate, downsample to 16kHz manually
      const micCtx = new AudioContext();
      micCtxRef.current = micCtx;

      // 3. Playback AudioContext — use browser's native rate; specify 24000 in createBuffer
      //    so the Web Audio API resamples correctly from Gemini's 24kHz output.
      const playCtx = new AudioContext();
      playCtxRef.current = playCtx;
      nextPlayTimeRef.current = 0;

      // 4. WebSocket — connect directly to backend.
      //    In dev (Vite :5173): proxy WS doesn't work, go straight to :8080.
      //    In production: backend serves frontend, so location.host is correct.
      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const isDev   = window.location.port === '5173';
      const wsHost  = isDev ? `${window.location.hostname}:8080` : window.location.host;
      const ws = new WebSocket(`${wsProto}://${wsHost}/ws/live/${sessionId}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      // 5. Wire mic → ScriptProcessor → WebSocket
      ws.onopen = () => {
        const source    = micCtx.createMediaStreamSource(stream);
        // 4096-sample buffer; mono in, mono out
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const processor = micCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        // Downsample from browser's native rate (e.g. 48kHz) to Gemini's 16kHz.
        const nativeRate   = micCtx.sampleRate;          // e.g. 48000
        const targetRate   = 16000;
        const ratio        = nativeRate / targetRate;    // e.g. 3.0

        processor.onaudioprocess = (ev) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const f32            = ev.inputBuffer.getChannelData(0);
          const outLen         = Math.floor(f32.length / ratio);
          const i16            = new Int16Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const sample = f32[Math.round(i * ratio)];
            i16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
          }
          ws.send(i16.buffer);
        };

        source.connect(processor);
        // Connect to destination to keep the audio graph alive (silent output)
        processor.connect(micCtx.destination);

        isConnectingRef.current = false;  // fully connected — allow future reconnects
        setIsActive(true);
        setMode('listening');
      };

      // 6. Handle incoming messages
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data) as { type: string; message?: string; text?: string };
            if (msg.type === 'ready') {
              setMode('listening');
            } else if (msg.type === 'turn_complete') {
              // Gemini finished speaking — reset schedule clock, flip back to listening
              nextPlayTimeRef.current = 0;
              if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
              speakTimerRef.current = setTimeout(() => setMode('listening'), 400);
            } else if (msg.type === 'interrupt') {
              nextPlayTimeRef.current = 0;
            } else if (msg.type === 'error') {
              console.error('[GeminiLive] error:', msg.message);
              disconnect();
            }
          } catch { /* ignore malformed JSON */ }

        } else if (ev.data instanceof ArrayBuffer && ev.data.byteLength > 0) {
          // PCM Int16 24kHz — decode, schedule sequentially (no overlapping chunks)
          setMode('speaking');
          if (speakTimerRef.current) clearTimeout(speakTimerRef.current);

          const playCtx = playCtxRef.current;
          if (!playCtx) return;

          // Resume if browser suspended the context (autoplay policy)
          if (playCtx.state === 'suspended') playCtx.resume();

          const i16 = new Int16Array(ev.data);
          const f32 = new Float32Array(i16.length);
          for (let i = 0; i < i16.length; i++) {
            f32[i] = i16[i] / 32768;
          }

          // createBuffer with 24000 — Web Audio resamples to AudioContext's native rate
          const buf = playCtx.createBuffer(1, f32.length, 24000);
          buf.getChannelData(0).set(f32);

          const src = playCtx.createBufferSource();
          src.buffer = buf;
          src.connect(playCtx.destination);

          // Schedule back-to-back: start at nextPlayTime or "now + tiny buffer"
          const now       = playCtx.currentTime;
          const startAt   = Math.max(now + 0.02, nextPlayTimeRef.current);
          src.start(startAt);
          nextPlayTimeRef.current = startAt + buf.duration;
        }
      };

      ws.onclose = () => {
        setIsActive(false);
        setMode('idle');
      };

      ws.onerror = (err) => {
        console.error('[GeminiLive] WebSocket error:', err);
        disconnect();
      };

    } catch (err) {
      console.error('[GeminiLive] Failed to start:', err);
      disconnect();  // also resets isConnectingRef
    }
  }, [sessionId, disconnect]);

  // ── Toggle (Space key handler calls this) ────────────────────────────────
  const toggle = useCallback(() => {
    if (isActive) {
      disconnect();
    } else {
      connect();
    }
  }, [isActive, connect, disconnect]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => { disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isActive, mode, toggle, disconnect };
}
