import React, { useState, useCallback } from 'react';
import type { AppScreen } from './types';
import { useSceneQueue }   from './hooks/useSceneQueue';
import { UploadScreen }    from './components/UploadScreen';
import { LoadingScreen }   from './components/LoadingScreen';
import { PlayerScreen }    from './components/PlayerScreen';
import { ErrorToast }      from './components/ErrorToast';

export const App: React.FC = () => {
  const [screen, setScreen] = useState<AppScreen>('upload');
  const [error,  setError]  = useState<string | null>(null);

  const queue = useSceneQueue();

  const handleError = useCallback((msg: string) => {
    setError(msg);
    // If still on loading screen, go back to upload
    setScreen(prev => prev === 'loading' ? 'upload' : prev);
  }, []);

  const handleSessionStart = useCallback((sessionId: string) => {
    setScreen('loading');
    queue.startSession(
      sessionId,
      () => setScreen('player'),  // first scene ready
      handleError,
    );
  }, [queue, handleError]);

  const handleBack = useCallback(() => {
    queue.stopSession();
    setScreen('upload');
  }, [queue]);

  return (
    <>
      {screen === 'upload' && (
        <UploadScreen onSessionStart={handleSessionStart} onError={handleError} />
      )}

      {screen === 'loading' && (
        <LoadingScreen progress={queue.progress} message={queue.loadingMessage} />
      )}

      {screen === 'player' && (
        <PlayerScreen
          queueSize={queue.queueSize}
          totalScenes={queue.totalScenes}
          popScene={queue.popScene}
          onBack={handleBack}
        />
      )}

      <ErrorToast message={error} onDismiss={() => setError(null)} />
    </>
  );
};
