/**
 * Default-track asset contract (Gauntlet 0).
 *
 * Production start path loads a pre-rendered audio file asynchronously —
 * it never synthesizes minutes of PCM synchronously on the tap path.
 *
 * Required asset (see public/audio/README.md):
 *   Path:     public/audio/zen-tea-ceremony.mp3
 *   Format:   MP3 (or WAV/OGG the browser can decode), stereo, 44.1/48 kHz
 *   Length:   ~160 s @ 130 BPM to match ZEN_CHART_METADATA.songLengthMs
 *   Fallback: when the asset is absent (dev/CI without binaries), the
 *   engine uses a tiny synthesized guide loop (looped) so gameplay stays
 *   fast and testable. The UI badges this as dev-preview audio.
 */
export const DEFAULT_TRACK_URL = `${import.meta.env.BASE_URL}audio/zen-tea-ceremony.mp3`;

/** Intended gameplay duration the chart was authored against (ms). */
export const DEFAULT_TRACK_EXPECTED_DURATION_MS = 160_000;
