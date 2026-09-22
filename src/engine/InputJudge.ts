import type { ChartEvent, HitRating, GameScore } from '../types';
import { TMAService } from '../services/tma';
import { TIMING_WINDOWS, classifyDelta, isPastMissTimeout } from './timing';

export interface JudgeResult {
  rating: HitRating;
  deltaMs: number;
  noteId?: string;
  note?: ChartEvent;
  isMissedTimeout?: boolean;
}

/**
 * InputJudge — deterministic tap judgment against runtime chart notes.
 *
 * Timing windows: see TIMING_WINDOWS (single source of truth).
 *
 * Candidate selection (note-stealing prevention):
 * - only `pending` notes are eligible; resolved notes can never be
 *   re-scored, so duplicate taps cannot score twice and rapid taps are
 *   deterministic (each tap consumes at most one note);
 * - among eligible notes within maxHitMs, the smallest |delta| wins;
 * - exact ties resolve to the earliest note (stable, documented).
 *   With eighth-note spacing (~231ms at 130 BPM) a tap can be within
 *   range of at most two neighbours; a late tap on note A resolves A
 *   only if A is strictly closer than B.
 *
 * Ghost-tap policy (deliberate, not accidental):
 * - a tap with no pending candidate within maxHitMs is a NEUTRAL ghost:
 *   handlePointerDown returns null, score/combo are untouched, no haptic
 *   fires. This keeps casual screen touches forgiving on mobile.
 * - a tap within maxHitMs but outside the GOOD window DOES consume the
 *   note as MISS (breaking combo). Near-miss spam is therefore punished
 *   while far spam stays neutral.
 *
 * Hold notes: unsupported in Gauntlet 0. Notes whose runtime `type` is
 * not 'tap' are skipped safely (never consumed, never crash).
 */
export class InputJudge {
  /** Backwards-compatible aliases — always mirror TIMING_WINDOWS. */
  public static readonly PERFECT_WINDOW_MS = TIMING_WINDOWS.perfectMs;
  public static readonly GOOD_WINDOW_MS = TIMING_WINDOWS.goodMs;
  public static readonly MAX_HIT_WINDOW_MS = TIMING_WINDOWS.maxHitMs;

  private scoreState: GameScore = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfectCount: 0,
    goodCount: 0,
    missCount: 0,
    accuracy: 100,
    zenLevel: 50,
    rank: 'ZEN_MASTER',
  };

  /**
   * Resets score and statistics
   */
  public resetScore(): GameScore {
    this.scoreState = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfectCount: 0,
      goodCount: 0,
      missCount: 0,
      accuracy: 100,
      zenLevel: 50,
      rank: 'ZEN_MASTER',
    };
    return { ...this.scoreState };
  }

  public getScore(): GameScore {
    return { ...this.scoreState };
  }

  /**
   * Validates a tap against the chart.
   * @param judgmentSongTimeMs tap position on the song timeline in ms
   *   (already calibrated — caller maps PointerEvent.timeStamp through
   *   TimingClock.inputToSongTimeMs; see RhythmGame).
   * @returns JudgeResult for a consumed note, or null for a neutral
   *   ghost tap (intentional no-op — see class docs).
   */
  public handlePointerDown(judgmentSongTimeMs: number, events: ChartEvent[]): JudgeResult | null {
    // Find the closest pending, supported note within the search window.
    // Tie-break: earliest note wins (deterministic for simultaneous
    // candidates, e.g. a tap exactly midway between eighth notes).
    let candidate: ChartEvent | null = null;
    let minAbsDelta = Infinity;
    let candidateDelta = 0;

    for (let i = 0; i < events.length; i++) {
      const note = events[i];
      if (note.status !== 'pending') continue;
      if ((note.type as string) !== 'tap') continue; // hold/unknown: reject safely

      // Delta: positive means player is late, negative means player is early
      const delta = judgmentSongTimeMs - note.timeMs;
      const absDelta = Math.abs(delta);

      if (absDelta <= TIMING_WINDOWS.maxHitMs) {
        if (
          absDelta < minAbsDelta ||
          (absDelta === minAbsDelta && candidate !== null && note.timeMs < candidate.timeMs)
        ) {
          minAbsDelta = absDelta;
          candidateDelta = delta;
          candidate = note;
        }
      }
    }

    if (!candidate) {
      // Intentional neutral ghost tap: no nearby note, no score change.
      return null;
    }

    // classifyDelta returns null only outside maxHitMs, which cannot happen
    // here (candidate is within window) — the MISS branch below covers the
    // 101..120ms ring, which consumes the note as a miss.
    const rating: HitRating = classifyDelta(minAbsDelta) ?? 'MISS';
    if (rating === 'PERFECT') {
      TMAService.hapticImpact('light');
    } else if (rating === 'GOOD') {
      TMAService.hapticImpact('soft');
    } else {
      TMAService.hapticNotification('warning');
    }

    // Mark candidate as resolved to eliminate double-counting
    candidate.status = rating === 'MISS' ? 'miss' : 'hit';
    candidate.rating = rating;
    candidate.hitDeltaMs = candidateDelta;

    this.applyRatingToScore(rating);

    return {
      rating,
      deltaMs: candidateDelta,
      noteId: candidate.id,
      note: candidate,
    };
  }

  /**
   * Evaluates pending notes that passed the GOOD threshold without being tapped.
   * A note survives exactly until songTime > note.timeMs + goodMs, then
   * resolves as MISS exactly once (status guard prevents repeats, so
   * haptics never fire repeatedly for the same note).
   */
  public checkMissedNotes(songTimeMs: number, events: ChartEvent[]): JudgeResult[] {
    const missedResults: JudgeResult[] = [];

    for (let i = 0; i < events.length; i++) {
      const note = events[i];
      if (note.status !== 'pending') continue;
      if ((note.type as string) !== 'tap') continue;

      if (isPastMissTimeout(songTimeMs, note.timeMs)) {
        note.status = 'miss';
        note.rating = 'MISS';
        note.hitDeltaMs = songTimeMs - note.timeMs;

        TMAService.hapticNotification('warning');
        this.applyRatingToScore('MISS');

        missedResults.push({
          rating: 'MISS',
          deltaMs: note.hitDeltaMs,
          noteId: note.id,
          note,
          isMissedTimeout: true,
        });
      }
    }

    return missedResults;
  }

  private applyRatingToScore(rating: HitRating): void {
    if (rating === 'PERFECT') {
      this.scoreState.perfectCount++;
      this.scoreState.combo++;
      this.scoreState.score += 1000 + this.scoreState.combo * 50;
      this.scoreState.zenLevel = Math.min(100, this.scoreState.zenLevel + 6);
    } else if (rating === 'GOOD') {
      this.scoreState.goodCount++;
      this.scoreState.combo++;
      this.scoreState.score += 500 + this.scoreState.combo * 20;
      this.scoreState.zenLevel = Math.min(100, this.scoreState.zenLevel + 3);
    } else {
      this.scoreState.missCount++;
      this.scoreState.combo = 0;
      this.scoreState.zenLevel = Math.max(0, this.scoreState.zenLevel - 10);
    }

    if (this.scoreState.combo > this.scoreState.maxCombo) {
      this.scoreState.maxCombo = this.scoreState.combo;
    }

    const totalProcessed =
      this.scoreState.perfectCount + this.scoreState.goodCount + this.scoreState.missCount;

    if (totalProcessed > 0) {
      const weightedScore =
        this.scoreState.perfectCount * 1.0 + this.scoreState.goodCount * 0.6;
      this.scoreState.accuracy = Math.round((weightedScore / totalProcessed) * 100);
    }

    // Rhythm Heaven rank calculation
    if (this.scoreState.accuracy >= 94 && this.scoreState.missCount === 0) {
      this.scoreState.rank = 'ZEN_MASTER';
    } else if (this.scoreState.accuracy >= 80) {
      this.scoreState.rank = 'SUPERB';
    } else if (this.scoreState.accuracy >= 55) {
      this.scoreState.rank = 'OK';
    } else {
      this.scoreState.rank = 'TRY_AGAIN';
    }
  }
}
