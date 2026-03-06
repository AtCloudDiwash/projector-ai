import React from 'react';

interface Props {
  onUnlock: () => void;
}

export const UnlockOverlay: React.FC<Props> = ({ onUnlock }) => (
  <div
    onClick={onUnlock}
    className="absolute inset-0 z-50 flex items-center justify-center cursor-pointer
               bg-black/70 backdrop-blur-sm"
  >
    <div className="text-center">
      <div
        className="text-6xl text-gold animate-pulse-gold mb-4"
        style={{ filter: 'drop-shadow(0 0 30px rgba(201,168,76,0.6))' }}
      >
        ▶
      </div>
      <p className="font-serif text-lg tracking-[0.2em] uppercase text-white">
        Click to Begin
      </p>
    </div>
  </div>
);
