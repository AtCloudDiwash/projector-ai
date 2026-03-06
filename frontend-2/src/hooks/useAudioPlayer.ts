import { useRef, useState, useCallback } from 'react';

// Silent MP3 to unlock browser autoplay on first user gesture
const SILENT_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA//8AAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAAAB8zvYVUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAABAAACcQCAgA==';

interface UseAudioPlayerReturn {
  audioUnlocked: boolean;
  unlock:        () => void;
  play:          (src: string, onEnded: () => void, onMetadata: (durationMs: number) => void) => void;
  stop:          () => void;
  replayCurrent: () => void;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const unlock = useCallback(() => {
    const silent = new Audio(SILENT_MP3);
    silent.play().catch(() => {/* silently fail */});
    setAudioUnlocked(true);
  }, []);

  const stop = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.src = '';
    audioRef.current = null;
  }, []);

  const play = useCallback((
    src: string,
    onEnded: () => void,
    onMetadata: (durationMs: number) => void,
  ) => {
    // Stop previous
    stop();

    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      onMetadata(audio.duration * 1000);
    }, { once: true });

    audio.addEventListener('ended', onEnded, { once: true });

    audio.play().catch((err: unknown) => {
      console.warn('Audio play failed:', err);
      // Don't auto-advance — user must use replay button
    });
  }, [stop]);

  const replayCurrent = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(console.warn);
  }, []);

  return { audioUnlocked, unlock, play, stop, replayCurrent };
}
