import { describe, it, expect } from 'vitest';
import { TimingClock } from '../TimingClock';

function fakeCtx(overrides: Record<string, unknown> = {}): AudioContext {
  return {
    currentTime: 10,
    ...overrides,
  } as unknown as AudioContext;
}

describe('TimingClock', () => {
  it('raw song time derives from the audio clock with no input shift', () => {
    const clock = new TimingClock();
    clock.attach(fakeCtx({ currentTime: 12.5 }));
    clock.setTrackStartTime(10);
    clock.setInputOffsetMs(60); // must NOT affect raw song time
    expect(clock.getSongTimeMs()).toBeCloseTo(2500, 6);
  });

  it('inputOffsetMs: positive makes taps count as earlier (judgment only)', () => {
    const clock = new TimingClock();
    clock.attach(fakeCtx({ currentTime: 11 }));
    clock.setTrackStartTime(10);
    clock.setInputOffsetMs(0);
    const raw = clock.inputToSongTimeMs(undefined);
    expect(raw).toBeCloseTo(1000, 6);

    clock.setInputOffsetMs(60);
    expect(clock.inputToSongTimeMs(undefined)).toBeCloseTo(940, 6);

    clock.setInputOffsetMs(-30);
    expect(clock.inputToSongTimeMs(undefined)).toBeCloseTo(1030, 6);
  });

  it('falls back to currentTime when getOutputTimestamp is unavailable', () => {
    const clock = new TimingClock();
    clock.attach(fakeCtx({ currentTime: 11 }));
    clock.setTrackStartTime(10);
    clock.setInputOffsetMs(0);
    // No getOutputTimestamp on the fake -> fallback path.
    expect(clock.inputToSongTimeMs(1234.5)).toBeCloseTo(1000, 6);
  });

  it('maps event timestamps via getOutputTimestamp when available', () => {
    const clock = new TimingClock();
    const ctx = fakeCtx({
      currentTime: 12.0,
      getOutputTimestamp: () => ({ contextTime: 12.0, performanceTime: 5000 }),
    });
    clock.attach(ctx);
    clock.setTrackStartTime(10);
    clock.setInputOffsetMs(0);
    // Event 100ms before the mapping moment -> 100ms earlier on audio clock.
    const songMs = clock.inputToSongTimeMs(4900);
    expect(songMs).toBeCloseTo(1900, 3);
  });

  it('rejects implausible mappings (epoch-based timestamps)', () => {
    const clock = new TimingClock();
    const ctx = fakeCtx({
      currentTime: 12.0,
      getOutputTimestamp: () => ({ contextTime: 12.0, performanceTime: 5000 }),
    });
    clock.attach(ctx);
    clock.setTrackStartTime(10);
    clock.setInputOffsetMs(0);
    // Epoch-based timeStamp is not comparable -> safe fallback to now.
    expect(clock.inputToSongTimeMs(Date.now())).toBeCloseTo(2000, 6);
  });

  it('reports latency info with feature detection (never throws)', () => {
    const clock = new TimingClock();
    expect(clock.getLatencyInfo()).toEqual({
      baseLatencyMs: null,
      outputLatencyMs: null,
      hasOutputTimestamp: false,
    });

    clock.attach(
      fakeCtx({
        currentTime: 1,
        baseLatency: 0.005,
        outputLatency: 0.01,
        getOutputTimestamp: () => ({ contextTime: 1, performanceTime: 100 }),
      })
    );
    const info = clock.getLatencyInfo();
    expect(info.baseLatencyMs).toBeCloseTo(5, 6);
    expect(info.outputLatencyMs).toBeCloseTo(10, 6);
    expect(info.hasOutputTimestamp).toBe(true);
  });
});
