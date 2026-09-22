import type { HitRating } from '../types';

/**
 * Single source of truth for all judgment timing windows (milliseconds).
 *
 * Boundaries are inclusive: a tap with |delta| exactly equal to a window
 * edge belongs to the tighter (better) rating.
 *
 * - |delta| <= perfectMs              -> PERFECT
 * - |delta| <= goodMs (elsewhere)     -> GOOD
 * - |delta| <= maxHitMs (elsewhere)   -> MISS (consumes the note)
 * - |delta| >  maxHitMs               -> GHOST (neutral, consumes nothing)
 *
 * Auto-miss: a pending note becomes MISS once
 *   songTimeMs > note.timeMs + goodMs
 * i.e. the note survives exactly until +goodMs, then resolves as a miss.
 * A tap at exactly +goodMs is still GOOD; anything later can only MISS
 * (if the note is somehow still pending) or find no candidate.
 *
 * Expected outcomes for integer-millisecond deltas (delta = tap - note):
 *
 *   -121 -> no candidate (ghost, neutral)
 *   -120 -> MISS (consumes note)
 *   -101 -> MISS (consumes note)
 *   -100 -> GOOD
 *    -51 -> GOOD
 *    -50 -> PERFECT
 *      0 -> PERFECT
 *    +50 -> PERFECT
 *    +51 -> GOOD
 *   +100 -> GOOD
 *   +101 -> MISS if note still pending, else ghost (note auto-misses past +100)
 *   +120 -> MISS if note still pending, else ghost
 *   +121 -> no candidate (ghost, neutral)
 */
export const TIMING_WINDOWS = {
  perfectMs: 50,
  goodMs: 100,
  maxHitMs: 120,
} as const;

export type TimingWindows = typeof TIMING_WINDOWS;

/**
 * Classify an absolute timing error into a rating.
 * Returns null when the tap is outside the hittable window (ghost).
 */
export function classifyDelta(absDeltaMs: number): HitRating | null {
  const abs = Math.abs(absDeltaMs);
  if (abs <= TIMING_WINDOWS.perfectMs) return 'PERFECT';
  if (abs <= TIMING_WINDOWS.goodMs) return 'GOOD';
  if (abs <= TIMING_WINDOWS.maxHitMs) return 'MISS';
  return null;
}

/** True once a pending note has outlived the GOOD window and must auto-miss. */
export function isPastMissTimeout(songTimeMs: number, noteTimeMs: number): boolean {
  return songTimeMs > noteTimeMs + TIMING_WINDOWS.goodMs;
}

/** True when a tap delta is close enough to consume a note (any rating). */
export function isWithinHitWindow(deltaMs: number): boolean {
  return Math.abs(deltaMs) <= TIMING_WINDOWS.maxHitMs;
}
