import { describe, it, expect } from 'vitest';
import {
  ZEN_CHART_METADATA,
  ZEN_CHART_EVENTS,
  BEAT_MS,
  BAR_MS,
  FIRST_BEAT_MS,
  TRACK_BPM,
  at,
  gridBeat,
  getFreshChartEvents,
  getLastEventTimeMs,
} from '../zenChart';

describe('chart metadata (90 BPM production groove)', () => {
  it('declares the verified track constants', () => {
    expect(TRACK_BPM).toBe(90);
    expect(ZEN_CHART_METADATA.bpm).toBe(90);
    expect(ZEN_CHART_METADATA.bpm).toBeGreaterThan(0);
    expect(ZEN_CHART_METADATA.songLengthMs).toBe(159019);
    expect(ZEN_CHART_METADATA.firstBeatOffsetMs).toBe(40);
    expect(FIRST_BEAT_MS).toBe(40);
    expect(ZEN_CHART_METADATA.approachBeats).toBe(1.5);
    expect(ZEN_CHART_METADATA.beatsPerMeasure).toBe(4);
  });

  it('grid helpers match the verified 90 BPM math', () => {
    expect(BEAT_MS).toBeCloseTo(666.6666667, 4); // quarter
    expect(BEAT_MS / 2).toBeCloseTo(333.3333333, 4); // 8th
    expect(BAR_MS).toBeCloseTo(2666.6666667, 3); // 4/4 bar
    // Band entry lands exactly on grid beat 15.
    expect(gridBeat(15)).toBe(10040);
    expect(at(1, 1)).toBe(10040);
    // Bar 2 beat 1 = one bar later.
    expect(at(2, 1)).toBe(12707);
    // Final chord swell on grid beat 225.
    expect(gridBeat(225)).toBe(150040);
    // 8th-note pickup inside a bar.
    expect(at(9, 3, 0.5)).toBe(Math.round(10040 + (8 * 4 + 2 + 0.5) * BEAT_MS));
  });
});

describe('chart event integrity', () => {
  it('has a playable number of events, sorted, unique, in-range', () => {
    expect(ZEN_CHART_EVENTS.length).toBeGreaterThan(50);
    expect(ZEN_CHART_EVENTS.length).toBeLessThan(300);

    const times = ZEN_CHART_EVENTS.map((e) => e.timeMs);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);

    const ids = ZEN_CHART_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const e of ZEN_CHART_EVENTS) {
      expect(e.timeMs).toBeGreaterThanOrEqual(0);
      expect(e.timeMs).toBeLessThan(ZEN_CHART_METADATA.songLengthMs);
      expect(e.type).toBe('tap');
    }
  });

  it('never stacks notes denser than readable 8ths', () => {
    const times = ZEN_CHART_EVENTS.map((e) => e.timeMs).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(300);
    }
  });

  it('teaches inside the first seconds (first event well before 15 s)', () => {
    expect(ZEN_CHART_EVENTS[0].timeMs).toBe(8040);
    expect(ZEN_CHART_EVENTS[0].timeMs).toBeLessThan(15000);
  });

  it('cues are selective (tutorial + openings), never the whole chart', () => {
    const cued = ZEN_CHART_EVENTS.filter((e) => e.cue === true);
    expect(cued.length).toBeGreaterThan(0);
    expect(cued.length).toBeLessThan(ZEN_CHART_EVENTS.length / 2);
    // Tutorial trio is cued.
    expect(ZEN_CHART_EVENTS.slice(0, 3).every((e) => e.cue === true)).toBe(true);
  });

  it('last event ends comfortably before track end (intentional tail)', () => {
    const last = getLastEventTimeMs(ZEN_CHART_EVENTS);
    expect(last).toBe(150040);
    const tail = ZEN_CHART_METADATA.songLengthMs - last;
    expect(tail).toBeGreaterThanOrEqual(5000);
    expect(tail).toBe(8979);
  });

  it('answers the pushed snare at 95 968 ms, not the empty grid beat', () => {
    // Bar 33 beat 2: drums play a pushed hit 72 ms before the grid beat
    // (96 040 ms), with no transient on the beat itself — verified against
    // drums/bass/other stems. Neighbours stay on-grid.
    const pushed = ZEN_CHART_EVENTS.find((e) => e.id === 'b33_2_push');
    expect(pushed?.timeMs).toBe(95968);
    expect(ZEN_CHART_EVENTS.some((e) => e.timeMs === 96040)).toBe(false);
    expect(ZEN_CHART_EVENTS.find((e) => e.id === 'b33_1')?.timeMs).toBe(95373);
    expect(ZEN_CHART_EVENTS.find((e) => e.id === 'b33_3')?.timeMs).toBe(96707);
  });
});

describe('chart runtime isolation', () => {
  it('canonical chart stays immutable; fresh copies are independent', () => {
    const round1 = getFreshChartEvents();
    expect(round1.length).toBe(ZEN_CHART_EVENTS.length);
    round1[0].status = 'hit';
    round1[0].rating = 'PERFECT';
    round1[0].hitDeltaMs = 3;

    const round2 = getFreshChartEvents();
    expect(round2[0].status).toBe('pending');
    expect(round2[0].rating).toBeUndefined();
    expect(round2[0].hitDeltaMs).toBeUndefined();
    expect((ZEN_CHART_EVENTS[0] as { status?: string }).status).toBeUndefined();
    // Cue flags survive the copy.
    expect(round2[0].cue).toBe(true);
  });
});
