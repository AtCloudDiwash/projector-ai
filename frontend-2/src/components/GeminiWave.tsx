import React, { useRef, useEffect, useCallback } from 'react';
import type { GeminiWaveMode } from '../types';

interface Props {
  isActive: boolean;
  mode:     GeminiWaveMode;
}

interface WaveConfig {
  amp:   number;
  freq:  number;
  phase: number;
  color: string;
  width: number;
}

const WAVES: WaveConfig[] = [
  { amp: 32, freq: 0.018, phase: 0,                color: 'rgba(125,211,252,0.75)', width: 3   },
  { amp: 22, freq: 0.024, phase: Math.PI * 0.7,    color: 'rgba(186,230,253,0.55)', width: 2.5 },
  { amp: 38, freq: 0.013, phase: Math.PI * 1.3,    color: 'rgba(224,242,254,0.40)', width: 2   },
  { amp: 16, freq: 0.031, phase: Math.PI * 0.4,    color: 'rgba(255,255,255,0.35)', width: 1.5 },
  { amp: 26, freq: 0.020, phase: Math.PI * 1.8,    color: 'rgba(147,197,253,0.45)', width: 2   },
];

export const GeminiWave: React.FC<Props> = ({ isActive, mode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const phaseRef  = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const cy = height / 2;

    ctx.clearRect(0, 0, width, height);

    const speed   = mode === 'speaking' ? 0.07 : 0.025;
    const breathe = mode === 'speaking'
      ? 1 + 0.45 * Math.sin(phaseRef.current * 1.8)
      : 1 + 0.2  * Math.sin(phaseRef.current * 0.8);

    phaseRef.current += speed;

    WAVES.forEach(w => {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const y = cy
          + w.amp * breathe
          * Math.sin(x * w.freq + phaseRef.current + w.phase)
          * Math.sin(phaseRef.current * 0.4 + w.phase * 0.5);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = w.color;
      ctx.lineWidth   = w.width;
      ctx.stroke();
    });

    // Soft radial fade at edges
    const fade = ctx.createLinearGradient(0, 0, width, 0);
    fade.addColorStop(0,    'rgba(0,0,0,0.7)');
    fade.addColorStop(0.12, 'rgba(0,0,0,0)');
    fade.addColorStop(0.88, 'rgba(0,0,0,0)');
    fade.addColorStop(1,    'rgba(0,0,0,0.7)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);

    rafRef.current = requestAnimationFrame(draw);
  }, [mode]);

  // Start / stop animation based on isActive
  useEffect(() => {
    if (!isActive) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive, draw]);

  // Resize canvas to match element size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`absolute left-0 right-0 z-30 transition-opacity duration-700
        ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ bottom: '18vh', height: '140px' }}
    >
      {/* Dark semi-transparent backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Canvas with CSS blur for fuzzy cosmic glow */}
      <canvas
        ref={canvasRef}
        className="wave-canvas absolute inset-0 w-full h-full"
      />

      {/* Mode label */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2
                      text-[10px] tracking-[0.2em] uppercase text-sky-300/60">
        {mode === 'listening' ? '● Listening' : mode === 'speaking' ? '◆ Speaking' : ''}
      </div>
    </div>
  );
};
