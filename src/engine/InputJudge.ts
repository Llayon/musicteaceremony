import { ChartEvent, HitRating, GameScore } from '../types';
import { TMAService } from '../services/tma';

export interface JudgeResult {
  rating: HitRating;
  deltaMs: number;
  noteId?: string;
  note?: ChartEvent;
  isMissedTimeout?: boolean;
}

export class InputJudge {
  // Timing windows in milliseconds: tuned for crisp mobile touch responsiveness (±50ms PERFECT, ±100ms GOOD)
  public static readonly PERFECT_WINDOW_MS = 50;
  public static readonly GOOD_WINDOW_MS = 100;
  // Maximum search window to consider a tap targeted at a note (tightened to prevent stealing in 8th-note cascades)
  public static readonly MAX_HIT_WINDOW_MS = 120;

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
   * Validates a global pointerdown tap against the chart
   * Uses exactSongTimeMs derived purely from AudioContext.currentTime
   */
  public handlePointerDown(exactSongTimeMs: number, events: ChartEvent[]): JudgeResult | null {
    // Find the closest pending note within the search window
    let candidate: ChartEvent | null = null;
    let minAbsDelta = Infinity;
    let candidateDelta = 0;

    for (let i = 0; i < events.length; i++) {
      const note = events[i];
      if (note.status !== 'pending') continue;

      // Delta: positive means player is late, negative means player is early
      const delta = exactSongTimeMs - note.timeMs;
      const absDelta = Math.abs(delta);

      if (absDelta < minAbsDelta && absDelta <= InputJudge.MAX_HIT_WINDOW_MS) {
        minAbsDelta = absDelta;
        candidateDelta = delta;
        candidate = note;
      }
    }

    if (!candidate) {
      // Empty tap without a note nearby - optional blank swing
      return null;
    }

    // Determine rating based on strict sub-millisecond thresholds
    let rating: HitRating;
    if (minAbsDelta <= InputJudge.PERFECT_WINDOW_MS) {
      rating = 'PERFECT';
      TMAService.hapticImpact('light');
    } else if (minAbsDelta <= InputJudge.GOOD_WINDOW_MS) {
      rating = 'GOOD';
      TMAService.hapticImpact('soft');
    } else {
      rating = 'MISS';
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
   * Evaluates pending notes that passed the GOOD threshold without being tapped
   */
  public checkMissedNotes(exactSongTimeMs: number, events: ChartEvent[]): JudgeResult[] {
    const missedResults: JudgeResult[] = [];

    for (let i = 0; i < events.length; i++) {
      const note = events[i];
      if (note.status !== 'pending') continue;

      // If the note target time has passed by more than the GOOD window (+90ms), it's a MISS
      if (exactSongTimeMs > note.timeMs + InputJudge.GOOD_WINDOW_MS) {
        note.status = 'miss';
        note.rating = 'MISS';
        note.hitDeltaMs = exactSongTimeMs - note.timeMs;

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
