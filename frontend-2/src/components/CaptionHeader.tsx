import React from 'react';

interface Props {
  text:    string | null;
  visible: boolean;
}

export const CaptionHeader: React.FC<Props> = ({ text, visible }) => (
  <div
    className={`absolute top-[10vh] left-1/2 -translate-x-1/2 z-10 text-center max-w-[70%]
      pointer-events-none transition-opacity duration-500
      font-serif italic text-gold tracking-wider
      ${visible ? 'opacity-100 animate-caption-glow' : 'opacity-0'}`}
    style={{
      fontSize: 'clamp(0.75rem, 1.8vw, 1rem)',
      textShadow: '0 0 20px rgba(201,168,76,0.4)',
    }}
  >
    {text ? `— ${text} —` : ''}
  </div>
);
