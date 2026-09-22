import { ChartMetadata, ChartNoteDefinition, RuntimeChartNote } from '../types';

/**
 * "Rhodes & Rimshot Groove" — production beatmap, authored against the real
 * master (public/audio/zen-tea-ceremony.mp3), NOT the old procedural grid.
 *
 * Verified musical analysis (drums-stem transient analysis + master energy):
 * - tempo: 90 BPM, constant end-to-end (drift ≈ -0.12 ms/s, ≈15 ms over the
 *   whole track; mean residual ≈ 10 ms — a single-BPM grid is honest here)
 * - grid phase: beat k at 40 + k × 666.666… ms (band entry lands exactly on
 *   beat 15 = 10 040 ms; intro Rhodes stab exactly on beat 11.5)
 * - meter: 4/4, 8-bar sections; groove bars 1–48 (10.04 s → 138.04 s)
 * - intro 0–10 s (Rhodes only, no drums), outro fill 139.4–143.4 s,
 *   final Rhodes swell on beat 225 (150.04 s), silence from ≈156.5 s
 * - vocals stem is digitally silent and is excluded from the master
 * - one deliberate off-grid exception: bar 33 beat 2 sits on the pushed
 *   snare at 95 968 ms (−72 ms vs the grid beat at 96 040 ms, where the
 *   drums play nothing — verified against drums/bass/other transients;
 *   neighbours b33.b1 (+8 ms) and b33.b3 (+1 ms) stay on-grid)
 *
 * Gameplay direction (Rhythm Heaven, not note-highway): taps answer musical
 * phrases — backbeat rimshots, section downbeats, fill accents. Woodblock
 * cues (`cue: true`) fire ONLY for the tutorial and selected pattern
 * openings; everywhere else the real drum groove carries the timing.
 *
 * Timestamps below are COMPILED at definition time from bar/beat helpers —
 * explicit, immutable, no runtime drift accumulation.
 */

export const TRACK_BPM = 90;
export const BEAT_MS = 60000 / TRACK_BPM; // 666.666… ms
export const BAR_MS = BEAT_MS * 4; // 2666.666… ms

/** Audio-clock time of grid beat 0 (grid phase), in ms. */
export const FIRST_BEAT_MS = 40;

/** First full-groove bar starts on grid beat 15 (band entry @ 10 040 ms). */
const FIRST_BAR_BEAT = 15;
const BAR1_MS = FIRST_BEAT_MS + FIRST_BAR_BEAT * BEAT_MS; // 10 040 ms

/** Grid beat k (0-based from track start) → ms. */
export const gridBeat = (k: number): number => Math.round(FIRST_BEAT_MS + k * BEAT_MS);

/** Bar/beat/subdivision (1-based beat, sub in beats, e.g. 0.5 = 8th) → ms. */
export const at = (bar: number, beat: number, sub = 0): number =>
  Math.round(BAR1_MS + ((bar - 1) * 4 + (beat - 1) + sub) * BEAT_MS);

export const ZEN_CHART_METADATA: ChartMetadata = {
  title: 'Rhodes & Rimshot Groove',
  artist: 'Zen Tea Ceremony Band',
  bpm: TRACK_BPM,
  offsetMs: 0,
  beatsPerMeasure: 4,
  totalMeasures: 48,
  songLengthMs: 159019, // decoded master duration (ffprobe 159.018667 s)
  firstBeatOffsetMs: FIRST_BEAT_MS,
  approachBeats: 1.5, // 1000 ms droplet flight at 90 BPM (not the old 2-beat drag)
};

interface BeatSpec {
  b: number;
  sub?: number;
  cue?: boolean;
}

const buildBar = (bar: number, beats: Array<number | BeatSpec>): ChartNoteDefinition[] =>
  beats.map((spec) => {
    const { b, sub = 0, cue = false } =
      typeof spec === 'number' ? { b: spec, sub: 0, cue: false } : spec;
    const subSuffix = sub === 0 ? '' : sub === 0.5 ? '_and' : `_s${String(sub).replace('.', 'p')}`;
    return {
      id: `b${bar}_${b}${subSuffix}`,
      timeMs: at(bar, b, sub),
      type: 'tap' as const,
      ...(cue ? { cue: true as const } : {}),
    };
  });

const tutorial = (id: string, timeMs: number): ChartNoteDefinition => ({
  id,
  timeMs,
  type: 'tap',
  cue: true,
});

const outroTap = (id: string, gridK: number, cue = false): ChartNoteDefinition => ({
  id,
  timeMs: gridBeat(gridK),
  type: 'tap',
  ...(cue ? { cue: true as const } : {}),
});

function authorChart(): ChartNoteDefinition[] {
  const events: ChartNoteDefinition[] = [
    // --- INTRO: Rhodes only. Two taught responses + band-entry payoff. ---
    tutorial('t_intro_1', gridBeat(12)), // 8 040 ms
    tutorial('t_intro_2', gridBeat(14)), // 9 373 ms
    tutorial('t_downbeat', at(1, 1)), // 10 040 ms — full band entry
  ];

  // --- GROOVE A (bars 1–8): learn the backbeat (rimshots on 2 & 4). ---
  events.push(...buildBar(1, [{ b: 2, cue: true }, 4]));
  events.push(...buildBar(2, [2, 4]));
  events.push(...buildBar(3, [2, 4]));
  events.push(...buildBar(4, [2, 4]));
  events.push(...buildBar(5, [1, 2, 3, 4]));
  events.push(...buildBar(6, [1, 2, 3, 4]));
  events.push(...buildBar(7, [2, 4]));
  events.push(...buildBar(8, [2, 4]));

  // --- VARIATION (bars 9–16): first 8th-note pickups. ---
  events.push(...buildBar(9, [2, { b: 3, sub: 0.5 }, 4]));
  events.push(...buildBar(10, [2, 4, { b: 4, sub: 0.5 }]));
  events.push(...buildBar(11, [2, { b: 3, sub: 0.5 }, 4]));
  events.push(...buildBar(12, [1, 2, 4]));
  events.push(...buildBar(13, [2, { b: 3, sub: 0.5 }, 4]));
  events.push(...buildBar(14, [1, { b: 2, sub: 0.5 }, 4]));
  events.push(...buildBar(15, [1, 2, 3, 4]));
  events.push(...buildBar(16, [1, 2, 3, 4]));

  // --- BUILD (bars 17–24): call-and-response, denser into the peak. ---
  events.push(...buildBar(17, [{ b: 1, cue: true }, 2, { b: 2, sub: 0.5 }, 4]));
  events.push(...buildBar(18, [1, 3]));
  events.push(...buildBar(19, [2, 3, 4, { b: 4, sub: 0.5 }]));
  events.push(...buildBar(20, [1, 2, 3, 4]));
  events.push(...buildBar(21, [1, 2, { b: 2, sub: 0.5 }, 4]));
  events.push(...buildBar(22, [1, 3]));
  events.push(...buildBar(23, [2, 3, 4, { b: 4, sub: 0.5 }]));
  events.push(...buildBar(24, [1, 2, 3, 4]));

  // --- PEAK (bars 25–40): most demanding but readable; breathers kept. ---
  events.push(...buildBar(25, [{ b: 1, cue: true }, 2, 3, 4]));
  events.push(...buildBar(26, [1, 2, 3, 4]));
  events.push(...buildBar(27, [1, 3]));
  events.push(...buildBar(28, [1, 2, 3, 4])); // music hit (bar 28 ≈ 84 s)
  events.push(...buildBar(29, [1, 2, 3, 4]));
  events.push(...buildBar(30, [1, 3]));
  events.push(...buildBar(31, [1, 3]));
  events.push(...buildBar(32, [1, 2, { b: 3, sub: 0.5 }, 4])); // build 92–96 s:
  // beat 3 is a real rest in the groove (drums drop to novelty floor there)
  // before the strong 8th pickup — tapping silence would be wrong, so the
  // rest is kept as musical tension, not a note.
  events.push(...buildBar(33, [1]));
  // Pushed snare: answers the real hit at 95 968 ms, not the empty grid
  // beat at 96 040 ms (no drum transient there; strongest nearby is −72 ms).
  events.push({ id: 'b33_2_push', timeMs: 95968, type: 'tap' as const });
  events.push(...buildBar(33, [3, 4]));
  events.push(...buildBar(34, [1, 3]));
  events.push(...buildBar(35, [1, 2, 3, 4]));
  events.push(...buildBar(36, [1, 3]));
  events.push(...buildBar(37, [1, 3]));
  events.push(...buildBar(38, [1, 2, 3, 4]));
  events.push(...buildBar(39, [1, 2, 3, 4, { b: 4, sub: 0.5 }])); // push
  events.push(...buildBar(40, [1, 2, 3, 4])); // music peak (≈114–117 s)

  // --- BREATHER (bars 41–43): half-time after the peak. ---
  events.push(...buildBar(41, [{ b: 1, cue: true }, 3]));
  events.push(...buildBar(42, [1, 3]));
  events.push(...buildBar(43, [1, 3]));

  // --- FINALE (bars 44–48): familiar patterns combined, clean stop. ---
  events.push(...buildBar(44, [{ b: 1, cue: true }, 2, 3, 4]));
  events.push(...buildBar(45, [1, 2, 3, 4]));
  events.push(...buildBar(46, [1, 2, 3, 4, { b: 4, sub: 0.5 }])); // lift ≈126–128 s
  events.push(...buildBar(47, [1, 2, 3, 4, { b: 4, sub: 0.5 }]));
  events.push(...buildBar(48, [1, 2, 3, 4])); // final groove accent (≈136–138 s)

  // --- OUTRO: answer the drum fill, then the final Rhodes swell. ---
  events.push(outroTap('o_fill_1', 211, true)); // 140 707 ms
  events.push(outroTap('o_fill_2', 213)); // 142 040 ms
  events.push(outroTap('o_fill_3', 215)); // 143 373 ms
  events.push(outroTap('o_final', 225, true)); // 150 040 ms — final chord

  return events;
}

export const ZEN_CHART_EVENTS: ChartNoteDefinition[] = authorChart();

/** Latest gameplay event time in ms (for completion + tail-margin tests). */
export function getLastEventTimeMs(events: readonly ChartNoteDefinition[]): number {
  let last = 0;
  for (const e of events) {
    if (e.timeMs > last) last = e.timeMs;
  }
  return last;
}

/**
 * Returns fresh mutable runtime copies for a new round. The immutable
 * ZEN_CHART_EVENTS source is never mutated, so restarts cannot leak
 * status/rating/hitDeltaMs from previous rounds.
 */
export function getFreshChartEvents(): RuntimeChartNote[] {
  return ZEN_CHART_EVENTS.map((event) => ({
    ...event,
    status: 'pending' as const,
    rating: undefined,
    hitDeltaMs: undefined,
  }));
}
