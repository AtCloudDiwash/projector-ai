/**
 * Gemini Live — always-on session hook.
 *
 * Session opens automatically when sessionId is set (player screen mounts).
 * Space key only mutes/unmutes the mic — session stays alive, memory persists.
 * sendContext() pushes current scene info to Gemini silently.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { GeminiWaveMode } from '../types';

export interface UseGeminiLiveReturn {
  isConnected:  boolean;         // WebSocket + Gemini session is open
  isMicActive:  boolean;         // mic is currently sending audio
  mode:         GeminiWaveMode;  // 'idle' | 'listening' | 'speaking'
  toggleMic:    () => void;      // Space key calls this
  sendContext:  (text: string) => void; // called on scene change
  disconnect:   () => void;
}

export function useGeminiLive(sessionId: string | null): UseGeminiLiveReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [mode, setMode]               = useState<GeminiWaveMode>('idle');

  const wsRef            = useRef<WebSocket | null>(null);
  const micCtxRef        = useRef<AudioContext | null>(null);
  const playCtxRef       = useRef<AudioContext | null>(null);
  const micStreamRef     = useRef<MediaStream | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef  = useRef<number>(0);
  const speakTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micMutedRef      = useRef<boolean>(true);   // mic starts muted
  const isConnectingRef  = useRef<boolean>(false);

  // ── Teardown ───────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    isConnectingRef.current = false;
    micMutedRef.current     = true;

    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (micCtxRef.current)    { micCtxRef.current.close().catch(() => {}); micCtxRef.current = null; }
    if (playCtxRef.current)   { playCtxRef.current.close().catch(() => {}); playCtxRef.current = null; }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try { ws.send(JSON.stringify({ type: 'end' })); } catch {}
      ws.onmessage = null;
      ws.onclose   = null;
      ws.onerror   = null;
      ws.close();
    }

    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    nextPlayTimeRef.current = 0;

    setIsConnected(false);
    setIsMicActive(false);
    setMode('idle');
  }, []);

  // ── Connect (called automatically, not by the user) ───────────────────────
  const connect = useCallback(async () => {
    if (!sessionId) return;
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    disconnect();
    isConnectingRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      const micCtx  = new AudioContext();
      micCtxRef.current = micCtx;

      const playCtx = new AudioContext();
      playCtxRef.current = playCtx;
      nextPlayTimeRef.current = 0;

      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const isDev   = window.location.port === '5173';
      const wsHost  = isDev ? `${window.location.hostname}:8080` : window.location.host;
      const ws = new WebSocket(`${wsProto}://${wsHost}/ws/live/${sessionId}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        const source    = micCtx.createMediaStreamSource(stream);
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const processor = micCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        const nativeRate = micCtx.sampleRate;
        const ratio      = nativeRate / 16000;

        processor.onaudioprocess = (ev) => {
          // Only send when mic is unmuted and socket is open
          if (micMutedRef.current) return;
          if (ws.readyState !== WebSocket.OPEN) return;
          const f32  = ev.inputBuffer.getChannelData(0);
          const outLen = Math.floor(f32.length / ratio);
          const i16  = new Int16Array(outLen);
          for (let i = 0; i < outLen; i++) {
            i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[Math.round(i * ratio)] * 32767)));
          }
          ws.send(i16.buffer);
        };

        source.connect(processor);
        processor.connect(micCtx.destination);

        isConnectingRef.current = false;
        setIsConnected(true);
        setMode('idle');   // connected but mic muted — show idle wave
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data) as { type: string; message?: string };
            if (msg.type === 'ready') {
              setIsConnected(true);
            } else if (msg.type === 'turn_complete') {
              nextPlayTimeRef.current = 0;
              if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
              // After speaking, return to listening if mic is on, else idle
              speakTimerRef.current = setTimeout(() => {
                setMode(micMutedRef.current ? 'idle' : 'listening');
              }, 400);
            } else if (msg.type === 'error') {
              console.error('[GeminiLive] error:', msg.message);
              disconnect();
            }
          } catch { /* ignore malformed */ }

        } else if (ev.data instanceof ArrayBuffer && ev.data.byteLength > 0) {
          setMode('speaking');
          if (speakTimerRef.current) clearTimeout(speakTimerRef.current);

          const playCtx = playCtxRef.current;
          if (!playCtx) return;
          if (playCtx.state === 'suspended') playCtx.resume();

          const i16 = new Int16Array(ev.data);
          const f32 = new Float32Array(i16.length);
          for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;

          const buf = playCtx.createBuffer(1, f32.length, 24000);
          buf.getChannelData(0).set(f32);

          const src = playCtx.createBufferSource();
          src.buffer = buf;
          src.connect(playCtx.destination);

          const now     = playCtx.currentTime;
          const startAt = Math.max(now + 0.02, nextPlayTimeRef.current);
          src.start(startAt);
          nextPlayTimeRef.current = startAt + buf.duration;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsMicActive(false);
        setMode('idle');
      };

      ws.onerror = () => disconnect();

    } catch (err) {
      console.error('[GeminiLive] Failed to connect:', err);
      disconnect();
    }
  }, [sessionId, disconnect]);

  // ── Auto-connect when session is ready ────────────────────────────────────
  useEffect(() => {
    if (sessionId) connect();
    return () => disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Mic toggle — Space key calls this ─────────────────────────────────────
  const toggleMic = useCallback(() => {
    const nowMuted = !micMutedRef.current;
    micMutedRef.current = nowMuted;
    setIsMicActive(!nowMuted);
    setMode(nowMuted ? 'idle' : 'listening');
  }, []);

  // ── Send scene context silently to Gemini ─────────────────────────────────
  const sendContext = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'context', text }));
    }
  }, []);

  return { isConnected, isMicActive, mode, toggleMic, sendContext, disconnect };
}
