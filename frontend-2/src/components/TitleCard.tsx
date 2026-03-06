import React from 'react';

interface Props {
  title:   string;
  visible: boolean;
}

export const TitleCard: React.FC<Props> = ({ title, visible }) => (
  <div
    className={`absolute inset-0 flex items-center justify-center z-20 pointer-events-none
      transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
  >
    <h2
      className="font-serif text-center px-8 text-white leading-tight"
      style={{
        fontSize: 'clamp(1.5rem, 5vw, 3.5rem)',
        textShadow: '0 0 40px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.9)',
        letterSpacing: '0.04em',
      }}
    >
      {title}
    </h2>
  </div>
);
