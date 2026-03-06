import React from 'react';

interface Props {
  progress: number;
  message:  string;
}

export const LoadingScreen: React.FC<Props> = ({ progress, message }) => (
  <div className="fixed inset-0 flex flex-col items-center justify-center gap-8 bg-black">
    {/* Film reel */}
    <div
      className="w-20 h-20 rounded-full border-[3px] border-gold relative animate-reel-spin"
      style={{ filter: 'drop-shadow(0 0 16px rgba(201,168,76,0.4))' }}
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gold" />
      {[0, 60, 120].map(deg => (
        <div
          key={deg}
          className="absolute top-1/2 left-1/2 w-[3px] h-9 bg-gold rounded-sm origin-top"
          style={{ transform: `translate(-50%, 0) rotate(${deg}deg)` }}
        />
      ))}
    </div>

    {/* Message */}
    <h2 className="font-serif text-xl font-normal text-white text-center px-8 max-w-sm">
      {message || 'Preparing your cinematic experience...'}
    </h2>

    {/* Progress bar */}
    <div className="flex flex-col items-center gap-2 w-72">
      <div className="w-full h-[2px] bg-zinc-900 rounded-full overflow-hidden">
        <div
          className="h-full bg-gold rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs text-zinc-500 tracking-[0.1em]">{Math.round(progress)}%</span>
    </div>
  </div>
);
