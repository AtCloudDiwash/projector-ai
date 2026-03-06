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
  queueSize:   number;         // increments when new scene is queued
  totalScenes: number;
  popScene:    () => Scene | null;
  onBack:      () => void;
}

export const PlayerScreen: React.FC<Props> = ({
  sessionId, queueSize, totalScenes, popScene, onBack,
}) => {
  // ── Refs that must never trigger re-renders ──────────────
  const isDisplayingRef = useRef(false);
  const subtitleRef     = useRef<HTMLDivElement>(null);

  // ── Hooks ────────────────────────────────────────────────
  const audio    = useAudioPlayer();
  const narrator = useNarrationRenderer(subtitleRef);
  const live     = useGeminiLive(sessionId);

  // ── State (minimal — each triggers ONE targeted re-render) ──
  const [showUnlock,     setShowUnlock]     = useState(true);
  const [currentScene,   setCurrentScene]   = useState<Scene | null>(null);
  const [titleVisible,   setTitleVisible]   = useState(false);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [sceneLabel,     setSceneLabel]     = useState('');

  // ── Pause scene when Gemini Live takes over, resume when done ────────────
  useEffect(() => {
    if (live.isActive) {
      audio.pause();
      narrator.stop();
    } else {
      audio.resume();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.isActive]);

  // ── Advance to next scene ─────────────────────────────────
  const tryPlayNext = useCallback(() => {
    if (!audio.audioUnlocked)   return;
    if (isDisplayingRef.current) return;
    if (live.isActive)           return;  // live agent has the floor

    const scene = popScene();
    if (!scene) return;

    isDisplayingRef.current = true;

    // Reset overlays
    setTitleVisible(false);
    setCaptionVisible(false);
    narrator.stop();

    // Small tick so previous CSS transitions can clear
    requestAnimationFrame(() => {
      setCurrentScene(scene);
      setSceneLabel(`Scene ${scene.scene_num} / ${totalScenes}`);
      setTitleVisible(true);

      // Caption after 600ms
      if (scene.caption) {
        setTimeout(() => setCaptionVisible(true), 600);
      }

      const onSceneDone = () => {
        narrator.stop();
        setTimeout(() => {
          isDisplayingRef.current = false;
          tryPlayNext();
        }, 1000);
      };

      if (scene.audio) {
        audio.play(
          scene.audio,
          onSceneDone,
          (durationMs: number) => {
            // Hide title card and start subtitles once we know duration
            setTimeout(() => setTitleVisible(false), 1200);
            const words = scene.narration?.split(/\s+/).filter(Boolean) ?? [];
            if (words.length > 0) narrator.start(words, durationMs);
          },
        );
      } else {
        // No audio — estimate timing from word count
        const words      = scene.narration?.split(/\s+/).filter(Boolean) ?? [];
        const durationMs = Math.max(4000, (words.length / 130) * 60_000);
        if (words.length > 0) narrator.start(words, durationMs);
        setTimeout(() => setTitleVisible(false), 1200);
        setTimeout(onSceneDone, durationMs);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.audioUnlocked, popScene, totalScenes]);

  // ── React to new scenes arriving in the queue ─────────────
  // queueSize increments each time a scene is pushed.
  // Only attempt to play if we're idle — avoids redundant calls.
  useEffect(() => {
    if (queueSize > 0) tryPlayNext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSize]);

  // ── Unlock handler ────────────────────────────────────────
  const handleUnlock = useCallback(() => {
    audio.unlock();
    setShowUnlock(false);
    // queueSize may already have scenes waiting
    setTimeout(tryPlayNext, 50);
  }, [audio, tryPlayNext]);

  // ── Space key → toggle Gemini Live ───────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        live.toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // live.toggle ref changes only when isActive changes — stable enough
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.toggle]);

  // ── Back button ───────────────────────────────────────────
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

  return (
    <div className="fixed inset-0 bg-black group">
      {/* Cinematic stage */}
      <div className="relative w-full h-full vignette-bottom overflow-hidden">

        {/* Background images */}
        <SceneImage src={currentScene?.image ?? null} />

        {/* Film grain */}
        <div className="absolute inset-0 film-grain" />

        {/* Letterbox bars */}
        <div className="absolute top-0 left-0 right-0 h-[8vh] bg-black z-10" />
        <div className="absolute bottom-0 left-0 right-0 h-[8vh] bg-black z-10" />

        {/* Scene counter */}
        <div className="absolute top-[10vh] left-6 z-10 text-[11px] tracking-[0.15em]
                        uppercase text-gold/70 font-sans">
          {sceneLabel}
        </div>

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

        {/* Gemini Live wave — press Space or click button to toggle */}
        <GeminiWave isActive={live.isActive} mode={live.mode} />

        {/* Ask AI toggle button */}
        <button
          onClick={live.toggle}
          className={`absolute z-40 bottom-[10vh] right-6
            px-4 py-2 rounded-full text-xs tracking-widest uppercase font-sans
            border transition-all duration-300 cursor-pointer
            ${live.isActive
              ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
              : 'bg-black/40 border-white/20 text-white/50 hover:border-white/50 hover:text-white/80'
            }`}
        >
          {live.isActive ? '◼ Stop AI' : '◆ Ask AI'}
        </button>

        {/* Controls (visible on hover) */}
        <Controls onBack={handleBack} onReplayAudio={audio.replayCurrent} />

        {/* Unlock overlay */}
        {showUnlock && <UnlockOverlay onUnlock={handleUnlock} />}
      </div>
    </div>
  );
};
