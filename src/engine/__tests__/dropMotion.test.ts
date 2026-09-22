import { describe, it, expect } from 'vitest';
import {
  ARC_HEIGHT_PX,
  beatPulsePhase,
  clampedDropletProgress,
  dropletPosition,
  dropletProgress,
  isDropletVisible,
  registerImpact,
  takeDueImpacts,
} from '../dropMotion';

// Production geometry + timing: ladle (295,230) -> cup (180,445),
// approach 1.5 beats at 90 BPM = 1000 ms.
const SPAWN = { x: 295, y: 230 };
const TARGET = { x: 180, y: 445 };
const APPROACH = 1000;
const NOTE = 10000;

function posAt(songTimeMs: number) {
  return dropletPosition(songTimeMs, NOTE, APPROACH, SPAWN.x, SPAWN.y, TARGET.x, TARGET.y);
}

describe('droplet flight math (1000 ms approach)', () => {
  it('starts exactly at the ladle, arrives exactly at the cup', () => {
    expect(posAt(NOTE - APPROACH)).toEqual({ x: 295, y: 230 });
    expect(posAt(NOTE).x).toBeCloseTo(180, 9);
    expect(posAt(NOTE).y).toBeCloseTo(445, 9);
  });

  it('raw progress is 0 at launch and 1 at impact', () => {
    expect(dropletProgress(NOTE - APPROACH, NOTE, APPROACH)).toBeCloseTo(0, 9);
    expect(dropletProgress(NOTE, NOTE, APPROACH)).toBeCloseTo(1, 9);
    expect(clampedDropletProgress(NOTE + 100, NOTE, APPROACH)).toBe(1);
  });

  it.each([-100, -50, 0, 50, 100])(
    'offset %ims: droplet never overshoots the cup (clamped trajectory)',
    (offset) => {
      const p = posAt(NOTE + offset);
      // X never passes the cup (target 180 < spawn 295: overshoot = x < 180).
      expect(p.x).toBeGreaterThanOrEqual(180);
      // Y never passes below the cup impact point (arc is <= 0 at clamp 1).
      expect(p.y).toBeLessThanOrEqual(445);
    }
  );

  it('late GOOD (+50/+100 ms) renders exactly the impact frame, not past it', () => {
    const atHit = posAt(NOTE);
    expect(posAt(NOTE + 50)).toEqual(atHit);
    expect(posAt(NOTE + 100)).toEqual(atHit);
  });

  it('early GOOD (-100 ms) sits at 90% of the flight, visibly short of the cup', () => {
    const p = posAt(NOTE - 100);
    expect(p.x).toBeCloseTo(295 + (180 - 295) * 0.9, 9); // 191.5
    const linearY = 230 + (445 - 230) * 0.9; // 423.5
    const arc = -Math.sin(0.9 * Math.PI) * ARC_HEIGHT_PX;
    expect(p.y).toBeCloseTo(linearY + arc, 9);
    expect(p.x).toBeGreaterThan(180);
  });

  it('early PERFECT (-50 ms) sits at 95% of the flight', () => {
    const p = posAt(NOTE - 50);
    expect(p.x).toBeCloseTo(295 + (180 - 295) * 0.95, 9); // 185.75
    expect(p.x).toBeGreaterThan(180);
  });
});

describe('droplet visibility (judgment decoupled from impact)', () => {
  it('pending droplets fly through the GOOD window', () => {
    expect(isDropletVisible('pending', NOTE - 1000, NOTE, APPROACH)).toBe(true);
    expect(isDropletVisible('pending', NOTE - 100, NOTE, APPROACH)).toBe(true);
    expect(isDropletVisible('pending', NOTE, NOTE, APPROACH)).toBe(true);
    expect(isDropletVisible('pending', NOTE + 100, NOTE, APPROACH)).toBe(true);
    expect(isDropletVisible('pending', NOTE + 101, NOTE, APPROACH)).toBe(false);
    expect(isDropletVisible('pending', NOTE - 1001, NOTE, APPROACH)).toBe(false);
  });

  it('judged (hit) droplets keep flying until note.timeMs, then hand over to impact', () => {
    // Early tap at -80 ms: droplet must NOT vanish mid-flight.
    expect(isDropletVisible('hit', NOTE - 80, NOTE, APPROACH)).toBe(true);
    expect(isDropletVisible('hit', NOTE - 1, NOTE, APPROACH)).toBe(true);
    expect(isDropletVisible('hit', NOTE, NOTE, APPROACH)).toBe(false);
    expect(isDropletVisible('hit', NOTE + 50, NOTE, APPROACH)).toBe(false);
  });

  it('missed notes hide immediately', () => {
    expect(isDropletVisible('miss', NOTE - 100, NOTE, APPROACH)).toBe(false);
    expect(isDropletVisible('miss', NOTE, NOTE, APPROACH)).toBe(false);
  });
});

describe('beat pulse phase (grid-aligned, not zero-aligned)', () => {
  const BEAT = 60000 / 90;

  it('phase is 0 exactly on grid beats (40 ms phase)', () => {
    expect(beatPulsePhase(40, BEAT, 40)).toBeCloseTo(0, 9);
    expect(beatPulsePhase(40 + BEAT, BEAT, 40)).toBeCloseTo(0, 9);
    expect(beatPulsePhase(40 + 100 * BEAT, BEAT, 40)).toBeCloseTo(0, 9);
  });

  it('phase is 0.5 halfway between beats', () => {
    expect(beatPulsePhase(40 + BEAT / 2, BEAT, 40)).toBeCloseTo(0.5, 9);
  });

  it('old zero-based formula would pulse ~40 ms early (regression guard)', () => {
    const oldPhaseAtRealBeat = (40 % BEAT) / BEAT; // what the bug computed
    expect(oldPhaseAtRealBeat).toBeGreaterThan(0.05); // 0.06 — visibly early
    expect(beatPulsePhase(40, BEAT, 40)).toBe(0); // fixed
  });

  it('handles pre-grid times without negative phases', () => {
    const ph = beatPulsePhase(0, BEAT, 40);
    expect(ph).toBeGreaterThanOrEqual(0);
    expect(ph).toBeLessThan(1);
  });
});

describe('deferred impact queue', () => {
  it('fires exactly at note.timeMs, not at tap time', () => {
    let q = registerImpact([], 'n1', 'PERFECT', 10000);
    // Tap happened at 9920 (early): impact not due yet.
    expect(takeDueImpacts(q, 9920).due).toHaveLength(0);
    expect(takeDueImpacts(q, 9999).due).toHaveLength(0);
    const fired = takeDueImpacts(q, 10000);
    expect(fired.due).toHaveLength(1);
    expect(fired.due[0]).toMatchObject({ noteId: 'n1', rating: 'PERFECT' });
    expect(fired.pending).toHaveLength(0);
  });

  it('late taps fire on the next frame', () => {
    const q = registerImpact([], 'n1', 'GOOD', 10000);
    const fired = takeDueImpacts(q, 10050);
    expect(fired.due).toHaveLength(1);
  });

  it('re-registering the same note never double-fires', () => {
    let q = registerImpact([], 'n1', 'GOOD', 10000);
    q = registerImpact(q, 'n1', 'PERFECT', 10000);
    expect(q).toHaveLength(1);
    expect(q[0].rating).toBe('PERFECT');
  });

  it('stale impacts are dropped, others survive', () => {
    const q = [
      { noteId: 'old', rating: 'GOOD' as const, impactTimeMs: 1000 },
      { noteId: 'new', rating: 'PERFECT' as const, impactTimeMs: 9000 },
    ];
    const { due, pending } = takeDueImpacts(q, 10000);
    expect(due.map((d) => d.noteId)).toEqual(['new']);
    expect(pending).toHaveLength(0);
  });
});
