import { forwardRef } from 'react';

// This component is a pure DOM container.
// Words are injected directly via useNarrationRenderer (imperative DOM manipulation).
// No React state here — zero re-renders during word-by-word playback.
export const SubtitleRenderer = forwardRef<HTMLDivElement>((_, ref) => (
  <div
    className="absolute bottom-[10vh] left-1/2 -translate-x-1/2 z-10 w-[70%] text-center pointer-events-none"
  >
    <div
      ref={ref}
      className="font-serif text-white/90 leading-[1.8]"
      style={{
        fontSize: 'clamp(0.85rem, 1.9vw, 1.15rem)',
        letterSpacing: '0.01em',
        textShadow: '0 1px 4px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.8)',
      }}
    />
  </div>
));

SubtitleRenderer.displayName = 'SubtitleRenderer';
