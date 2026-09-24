import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Source guard for the verified one-tap iOS flow (iPhone 11 Pro Max PASS):
 * audio unlock must originate from a trusted button CLICK. A pointerdown
 * Start path left Safari's resume() pending forever, so:
 * - the Start/restart buttons must use onClick and never onPointerDown;
 * - the wrapper pointerdown handler must not start anything while IDLE.
 * If this guard fails, the unlock regression is back — do not "fix" the
 * test, fix the gesture path (see README: iOS audio unlock note).
 */
function readRhythmGameSource(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'RhythmGame.tsx'), 'utf8');
}

function buttonOpeningTag(src: string, buttonId: string): string {
  const idIndex = src.indexOf(`id="${buttonId}"`);
  expect(idIndex, `${buttonId} must exist`).toBeGreaterThan(-1);
  const openStart = src.lastIndexOf('<button', idIndex);
  // The opening tag closes with '>' on its own line in this codebase;
  // a bare first-'>' search would stop at '=>' inside prop expressions.
  const openEnd = src.indexOf('>\n', idIndex);
  expect(openStart, `<button> for ${buttonId} must exist`).toBeGreaterThan(-1);
  expect(openEnd, `<button> for ${buttonId} must close`).toBeGreaterThan(idIndex);
  return src.slice(openStart, openEnd);
}

describe('Start gesture guard (trusted click only)', () => {
  it('Start button uses onClick and never onPointerDown', () => {
    const tag = buttonOpeningTag(readRhythmGameSource(), 'btn-start-game');
    expect(tag.includes('onClick={(e) => handleStartAction(e)}')).toBe(true);
    expect(tag.includes('onPointerDown')).toBe(false);
  });

  it('restart button uses onClick and never onPointerDown', () => {
    const tag = buttonOpeningTag(readRhythmGameSource(), 'btn-restart-game');
    expect(tag.includes('onClick={(e) => handleStartAction(e)}')).toBe(true);
    expect(tag.includes('onPointerDown')).toBe(false);
  });

  it('wrapper pointerdown starts nothing while IDLE/FINISHED', () => {
    const src = readRhythmGameSource();
    const idleIndex = src.indexOf("if (gameState === 'IDLE'");
    expect(idleIndex, 'IDLE branch must exist').toBeGreaterThan(-1);
    // The IDLE/FINISHED branch body: from its opening brace to the first
    // closing brace at the same nesting level (the body is a bare return).
    const bodyStart = src.indexOf('{', idleIndex);
    const bodyEnd = src.indexOf('}', bodyStart);
    const body = src.slice(bodyStart, bodyEnd);
    expect(body).toMatch(/return;/);
    expect(body).not.toMatch(/startRound/);
    expect(body).not.toMatch(/handleStartAction/);
  });

  it('no pointerdown handler routes into the Start action anywhere', () => {
    const src = readRhythmGameSource();
    expect(src).not.toMatch(/onPointerDown=\{\(e\) => handleStartAction/);
  });
});
