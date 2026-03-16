import React, { useEffect } from 'react';

interface Props {
  message:  string | null;
  onDismiss: () => void;
}

export const ErrorToast: React.FC<Props> = ({ message, onDismiss }) => {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100]
                    flex items-center gap-4 px-5 py-3 rounded-lg
                    bg-[#1a0808] border border-red-800 text-red-400 text-sm
                    max-w-[90vw] animate-slide-up">
      <span>{message}</span>
      <button onClick={onDismiss} className="text-red-600 hover:text-red-400 text-lg leading-none">×</button>
    </div>
  );
};
