import { describe, it, expect } from 'vitest';
import { TIMING_WINDOWS, classifyDelta, isPastMissTimeout, isWithinHitWindow } from '../timing';

describe('TIMING_WINDOWS', () => {
  it('is the single source of truth (50/100/120)', () => {
    expect(TIMING_WINDOWS).toEqual({ perfectMs: 50, goodMs: 100, maxHitMs: 120 });
  });

  it('classifyDelta honors inclusive edges', () => {
    expect(classifyDelta(0)).toBe('PERFECT');
    expect(classifyDelta(50)).toBe('PERFECT');
    expect(classifyDelta(50.001)).toBe('GOOD');
    expect(classifyDelta(100)).toBe('GOOD');
    expect(classifyDelta(100.001)).toBe('MISS');
    expect(classifyDelta(120)).toBe('MISS');
    expect(classifyDelta(120.001)).toBeNull();
    expect(classifyDelta(-50)).toBe('PERFECT');
    expect(classifyDelta(-121)).toBeNull();
  });

  it('isPastMissTimeout survives exactly until +goodMs', () => {
    expect(isPastMissTimeout(1100, 1000)).toBe(false);
    expect(isPastMissTimeout(1100.001, 1000)).toBe(true);
    expect(isPastMissTimeout(999, 1000)).toBe(false);
  });

  it('isWithinHitWindow matches maxHitMs', () => {
    expect(isWithinHitWindow(120)).toBe(true);
    expect(isWithinHitWindow(-120)).toBe(true);
    expect(isWithinHitWindow(121)).toBe(false);
  });
});
