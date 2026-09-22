/**
 * Rhythm Game Core Types & Chart Specifications
 * Designed for Telegram Mini Apps with sub-millisecond precision
 */

export type HitRating = 'PERFECT' | 'GOOD' | 'MISS';

export interface ChartEvent {
  id: string;
  timeMs: number;
  type: 'tap' | 'hold';
  status: 'pending' | 'hit' | 'miss';
  rating?: HitRating;
  hitDeltaMs?: number;
  // Hold note duration if type === 'hold'
  durationMs?: number;
}

export interface ChartMetadata {
  title: string;
  artist: string;
  bpm: number;
  offsetMs: number;
  totalMeasures: number;
  beatsPerMeasure: number;
  songLengthMs: number;
}

export interface GameScore {
  score: number;
  combo: number;
  maxCombo: number;
  perfectCount: number;
  goodCount: number;
  missCount: number;
  accuracy: number;
  zenLevel: number; // 0 to 100%
  rank: 'SUPERB' | 'OK' | 'TRY_AGAIN' | 'ZEN_MASTER';
}

export interface SpritesheetFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpritesheetManifest {
  meta: {
    image: string;
    size: { w: number; h: number };
    scale: number;
  };
  frames: Record<string, SpritesheetFrame>;
}

export interface AudioEngineStats {
  songTimeMs: number;
  audioCurrentTime: number;
  trackStartTime: number;
  isPlaying: boolean;
  bpm: number;
  currentBeat: number;
  currentMeasure: number;
}
