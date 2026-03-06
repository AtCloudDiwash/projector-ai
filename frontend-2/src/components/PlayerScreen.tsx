import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { Scene } from '../types';
import { useAudioPlayer }       from '../hooks/useAudioPlayer';
import { useNarrationRenderer } from '../hooks/useNarrationRenderer';
import { SceneImage }     from './SceneImage';
import { TitleCard }      from './TitleCard';
import { CaptionHeader }  from './CaptionHeader';
import { SubtitleRenderer } from './SubtitleRenderer';
import { GeminiWave }     from './GeminiWave';
import { UnlockOverlay }  from './UnlockOverlay';
import { Controls }       from './Controls';

interface Props {
  queueSize:   number;         // increments when new scene is queued
  totalScenes: number;
  popScene:    () => Scene | null;
  onBack:      () => void;
}

export const PlayerScreen: React.FC<Props> = ({
  queueSize, totalScenes, popScene, onBack,
}) => {
  // ── Refs that must never trigger re-renders ──────────────
  const isDisplayingRef = useRef(false);
  const subtitleRef     = useRef<HTMLDivElement>(null);

  // ── Hooks ────────────────────────────────────────────────
  const audio    = useAudioPlayer();
  const narrator = useNarrationRenderer(subtitleRef);

  // ── State (minimal — each triggers ONE targeted re-render) ──
  const [showUnlock,     setShowUnlock]     = useState(true);
  const [currentScene,   setCurrentScene]   = useState<Scene | null>(null);
  const [titleVisible,   setTitleVisible]   = useState(false);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [sceneLabel,     setSceneLabel]     = useState('');

  // ── Advance to next scene ─────────────────────────────────
  const tryPlayNext = useCallback(() => {
    if (!audio.audioUnlocked)   return;
    if (isDisplayingRef.current) return;

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

  // ── Back button ───────────────────────────────────────────
  const handleBack = useCallback(() => {
    audio.stop();
    narrator.stop();
    isDisplayingRef.current = false;
    setCurrentScene(null);
    setTitleVisible(false);
    setCaptionVisible(false);
    setShowUnlock(true);
    onBack();
  }, [audio, narrator, onBack]);

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

        {/* Gemini wave — placeholder, wired up when Gemini Live is integrated */}
        <GeminiWave isActive={false} mode="idle" />

        {/* Controls (visible on hover) */}
        <Controls onBack={handleBack} onReplayAudio={audio.replayCurrent} />

        {/* Unlock overlay */}
        {showUnlock && <UnlockOverlay onUnlock={handleUnlock} />}
      </div>
    </div>
  );
};
