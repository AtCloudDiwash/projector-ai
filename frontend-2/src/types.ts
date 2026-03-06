export type AppScreen = 'upload' | 'loading' | 'player';

export interface Scene {
  scene_num: number;
  title:     string;
  visual_style: string;
  image:     string | null;
  caption:   string | null;
  narration: string | null;
  audio:     string | null;
}

export interface PendingScene {
  scene_num:    number;
  title:        string;
  visual_style: string;
  image:        string | null;
  caption:      string | null;
  narration:    string | null;
  audio:        string | null;
}

export type SSEEventType =
  | 'status'
  | 'scene_start'
  | 'image'
  | 'caption'
  | 'narration_text'
  | 'audio'
  | 'scene_end'
  | 'complete'
  | 'error';

export type GeminiWaveMode = 'idle' | 'listening' | 'speaking';
