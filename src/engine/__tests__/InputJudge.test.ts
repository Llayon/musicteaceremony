import { describe, it, expect, beforeEach } from 'vitest';
import { InputJudge } from '../InputJudge';
import { TIMING_WINDOWS } from '../timing';
import { getFreshChartEvents, ZEN_CHART_EVENTS } from '../../data/zenChart';
import type { ChartEvent } from '../../types';

function makeNote(id: string, timeMs: number): ChartEvent {
  return { id, timeMs, type: 'tap', status: 'pending' };
}

function makeNotes(times: number[]): ChartEvent[] {
  return times.map((t, i) => makeNote(`n${i}`, t));
}

describe('InputJudge timing boundaries (single source of truth)', () => {
  let judge: InputJudge;
  beforeEach(() => {
    judge = new InputJudge();
  });

  it('uses TIMING_WINDOWS as the single source of truth', () => {
    expect(TIMING_WINDOWS.perfectMs).toBe(50);
    expect(TIMING_WINDOWS.goodMs).toBe(100);
    expect(TIMING_WINDOWS.maxHitMs).toBe(120);
    expect(InputJudge.PERFECT_WINDOW_MS).toBe(TIMING_WINDOWS.perfectMs);
    expect(InputJudge.GOOD_WINDOW_MS).toBe(TIMING_WINDOWS.goodMs);
    expect(InputJudge.MAX_HIT_WINDOW_MS).toBe(TIMING_WINDOWS.maxHitMs);
  });

  it.each([-50, 0, 50])('PERFECT at delta %ims', (delta) => {
    const notes = makeNotes([1000]);
    const res = judge.handlePointerDown(1000 + delta, notes);
    expect(res?.rating).toBe('PERFECT');
    expect(res?.deltaMs).toBe(delta);
  });

  it.each([-100, -51, 51, 100])('GOOD at delta %ims', (delta) => {
    const notes = makeNotes([1000]);
    const res = judge.handlePointerDown(1000 + delta, notes);
    expect(res?.rating).toBe('GOOD');
    expect(res?.deltaMs).toBe(delta);
  });

  it.each([-101, 101])('MISS (consumes note) just outside GOOD at delta %ims', (delta) => {
    const notes = makeNotes([1000]);
    const res = judge.handlePointerDown(1000 + delta, notes);
    expect(res?.rating).toBe('MISS');
    expect(notes[0].status).toBe('miss');
  });

  it.each([-120, 120])('MISS at max-hit edge %ims (still pending)', (delta) => {
    const notes = makeNotes([1000]);
    const res = judge.handlePointerDown(1000 + delta, notes);
    expect(res?.rating).toBe('MISS');
    expect(notes[0].status).toBe('miss');
  });

  it.each([-121, -200, 121, 200])('ghost (neutral, null) outside max window at %ims', (delta) => {
    const notes = makeNotes([1000]);
    const before = judge.getScore();
    const res = judge.handlePointerDown(1000 + delta, notes);
    expect(res).toBeNull();
    expect(notes[0].status).toBe('pending');
    expect(judge.getScore()).toEqual(before);
  });

  it('documents the full -121..+121 boundary table', () => {
    const cases: Array<[number, string | null]> = [
      [-121, null],
      [-120, 'MISS'],
      [-101, 'MISS'],
      [-100, 'GOOD'],
      [-51, 'GOOD'],
      [-50, 'PERFECT'],
      [0, 'PERFECT'],
      [50, 'PERFECT'],
      [51, 'GOOD'],
      [100, 'GOOD'],
      [101, 'MISS'],
      [120, 'MISS'],
      [121, null],
    ];
    for (const [delta, expected] of cases) {
      const j = new InputJudge();
      const notes = makeNotes([5000]);
      const res = j.handlePointerDown(5000 + delta, notes);
      if (expected === null) {
        expect(res, `delta ${delta}`).toBeNull();
      } else {
        expect(res?.rating, `delta ${delta}`).toBe(expected);
      }
    }
  });
});

describe('InputJudge state & scoring', () => {
  let judge: InputJudge;
  beforeEach(() => {
    judge = new InputJudge();
  });

  it('duplicate tap cannot score a note twice', () => {
    const notes = makeNotes([1000]);
    const first = judge.handlePointerDown(1000, notes);
    expect(first?.rating).toBe('PERFECT');
    const scoreAfterFirst = judge.getScore();
    const second = judge.handlePointerDown(1000, notes);
    // Note already resolved -> ghost, score untouched.
    expect(second).toBeNull();
    expect(judge.getScore()).toEqual(scoreAfterFirst);
    expect(scoreAfterFirst.perfectCount).toBe(1);
  });

  it('missed note resolves exactly once', () => {
    const notes = makeNotes([1000]);
    const first = judge.checkMissedNotes(1101, notes);
    expect(first).toHaveLength(1);
    expect(first[0].isMissedTimeout).toBe(true);
    expect(notes[0].status).toBe('miss');
    const second = judge.checkMissedNotes(1200, notes);
    expect(second).toHaveLength(0);
    expect(judge.getScore().missCount).toBe(1);
  });

  it('note survives exactly until +goodMs then auto-misses', () => {
    const notes = makeNotes([1000]);
    // Exactly +100: not yet missed.
    expect(judge.checkMissedNotes(1100, notes)).toHaveLength(0);
    expect(notes[0].status).toBe('pending');
    // And a tap at exactly +100 is still GOOD.
    const res = judge.handlePointerDown(1100, notes);
    expect(res?.rating).toBe('GOOD');
  });

  it('combo increments on hits and resets on MISS', () => {
    const notes = makeNotes([1000, 2000, 3000]);
    judge.handlePointerDown(1000, notes);
    judge.handlePointerDown(2000, notes);
    expect(judge.getScore().combo).toBe(2);
    expect(judge.getScore().maxCombo).toBe(2);
    judge.handlePointerDown(3000 + 110, notes); // MISS tap
    expect(judge.getScore().combo).toBe(0);
    expect(judge.getScore().maxCombo).toBe(2);
    expect(judge.getScore().missCount).toBe(1);
  });

  it('ghost taps leave score and combo untouched', () => {
    const notes = makeNotes([1000]);
    judge.handlePointerDown(1000, notes); // combo 1
    const before = judge.getScore();
    const res = judge.handlePointerDown(5000, notes); // far away
    expect(res).toBeNull();
    expect(judge.getScore()).toEqual(before);
  });

  it('accuracy weights PERFECT=1.0 and GOOD=0.6', () => {
    const notes = makeNotes([1000, 2000, 3000, 4000]);
    judge.handlePointerDown(1000, notes); // PERFECT
    judge.handlePointerDown(2000 + 60, notes); // GOOD
    judge.checkMissedNotes(3200, notes); // MISS (note 3000)
    judge.checkMissedNotes(4200, notes); // MISS (note 4000)
    // (1 + 0.6) / 4 = 40%
    expect(judge.getScore().accuracy).toBe(40);
  });

  it('ranking boundaries', () => {
    // ZEN_MASTER needs accuracy >= 94 with zero misses.
    const j1 = new InputJudge();
    const n1 = makeNotes([1000]);
    j1.handlePointerDown(1000, n1);
    expect(j1.getScore().rank).toBe('ZEN_MASTER');

    // One GOOD (60%) -> accuracy 60 -> OK tier.
    const j2 = new InputJudge();
    const n2 = makeNotes([1000]);
    j2.handlePointerDown(1060, n2);
    expect(j2.getScore().accuracy).toBe(60);
    expect(j2.getScore().rank).toBe('OK');

    // All miss -> TRY_AGAIN.
    const j3 = new InputJudge();
    const n3 = makeNotes([1000]);
    j3.checkMissedNotes(1200, n3);
    expect(j3.getScore().rank).toBe('TRY_AGAIN');
  });

  it('resetScore clears everything', () => {
    const notes = makeNotes([1000]);
    judge.handlePointerDown(1000, notes);
    const reset = judge.resetScore();
    expect(reset).toMatchObject({
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfectCount: 0,
      goodCount: 0,
      missCount: 0,
      accuracy: 100,
    });
    expect(judge.getScore().score).toBe(0);
  });
});

describe('InputJudge neighbouring notes (eighth-note cascades)', () => {
  let judge: InputJudge;
  beforeEach(() => {
    judge = new InputJudge();
  });

  // Eighth note at 130 BPM ≈ 230.77ms.
  const EIGHTH = 60000 / 130 / 2;

  it('late tap on A does not steal B when B is closer', () => {
    const notes = makeNotes([1000, 1000 + EIGHTH]);
    // Tap 100ms after A: 100 from A, ~131 from B -> resolves A as GOOD.
    const res = judge.handlePointerDown(1100, notes);
    expect(res?.noteId).toBe('n0');
    expect(res?.rating).toBe('GOOD');
    expect(notes[1].status).toBe('pending');
  });

  it('tap between neighbours resolves the closer note', () => {
    const notes = makeNotes([1000, 1000 + EIGHTH]);
    // 150ms after A ≈ 81ms before B -> B is closer -> GOOD on B.
    const t = 1000 + 150;
    const res = judge.handlePointerDown(t, notes);
    expect(res?.noteId).toBe('n1');
    expect(notes[0].status).toBe('pending');
  });

  it('midpoint tie resolves deterministically to the earlier note', () => {
    const notes = [makeNote('a', 1000), makeNote('b', 1230)];
    // Tap at 1115: exactly 115 from each (within 120) -> earliest wins.
    const res = judge.handlePointerDown(1115, notes);
    expect(res?.noteId).toBe('a');
    // Second identical tap now resolves the other note deterministically.
    const res2 = judge.handlePointerDown(1115, notes);
    expect(res2?.noteId).toBe('b');
  });

  it('rapid taps consume notes in order without double-counting', () => {
    const notes = makeNotes([1000, 1000 + EIGHTH]);
    const r1 = judge.handlePointerDown(1000, notes);
    const r2 = judge.handlePointerDown(1000 + EIGHTH, notes);
    expect(r1?.noteId).toBe('n0');
    expect(r2?.noteId).toBe('n1');
    expect(judge.getScore().perfectCount).toBe(2);
    expect(judge.getScore().combo).toBe(2);
  });

  it('unsupported (non-tap) notes are skipped safely, never consumed', () => {
    const notes = makeNotes([1000]);
    (notes[0] as unknown as { type: string }).type = 'hold';
    const before = judge.getScore();
    const res = judge.handlePointerDown(1000, notes);
    expect(res).toBeNull();
    expect(notes[0].status).toBe('pending');
    expect(judge.getScore()).toEqual(before);
    expect(judge.checkMissedNotes(2000, notes)).toHaveLength(0);
  });
});

describe('chart runtime state isolation', () => {
  it('getFreshChartEvents returns independent copies (no leak across rounds)', () => {
    const round1 = getFreshChartEvents();
    expect(round1.length).toBe(ZEN_CHART_EVENTS.length);
    // Mutate runtime state as a round would.
    round1[0].status = 'hit';
    round1[0].rating = 'PERFECT';
    round1[0].hitDeltaMs = 3;

    const round2 = getFreshChartEvents();
    expect(round2[0].status).toBe('pending');
    expect(round2[0].rating).toBeUndefined();
    expect(round2[0].hitDeltaMs).toBeUndefined();
    // Source data stays pristine.
    expect((ZEN_CHART_EVENTS[0] as { status?: string }).status).toBeUndefined();
  });

  it('judging a fresh copy never mutates a previous round copy', () => {
    const judge = new InputJudge();
    const round1 = getFreshChartEvents();
    judge.handlePointerDown(round1[0].timeMs, round1);
    expect(round1[0].status).toBe('hit');

    const round2 = getFreshChartEvents();
    expect(round2[0].status).toBe('pending');
  });
});
