import type { HitRating } from '../types';
import { TIMING_WINDOWS } from './timing';

/**
 * Pure droplet-motion helpers (no Pixi, no AudioContext — unit-testable).
 *
 * Visual contract (Drop Impact Sync):
 * - progress 0 at launch (note.timeMs - approachMs), exactly 1 at note.timeMs;
 * - position ALWAYS uses clamped progress: after note.timeMs the droplet
 *   stands in the cup zone until resolution, never flies past the cup;
 * - judgment and visual impact are decoupled: a judged (hit) droplet keeps
 *   flying until note.timeMs, where the splash/cup reaction fires;
 * - beat pulse is phased to the real beat grid (firstBeatOffsetMs), not to
 *   song-time zero.
 */

export const ARC_HEIGHT_PX = 55;

/** Impacts older than this past their due time are dropped (safety). */
export const IMPACT_STALE_MS = 2000;

export function clamp01(v: number): number {
  return Math.min(1.0, Math.max(0.0, v));
}

/** Raw flight progress: 0 at launch, 1 exactly at note.timeMs. */
export function dropletProgress(
  songTimeMs: number,
  noteTimeMs: number,
  approachMs: number
): number {
  return (songTimeMs - (noteTimeMs - approachMs)) / approachMs;
}

/** Clamped flight progress for orientation/scale (never overshoots). */
export function clampedDropletProgress(
  songTimeMs: number,
  noteTimeMs: number,
  approachMs: number
): number {
  return clamp01(dropletProgress(songTimeMs, noteTimeMs, approachMs));
}

export interface DropletXY {
  x: number;
  y: number;
}

/**
 * Droplet position on the ladle→cup arc. Uses CLAMPED progress, so late
 * taps (+50/+100 ms) render the droplet resting in the cup — identical to
 * the exact-hit frame — instead of overshooting past it.
 */
export function dropletPosition(
  songTimeMs: number,
  noteTimeMs: number,
  approachMs: number,
  spawnX: number,
  spawnY: number,
  targetX: number,
  targetY: number
): DropletXY {
  const p = clamp01(dropletProgress(songTimeMs, noteTimeMs, approachMs));
  const x = spawnX + (targetX - spawnX) * p;
  const linearY = spawnY + (targetY - spawnY) * p;
  const arc = -Math.sin(p * Math.PI) * ARC_HEIGHT_PX;
  return { x, y: linearY + arc };
}

/**
 * Beat-pulse phase in [0, 1): 0 exactly on a grid beat. The grid starts at
 * firstBeatOffsetMs (40 ms for the production track), so pulsing on raw
 * songTimeMs % beatMs would run ~40 ms early — nearly a PERFECT half-window.
 */
export function beatPulsePhase(
  songTimeMs: number,
  beatMs: number,
  firstBeatOffsetMs: number
): number {
  const shifted = songTimeMs - firstBeatOffsetMs;
  const mod = ((shifted % beatMs) + beatMs) % beatMs;
  const phase = mod / beatMs;
  // Float snap: far into the song (tens of seconds) the modulo can land at
  // 0.999… instead of exactly 0 on a beat — a one-frame lost pulse. Anything
  // within 1e-9 of the next beat IS the beat (sub-nanosecond, inaudible).
  return phase > 1 - 1e-9 ? 0 : phase;
}

export type DropletStatus = 'pending' | 'hit' | 'miss';

/**
 * Whether the droplet sprite should be on screen.
 * - pending: from launch until the GOOD window closes (agrees with the
 *   judge's auto-miss timing);
 * - hit: judged droplets keep flying until note.timeMs, where the impact
 *   visuals (splash/plate/cup) take over — an early tap never vanishes
 *   the droplet mid-flight;
 * - miss: failures hide immediately.
 */
export function isDropletVisible(
  status: DropletStatus,
  songTimeMs: number,
  noteTimeMs: number,
  approachMs: number
): boolean {
  const startTime = noteTimeMs - approachMs;
  if (songTimeMs < startTime) return false;
  if (status === 'miss') return false;
  if (status === 'hit') return songTimeMs < noteTimeMs;
  return songTimeMs <= noteTimeMs + TIMING_WINDOWS.goodMs;
}

export interface PendingImpact {
  noteId: string;
  rating: HitRating;
  impactTimeMs: number;
}

/**
 * Queue a deferred visual impact (splash/plate/cup fire at note.timeMs,
 * not at tap time). Replaces any pending impact for the same note so a
 * note can never double-fire visuals.
 */
export function registerImpact(
  queue: PendingImpact[],
  noteId: string,
  rating: HitRating,
  impactTimeMs: number
): PendingImpact[] {
  const next = queue.filter((q) => q.noteId !== noteId);
  next.push({ noteId, rating, impactTimeMs });
  return next;
}

/** Split the queue into due impacts and still-pending ones. */
export function takeDueImpacts(
  queue: PendingImpact[],
  songTimeMs: number
): { due: PendingImpact[]; pending: PendingImpact[] } {
  const due: PendingImpact[] = [];
  const pending: PendingImpact[] = [];
  for (const q of queue) {
    if (songTimeMs - q.impactTimeMs > IMPACT_STALE_MS) continue; // safety drop
    if (songTimeMs >= q.impactTimeMs) due.push(q);
    else pending.push(q);
  }
  return { due, pending };
}
