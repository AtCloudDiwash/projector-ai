import React from 'react';

interface Props {
  onBack:        () => void;
  onReplayAudio: () => void;
}

export const Controls: React.FC<Props> = ({ onBack, onReplayAudio }) => (
  <div className="absolute top-[10vh] right-6 z-20 flex gap-2
                  opacity-0 group-hover:opacity-100 transition-opacity duration-300">
    <button
      onClick={onBack}
      className="px-3 py-2 text-xs tracking-wider bg-black/60 border border-white/10
                 rounded hover:bg-gold/20 hover:border-gold/30 text-white
                 backdrop-blur-md transition-all duration-200"
    >
      ← New Experience
    </button>
    <button
      onClick={onReplayAudio}
      className="px-3 py-2 text-xs tracking-wider bg-black/60 border border-white/10
                 rounded hover:bg-gold/20 hover:border-gold/30 text-white
                 backdrop-blur-md transition-all duration-200"
    >
      🔊 Replay
    </button>
  </div>
);
