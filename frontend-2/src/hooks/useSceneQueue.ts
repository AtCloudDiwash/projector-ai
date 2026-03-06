import { useRef, useState, useCallback } from 'react';
import type { Scene, PendingScene } from '../types';

interface UseSceneQueueReturn {
  queueSize:        number;       // increments when a scene is pushed — triggers re-render
  totalScenes:      number;
  progress:         number;
  loadingMessage:   string;
  isStreamComplete: boolean;
  popScene:         () => Scene | null;
  startSession:     (sessionId: string, onFirstReady: () => void, onError: (m: string) => void) => void;
  stopSession:      () => void;
}

export function useSceneQueue(): UseSceneQueueReturn {
  // These live in refs — never trigger re-renders
  const esRef      = useRef<EventSource | null>(null);
  const pendingRef = useRef<PendingScene | null>(null);
  const queueRef   = useRef<Scene[]>([]);
  const firstReadyRef = useRef(false);
  const onFirstReadyRef = useRef<(() => void) | null>(null);
  const onErrorRef = useRef<((m: string) => void) | null>(null);

  // Only these trigger re-renders
  const [queueSize,        setQueueSize]        = useState(0);
  const [totalScenes,      setTotalScenes]      = useState(0);
  const [progress,         setProgress]         = useState(0);
  const [loadingMessage,   setLoadingMessage]   = useState('');
  const [isStreamComplete, setIsStreamComplete] = useState(false);

  const popScene = useCallback((): Scene | null => {
    const scene = queueRef.current.shift() ?? null;
    if (scene) setQueueSize(queueRef.current.length);
    return scene;
  }, []);

  // Stable event handler — stored in ref so ESref closure stays fresh
  const handleRawEvent = useCallback((raw: string) => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); }
    catch { console.warn('Bad SSE JSON:', raw); return; }

    switch (data.type as string) {
      case 'status':
        setProgress((data.progress as number) ?? 0);
        setLoadingMessage((data.message as string) ?? '');
        break;

      case 'scene_start':
        setTotalScenes(prev => Math.max(prev, (data.total_scenes as number) ?? 0));
        pendingRef.current = {
          scene_num:    (data.scene_num as number),
          title:        (data.title as string)        ?? `Scene ${data.scene_num}`,
          visual_style: (data.visual_style as string) ?? 'cinematic',
          image: null, caption: null, narration: null, audio: null,
        };
        break;

      case 'image':
        if (!pendingRef.current) break;
        if (data.delivery === 'url' && data.url)
          pendingRef.current.image = data.url as string;
        else if (data.data)
          pendingRef.current.image = `data:${data.mime_type ?? 'image/png'};base64,${data.data}`;
        break;

      case 'caption':
        if (pendingRef.current)
          pendingRef.current.caption = (data.text as string) ?? null;
        break;

      case 'narration_text':
        if (pendingRef.current)
          pendingRef.current.narration = (data.text as string) ?? null;
        break;

      case 'audio':
        if (pendingRef.current && data.data)
          pendingRef.current.audio = `data:${data.mime_type ?? 'audio/mpeg'};base64,${data.data}`;
        break;

      case 'scene_end': {
        if (!pendingRef.current) break;
        queueRef.current.push({ ...pendingRef.current });
        pendingRef.current = null;
        setQueueSize(queueRef.current.length);
        // Signal first scene ready only once
        if (!firstReadyRef.current) {
          firstReadyRef.current = true;
          onFirstReadyRef.current?.();
        }
        break;
      }

      case 'complete':
        setIsStreamComplete(true);
        break;

      case 'error':
        onErrorRef.current?.((data.message as string) ?? 'An unknown error occurred.');
        break;
    }
  }, []);

  const startSession = useCallback((
    sessionId: string,
    onFirstReady: () => void,
    onError: (m: string) => void,
  ) => {
    // Reset everything
    esRef.current?.close();
    queueRef.current      = [];
    pendingRef.current    = null;
    firstReadyRef.current = false;
    onFirstReadyRef.current = onFirstReady;
    onErrorRef.current      = onError;
    setQueueSize(0);
    setTotalScenes(0);
    setProgress(0);
    setLoadingMessage('');
    setIsStreamComplete(false);

    const es = new EventSource(`/stream/${sessionId}`);
    esRef.current = es;
    es.onmessage = (e: MessageEvent<string>) => handleRawEvent(e.data);
    es.onerror   = () => {
      es.close();
      onError('Lost connection to the server. Please try again.');
    };
  }, [handleRawEvent]);

  const stopSession = useCallback(() => {
    esRef.current?.close();
    esRef.current         = null;
    queueRef.current      = [];
    pendingRef.current    = null;
    firstReadyRef.current = false;
    setQueueSize(0);
    setTotalScenes(0);
    setProgress(0);
    setIsStreamComplete(false);
  }, []);

  return {
    queueSize, totalScenes, progress, loadingMessage, isStreamComplete,
    popScene, startSession, stopSession,
  };
}
