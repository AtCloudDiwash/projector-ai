import React, { useState, useEffect, useRef } from 'react';

interface Props {
  src: string | null;
}

// Crossfades between two image slots to create a smooth transition.
// Only re-renders when src changes — no polling.
export const SceneImage: React.FC<Props> = ({ src }) => {
  const [slotA,       setSlotA]       = useState('');
  const [slotB,       setSlotB]       = useState('');
  const [activeSlot,  setActiveSlot]  = useState<'a' | 'b'>('a');
  const prevSrcRef = useRef('');

  useEffect(() => {
    if (!src || src === prevSrcRef.current) return;
    prevSrcRef.current = src;

    if (activeSlot === 'a') {
      setSlotB(src);
      setActiveSlot('b');
    } else {
      setSlotA(src);
      setActiveSlot('a');
    }
  }, [src, activeSlot]);

  return (
    <div className="absolute inset-0">
      <Slot url={slotA} active={activeSlot === 'a'} />
      <Slot url={slotB} active={activeSlot === 'b'} />
    </div>
  );
};

const Slot: React.FC<{ url: string; active: boolean }> = ({ url, active }) => (
  <div
    className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1500
      ${active && url ? 'opacity-100 animate-ken-burns' : 'opacity-0'}`}
    style={{ backgroundImage: url ? `url("${url}")` : undefined }}
  />
);
