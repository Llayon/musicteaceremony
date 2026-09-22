/**
 * Rhythm Game Core Types & Chart Specifications
 * Timing is audio-clock synchronized (AudioContext.currentTime is the
 * authoritative gameplay timeline). See engine/TimingClock.ts.
 */

/** Hit judgment for a consumed note. */
export type HitRating = 'PERFECT' | 'GOOD' | 'MISS';

/**
 * Immutable chart source data. Chart definitions must never be mutated at
 * runtime — use `getFreshChartEvents()` / `createRuntimeNotes()` to obtain
 * fresh mutable copies per round.
 *
 * NOTE (Gauntlet 0): only `tap` notes are supported. `hold` is intentionally
 * absent from the public type until hold gameplay is implemented. If chart
 * data ever contains an unknown type at runtime it must be rejected safely
 * by the judge (see InputJudge).
 */
export interface ChartNoteDefinition {
  readonly id: string;
  readonly timeMs: number;
  readonly type: 'tap';
  /**
   * When true, the engine plays a quiet wooden anticipation cue ahead of
   * this note (approach window). Default false: the real drum groove
   * carries the timing; cues are reserved for the tutorial and selected
   * pattern openings so they never compete with the music.
   */
  readonly cue?: boolean;
}

/**
 * Mutable per-round runtime state. Created fresh for every round from
 * {@link ChartNoteDefinition}.
 */
export interface RuntimeChartNote extends ChartNoteDefinition {
  status: 'pending' | 'hit' | 'miss';
  rating?: HitRating;
  hitDeltaMs?: number;
}

/**
 * Backwards-compatible alias. Historically `ChartEvent` mixed immutable
 * chart data with mutable runtime fields; new code should prefer the
 * explicit `ChartNoteDefinition` / `RuntimeChartNote` split.
 */
export type ChartEvent = RuntimeChartNote;

export interface ChartMetadata {
  title: string;
  artist: string;
  bpm: number;
  offsetMs: number;
  totalMeasures: number;
  beatsPerMeasure: number;
  songLengthMs: number;
  /** Audio-clock time of grid beat 0 in ms (beat-grid phase). */
  firstBeatOffsetMs: number;
  /**
   * Visual/cue anticipation in beats. Droplets launch this many beats
   * before their target; woodblock cues fire at launch. Musically
   * sensible values are 1–1.5 at ~90 BPM (not the old 2-beat default,
   * which feels painfully slow at 666 ms/beat).
   */
  approachBeats: number;
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
