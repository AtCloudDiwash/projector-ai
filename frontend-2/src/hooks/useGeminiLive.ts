/**
 * Gemini Live — always-on session hook.
 *
 * Session opens automatically when sessionId is set.
 * Space key only mutes/unmutes mic — memory persists across turns.
 * Screen capture: user clicks "Share Screen" once → stream stored →
 *   Gemini calls capture_screen tool → one frame grabbed on demand.
 *
 * Tool protocol (extensible):
 *   Backend → {"type":"tool_call","tool":"capture_screen","call_id":"..."}
 *   Frontend → {"type":"frame","data":"base64jpeg","call_id":"..."}
 *   Future:   {"type":"search_result","results":[...],"call_id":"..."}
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { GeminiWaveMode } from '../types';

// ImageCapture API — not in standard TS lib yet
declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
}

export interface UseGeminiLiveReturn {
  isConnected:    boolean;
  isMicActive:    boolean;
  isScreenShared: boolean;
  mode:           GeminiWaveMode;
  toggleMic:      () => void;
  sendContext:    (text: string) => void;
  shareScreen:    () => Promise<void>;
  stopScreenShare: () => void;
  disconnect:     () => void;
}

export function useGeminiLive(sessionId: string | null): UseGeminiLiveReturn {
  const [isConnected,    setIsConnected]    = useState(false);
  const [isMicActive,    setIsMicActive]    = useState(false);
  const [isScreenShared, setIsScreenShared] = useState(false);
  const [mode,           setMode]           = useState<GeminiWaveMode>('idle');

  const wsRef            = useRef<WebSocket | null>(null);
  const micCtxRef        = useRef<AudioContext | null>(null);
  const playCtxRef       = useRef<AudioContext | null>(null);
  const micStreamRef     = useRef<MediaStream | null>(null);
  const screenStreamRef  = useRef<MediaStream | null>(null);  // getDisplayMedia stream
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef  = useRef<number>(0);
  const speakTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micMutedRef      = useRef<boolean>(true);
  const isConnectingRef  = useRef<boolean>(false);

  // ── Screen share ───────────────────────────────────────────────────────────
  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenShared(false);
  }, []);

  const shareScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5, displaySurface: 'browser' as DisplayCaptureSurfaceType },
        audio: false,
        // Pre-select this tab in the picker so Gemini sees the app itself.
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
      screenStreamRef.current = stream;
      setIsScreenShared(true);
      // Auto-clean when user stops sharing via browser chrome
      stream.getVideoTracks()[0].addEventListener('ended', stopScreenShare, { once: true });
    } catch (err) {
      console.warn('[GeminiLive] Screen share cancelled or denied:', err);
    }
  }, [stopScreenShare]);

  // Grab a single JPEG frame from the screen stream (base64).
  // Uses a hidden <video> element — more reliable than ImageCapture on tab streams.
  const captureFrame = useCallback((): Promise<string | null> => {
    const stream = screenStreamRef.current;
    if (!stream) return Promise.resolve(null);
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      const video = document.createElement('video');
      video.muted       = true;
      video.playsInline = true;
      video.srcObject   = stream;

      const timeout = setTimeout(() => {
        video.srcObject = null;
        resolve(null);
      }, 4000);

      video.onloadedmetadata = () => {
        video.play().then(() => {
          requestAnimationFrame(() => {
            const canvas = document.createElement('canvas');
            canvas.width  = video.videoWidth  || 1280;
            canvas.height = video.videoHeight || 720;
            canvas.getContext('2d')!.drawImage(video, 0, 0);
            video.pause();
            video.srcObject = null;
            clearTimeout(timeout);
            resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
          });
        }).catch(() => { clearTimeout(timeout); resolve(null); });
      };
      video.onerror = () => { clearTimeout(timeout); resolve(null); };
    });
  }, []);

  // ── Teardown ───────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    isConnectingRef.current = false;
    micMutedRef.current     = true;

    if (processorRef.current)  { processorRef.current.disconnect(); processorRef.current = null; }
    if (micStreamRef.current)  { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (micCtxRef.current)     { micCtxRef.current.close().catch(() => {}); micCtxRef.current = null; }
    if (playCtxRef.current)    { playCtxRef.current.close().catch(() => {}); playCtxRef.current = null; }

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
    // Note: screen share is NOT stopped on session disconnect — user keeps it
  }, []);

  // ── Connect ────────────────────────────────────────────────────────────────
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

        const ratio = micCtx.sampleRate / 16000;

        processor.onaudioprocess = (ev) => {
          if (micMutedRef.current) return;
          if (ws.readyState !== WebSocket.OPEN) return;
          const f32    = ev.inputBuffer.getChannelData(0);
          const outLen = Math.floor(f32.length / ratio);
          const i16    = new Int16Array(outLen);
          for (let i = 0; i < outLen; i++) {
            i16[i] = Math.max(-32768, Math.min(32767,
              Math.round(f32[Math.round(i * ratio)] * 32767)));
          }
          ws.send(i16.buffer);
        };

        source.connect(processor);
        processor.connect(micCtx.destination);

        isConnectingRef.current = false;
        setIsConnected(true);
        setMode('idle');
      };

      ws.onmessage = async (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data) as {
              type: string;
              tool?: string;
              call_id?: string;
              message?: string;
            };

            if (msg.type === 'ready') {
              setIsConnected(true);

            } else if (msg.type === 'turn_complete') {
              nextPlayTimeRef.current = 0;
              if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
              speakTimerRef.current = setTimeout(() => {
                setMode(micMutedRef.current ? 'idle' : 'listening');
              }, 400);

            } else if (msg.type === 'tool_call') {
              // ── Tool dispatch (extend here for new tools) ────────────────
              if (msg.tool === 'capture_screen') {
                const data = await captureFrame();
                ws.send(JSON.stringify({
                  type:    'frame',
                  call_id: msg.call_id ?? '',
                  data:    data ?? '',         // empty string = no stream active
                }));
              }
              // Future: else if (msg.tool === 'google_search') { ... }

            } else if (msg.type === 'error') {
              console.error('[GeminiLive] error:', msg.message);
              disconnect();
            }
          } catch { /* ignore malformed */ }

        } else if (ev.data instanceof ArrayBuffer && ev.data.byteLength > 0) {
          // PCM audio from Gemini
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

      ws.onclose = () => { setIsConnected(false); setIsMicActive(false); setMode('idle'); };
      ws.onerror = () => disconnect();

    } catch (err) {
      console.error('[GeminiLive] Failed to connect:', err);
      disconnect();
    }
  }, [sessionId, disconnect, captureFrame]);

  // ── Auto-connect when player screen mounts ────────────────────────────────
  useEffect(() => {
    if (sessionId) connect();
    return () => disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Mic toggle ────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    const nowMuted = !micMutedRef.current;
    micMutedRef.current = nowMuted;
    setIsMicActive(!nowMuted);
    setMode(nowMuted ? 'idle' : 'listening');
  }, []);

  // ── Send scene context to Gemini silently ─────────────────────────────────
  const sendContext = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'context', text }));
    }
  }, []);

  return {
    isConnected,
    isMicActive,
    isScreenShared,
    mode,
    toggleMic,
    sendContext,
    shareScreen,
    stopScreenShare,
    disconnect,
  };
}
