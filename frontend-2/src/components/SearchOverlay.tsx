import React from 'react';
import type { SearchResult } from '../types';

interface Props {
  result:  SearchResult;
  onClose: () => void;
}

export const SearchOverlay: React.FC<Props> = ({ result, onClose }) => (
  <div className="absolute top-[9vh] bottom-[9vh] inset-x-6 z-50 flex items-center justify-center pointer-events-none">
    <div
      className="pointer-events-auto w-full max-w-2xl max-h-full flex flex-col
                 bg-zinc-950/88 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
    >

      {/* ── Header ── */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-white/8 shrink-0">
        <div>
          <p className="text-[9px] uppercase tracking-[0.22em] text-white/35 mb-1">Web Search</p>
          <p className="text-xs text-white/55 italic leading-snug">"{result.query}"</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close search"
          className="text-white/30 hover:text-white/80 transition-colors duration-150
                     text-base leading-none ml-4 mt-0.5 shrink-0"
        >
          ✕
        </button>
      </div>

      {/* ── Summary (scrollable if long) ── */}
      <div className="px-5 py-4 overflow-y-auto">
        <p className="text-sm leading-relaxed text-white/92 whitespace-pre-wrap">
          {result.summary}
        </p>
      </div>

      {/* ── Sources ── */}
      {result.sources.length > 0 && (
        <div className="px-5 pb-4 pt-3 border-t border-white/8 shrink-0">
          <p className="text-[9px] uppercase tracking-[0.22em] text-white/35 mb-2">Sources</p>
          <div className="flex flex-col gap-1.5">
            {result.sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-sky-400 hover:text-sky-200 transition-colors
                           duration-150 truncate underline underline-offset-2 decoration-sky-400/40"
                title={s.url}
              >
                {s.title || s.url}
              </a>
            ))}
          </div>
        </div>
      )}

    </div>
  </div>
);
