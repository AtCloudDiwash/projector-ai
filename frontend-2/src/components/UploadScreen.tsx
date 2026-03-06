import React, { useRef, useState, useCallback } from 'react';

interface Props {
  onSessionStart: (sessionId: string) => void;
  onError:        (msg: string) => void;
}

const ALLOWED_EXTS = new Set([
  'txt','md','pdf','csv','json','yaml','yml','png','jpg','jpeg','webp','xml','html',
]);

export const UploadScreen: React.FC<Props> = ({ onSessionStart, onError }) => {
  const [file,      setFile]      = useState<File | null>(null);
  const [prompt,    setPrompt]    = useState('');
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTS.has(ext)) {
      onError(`Unsupported file type ".${ext}"`);
      return;
    }
    setFile(f);
  }, [onError]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !prompt.trim() || uploading) return;
    setUploading(true);

    const body = new FormData();
    body.append('file', file);
    body.append('prompt', prompt.trim());

    try {
      const res = await fetch('/upload', { method: 'POST', body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `Upload failed (${res.status})`);
      }
      const data = await res.json() as { session_id: string };
      onSessionStart(data.session_id);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }, [file, prompt, uploading, onSessionStart, onError]);

  const canStart = file !== null && prompt.trim().length > 0 && !uploading;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      {/* Radial glow background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#111_0%,#000_100%)]" />

      {/* Top-left navbar */}
      <div className="absolute top-5 left-5 z-20 flex items-center gap-2">
        <img src="/logo.svg" alt="Projector.AI" className="h-7 w-auto" />
        <span className="text-sm font-medium tracking-[0.12em] text-white/80 uppercase">Projector.AI</span>
      </div>

      <div className="relative z-10 w-full max-w-[560px] px-6 flex flex-col gap-6">
        {/* Logo */}
        <div className="text-center">
          <div className="text-4xl text-gold animate-pulse-gold mb-2" style={{ filter: 'drop-shadow(0 0 20px rgba(201,168,76,0.5))' }}>▶</div>
          <h1 className="font-serif text-[2rem] font-normal tracking-wide text-white">The Cinematic Narrator</h1>
          <p className="mt-1 text-xs text-zinc-500 tracking-[0.1em] uppercase">Transform any document into a live cinematic experience</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Drop zone */}
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }}
              className={`border border-dashed rounded-lg p-10 text-center cursor-pointer transition-all duration-300
                ${dragging
                  ? 'border-gold/50 bg-gold/5'
                  : 'border-zinc-800 bg-white/[0.02] hover:border-gold/30 hover:bg-gold/[0.03]'
                }`}
            >
              <div className="text-3xl opacity-40 mb-2">📄</div>
              <div className="text-sm text-white">Drop your file here</div>
              <div className="text-xs text-zinc-500 mt-1">or click to browse</div>
              <div className="text-[10px] text-zinc-700 mt-3 tracking-widest uppercase">
                PDF · TXT · MD · CSV · JSON · PNG · JPG · and more
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.pdf,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.webp,.xml,.html"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gold/[0.08] border border-gold/30">
              <span className="text-xl">📄</span>
              <span className="flex-1 text-gold text-sm truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-zinc-500 hover:text-red-400 text-lg transition-colors"
              >×</button>
            </div>
          )}

          {/* Prompt */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              What story should I tell?
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              placeholder="e.g. 'Tell this like a Netflix documentary' or 'Make it dramatic and cinematic'"
              className="w-full bg-white/[0.04] border border-zinc-800 focus:border-gold/40 rounded-lg px-4 py-3
                         text-white text-sm font-sans resize-none outline-none transition-colors duration-200
                         placeholder:text-zinc-700"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!canStart}
            className={`w-full py-4 rounded-lg font-bold tracking-[0.08em] uppercase text-sm
              flex items-center justify-center gap-2 transition-all duration-200
              ${canStart
                ? 'bg-gold text-black hover:bg-gold-bright hover:-translate-y-px cursor-pointer'
                : 'bg-gold/30 text-black/50 cursor-not-allowed'
              }`}
          >
            {uploading ? (
              <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : '▶'}
            {uploading ? 'Uploading...' : 'Begin Cinematic Experience'}
          </button>
        </form>
      </div>
    </div>
  );
};
