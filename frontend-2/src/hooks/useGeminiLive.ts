/**
 * Gemini Live — always-on session hook.
 *
 * Session opens automatically when sessionId is set.
 * Space key only mutes/unmutes mic — memory persists across turns.
 * Screen share: user clicks "Share Screen" once → persistent video element
 *   streams one JPEG frame/sec to backend via {"type":"screen_frame","data":"..."}.
 *   Gemini receives frames continuously via LiveClientRealtimeInput.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { GeminiWaveMode, SearchResult } from '../types';


export interface UseGeminiLiveReturn {
  isConnected:      boolean;
  isMicActive:      boolean;
  isScreenShared:   boolean;
  isSearching:      boolean;
  mode:             GeminiWaveMode;
  searchResult:     SearchResult | null;
  toggleMic:        () => void;
  sendContext:      (text: string) => void;
  shareScreen:      () => Promise<void>;
  stopScreenShare:  () => void;
  clearSearchResult: () => void;
  disconnect:       () => void;
}

export function useGeminiLive(sessionId: string | null): UseGeminiLiveReturn {
  const [isConnected,    setIsConnected]    = useState(false);
  const [isMicActive,    setIsMicActive]    = useState(false);
  const [isScreenShared, setIsScreenShared] = useState(false);
  const [isSearching,    setIsSearching]    = useState(false);
  const [mode,           setMode]           = useState<GeminiWaveMode>('idle');
  const [searchResult,   setSearchResult]   = useState<SearchResult | null>(null);

  const wsRef            = useRef<WebSocket | null>(null);
  const micCtxRef        = useRef<AudioContext | null>(null);
  const playCtxRef       = useRef<AudioContext | null>(null);
  const micStreamRef     = useRef<MediaStream | null>(null);
  const screenStreamRef  = useRef<MediaStream | null>(null);  // getDisplayMedia stream
  const screenVideoRef   = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const screenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processorRef     = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef  = useRef<number>(0);
  const speakTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micMutedRef      = useRef<boolean>(true);
  const isConnectingRef  = useRef<boolean>(false);

  // ── Screen share ───────────────────────────────────────────────────────────
  const stopScreenShare = useCallback(() => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
      screenVideoRef.current.remove();
      screenVideoRef.current = null;
    }
    screenCanvasRef.current = null;
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenShared(false);
  }, []);

  const shareScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions);

      screenStreamRef.current = stream;

      // Create one persistent video element, attached to DOM (hidden) so
      // browsers reliably decode frames from tab-capture streams.
      const video = document.createElement('video');
      video.muted       = true;
      video.playsInline = true;
      video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(video);
      screenVideoRef.current = video;

      // Create one persistent canvas sized to the video track
      const canvas = document.createElement('canvas');
      screenCanvasRef.current = canvas;

      video.srcObject = stream;

      // Wait for canplay — guarantees a real frame is available before we start
      video.addEventListener('canplay', () => {
        canvas.width  = video.videoWidth  || 1280;
        canvas.height = video.videoHeight || 720;
        video.play().catch(() => {});

        // Send one frame per second to Gemini
        screenIntervalRef.current = setInterval(() => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          if (video.readyState < 2) return; // no decoded frame yet

          canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

          canvas.toBlob((blob) => {
            if (!blob) return;
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'screen_frame', data: base64 }));
              }
            };
            reader.readAsDataURL(blob);
          }, 'image/jpeg', 0.7);
        }, 1000);
      }, { once: true });

      // Auto-clean when user stops via browser chrome
      stream.getVideoTracks()[0].addEventListener('ended', stopScreenShare, { once: true });
      setIsScreenShared(true);
    } catch (err) {
      console.warn('[GeminiLive] Screen share cancelled or denied:', err);
    }
  }, [stopScreenShare]);

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
              type:     string;
              message?: string;
              // search_result fields
              query?:   string;
              summary?: string;
              sources?: { title: string; url: string }[];
            };

            if (msg.type === 'ready') {
              setIsConnected(true);

            } else if (msg.type === 'searching') {
              setIsSearching(true);

            } else if (msg.type === 'search_result') {
              setIsSearching(false);
              setSearchResult({
                query:   msg.query   ?? '',
                summary: msg.summary ?? '',
                sources: msg.sources ?? [],
              });

            } else if (msg.type === 'turn_complete') {
              nextPlayTimeRef.current = 0;
              if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
              speakTimerRef.current = setTimeout(() => {
                setMode(micMutedRef.current ? 'idle' : 'listening');
              }, 400);

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
  }, [sessionId, disconnect]);

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

  // ── Clear search result overlay ───────────────────────────────────────────
  const clearSearchResult = useCallback(() => setSearchResult(null), []);

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
    isSearching,
    mode,
    searchResult,
    toggleMic,
    sendContext,
    shareScreen,
    stopScreenShare,
    clearSearchResult,
    disconnect,
  };
}
