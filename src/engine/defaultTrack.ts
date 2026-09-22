/**
 * Default-track asset contract.
 *
 * Production start path loads a pre-rendered audio file asynchronously —
 * it never synthesizes minutes of PCM synchronously on the tap path.
 *
 * Production asset (see public/audio/README.md):
 *   Path:     public/audio/zen-tea-ceremony.mp3
 *   Content:  "Rhodes & Rimshot Groove" master — 90 BPM, 4/4,
 *             159 019 ms (48 kHz stereo). Chart is authored to this mix.
 *   Fallback: when the asset is absent (dev/CI without binaries), the
 *   engine uses a tiny synthesized guide loop (looped) so gameplay stays
 *   fast and testable. The UI badges this as dev-preview audio.
 */
export const DEFAULT_TRACK_URL = `${import.meta.env.BASE_URL}audio/zen-tea-ceremony.mp3`;

/** Intended gameplay duration the chart was authored against (ms). */
export const DEFAULT_TRACK_EXPECTED_DURATION_MS = 159019;
