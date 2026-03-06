import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { Scene } from '../types';
import { useAudioPlayer }       from '../hooks/useAudioPlayer';
import { useNarrationRenderer } from '../hooks/useNarrationRenderer';
import { useGeminiLive }        from '../hooks/useGeminiLive';
import { SceneImage }     from './SceneImage';
import { TitleCard }      from './TitleCard';
import { CaptionHeader }  from './CaptionHeader';
import { SubtitleRenderer } from './SubtitleRenderer';
import { GeminiWave }     from './GeminiWave';
import { UnlockOverlay }  from './UnlockOverlay';
import { Controls }       from './Controls';

interface Props {
  sessionId:   string | null;
  queueSize:   number;
  totalScenes: number;
  popScene:    () => Scene | null;
  onBack:      () => void;
}

export const PlayerScreen: React.FC<Props> = ({
  sessionId, queueSize, totalScenes, popScene, onBack,
}) => {
  const isDisplayingRef = useRef(false);
  const subtitleRef     = useRef<HTMLDivElement>(null);

  const audio    = useAudioPlayer();
  const narrator = useNarrationRenderer(subtitleRef);
  const live     = useGeminiLive(sessionId);

  const [showUnlock,     setShowUnlock]     = useState(true);
  const [currentScene,   setCurrentScene]   = useState<Scene | null>(null);
  const [titleVisible,   setTitleVisible]   = useState(false);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [sceneLabel,     setSceneLabel]     = useState('');

  // ── Push scene context to Gemini whenever scene changes ───────────────────
  useEffect(() => {
    if (!currentScene) return;
    const ctx = [
      `Scene ${currentScene.scene_num} of ${totalScenes}: "${currentScene.title}".`,
      currentScene.narration ?? '',
      currentScene.caption ? `Key insight: ${currentScene.caption}` : '',
    ].filter(Boolean).join(' ');
    live.sendContext(ctx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScene]);

  // ── Pause scene when mic is active, resume when done ──────────────────────
  useEffect(() => {
    if (live.isMicActive) {
      audio.pause();
      narrator.stop();
    } else {
      audio.resume();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.isMicActive]);

  // ── Advance to next scene ─────────────────────────────────────────────────
  const tryPlayNext = useCallback(() => {
    if (!audio.audioUnlocked)    return;
    if (isDisplayingRef.current) return;
    if (live.isMicActive)        return;

    const scene = popScene();
    if (!scene) return;

    isDisplayingRef.current = true;
    setTitleVisible(false);
    setCaptionVisible(false);
    narrator.stop();

    requestAnimationFrame(() => {
      setCurrentScene(scene);
      setSceneLabel(`Scene ${scene.scene_num} / ${totalScenes}`);
      setTitleVisible(true);
      if (scene.caption) setTimeout(() => setCaptionVisible(true), 600);

      const onSceneDone = () => {
        narrator.stop();
        setTimeout(() => { isDisplayingRef.current = false; tryPlayNext(); }, 1000);
      };

      if (scene.audio) {
        audio.play(scene.audio, onSceneDone, (durationMs) => {
          setTimeout(() => setTitleVisible(false), 1200);
          const words = scene.narration?.split(/\s+/).filter(Boolean) ?? [];
          if (words.length > 0) narrator.start(words, durationMs);
        });
      } else {
        const words      = scene.narration?.split(/\s+/).filter(Boolean) ?? [];
        const durationMs = Math.max(4000, (words.length / 130) * 60_000);
        if (words.length > 0) narrator.start(words, durationMs);
        setTimeout(() => setTitleVisible(false), 1200);
        setTimeout(onSceneDone, durationMs);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.audioUnlocked, popScene, totalScenes]);

  useEffect(() => {
    if (queueSize > 0) tryPlayNext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSize]);

  const handleUnlock = useCallback(() => {
    audio.unlock();
    setShowUnlock(false);
    setTimeout(tryPlayNext, 50);
  }, [audio, tryPlayNext]);

  // ── Mic toggle — prime context on unmute, then toggle ────────────────────
  const handleMicToggle = useCallback(() => {
    // If about to unmute, send current scene as a fresh context burst first
    if (!live.isMicActive && currentScene) {
      const ctx = `Currently showing Scene ${currentScene.scene_num} of ${totalScenes}: "${currentScene.title}". ${currentScene.narration ?? ''} ${currentScene.caption ? 'Key insight: ' + currentScene.caption : ''}`.trim();
      live.sendContext(ctx);
    }
    live.toggleMic();
  }, [live, currentScene, totalScenes]);

  // ── Space key → handleMicToggle ───────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleMicToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleMicToggle]);

  const handleBack = useCallback(() => {
    audio.stop();
    narrator.stop();
    live.disconnect();
    isDisplayingRef.current = false;
    setCurrentScene(null);
    setTitleVisible(false);
    setCaptionVisible(false);
    setShowUnlock(true);
    onBack();
  }, [audio, narrator, live, onBack]);

  // ── Status label for the monitoring bar ───────────────────────────────────
  const statusDot   = live.isConnected ? 'bg-emerald-400' : 'bg-zinc-600';
  const statusLabel = live.mode === 'speaking'
    ? '◆ AI is responding...'
    : live.isMicActive
      ? '● Listening — speak now'
      : live.isConnected
        ? '● AI Narrator is monitoring · Press Space to ask a question'
        : '○ AI connecting...';

  return (
    <div className="fixed inset-0 bg-black group">
      <div className="relative w-full h-full vignette-bottom overflow-hidden">

        <SceneImage src={currentScene?.image ?? null} />
        <div className="absolute inset-0 film-grain" />

        {/* Letterbox bars */}
        <div className="absolute top-0 left-0 right-0 h-[8vh] bg-black z-10" />
        <div className="absolute bottom-0 left-0 right-0 h-[8vh] bg-black z-10" />

        {/* ── Gemini Live monitoring status bar (inside top letterbox) ── */}
        <div className="absolute top-0 left-0 right-0 h-[8vh] z-20
                        flex items-center justify-center gap-2 px-6">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot} shrink-0`} />
          <span className="text-[10px] tracking-[0.18em] uppercase font-sans
                           text-white/50 truncate">
            {statusLabel}
          </span>
        </div>

        {/* Scene counter */}
        <div className="absolute top-[10vh] left-6 z-10 text-[11px] tracking-[0.15em]
                        uppercase text-gold/70 font-sans">
          {sceneLabel}
        </div>

        {/* Mic toggle button */}
        <button
          onClick={handleMicToggle}
          className={`absolute top-[10vh] right-6 z-20
            px-3 py-1 rounded-full text-[10px] tracking-widest uppercase font-sans
            border transition-all duration-300 cursor-pointer
            ${live.isMicActive
              ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.35)]'
              : 'bg-black/40 border-white/20 text-white/40 hover:border-white/40 hover:text-white/70'
            }`}
        >
          {live.isMicActive ? '⏹ Mute' : '🎙 Speak'}
        </button>

        {/* Short yellow caption — top */}
        <CaptionHeader text={currentScene?.caption ?? null} visible={captionVisible} />

        {/* Scene title card — center */}
        <TitleCard title={currentScene?.title ?? ''} visible={titleVisible} />

        {/* No-image placeholder */}
        {currentScene && !currentScene.image && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center
                          gap-3 text-zinc-600 text-sm">
            <span className="text-5xl opacity-30 animate-pulse-gold">🎬</span>
            <span>Generating visual...</span>
          </div>
        )}

        {/* Word-by-word subtitle — bottom */}
        <SubtitleRenderer ref={subtitleRef} />

        {/* Gemini Live wave — visible when mic on or AI speaking */}
        <GeminiWave isActive={live.isMicActive || live.mode === 'speaking'} mode={live.mode} />

        <Controls onBack={handleBack} onReplayAudio={audio.replayCurrent} />

        {showUnlock && <UnlockOverlay onUnlock={handleUnlock} />}
      </div>
    </div>
  );
};
