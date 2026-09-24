import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from '../AudioEngine';

type ResumeMode = 'flip-to-running' | 'manual' | 'resolve-dead' | 'void' | 'reject';

interface Installed {
  spy: {
    resumeCalls: number;
    buffers: Array<{ channels: number; length: number }>;
    sourcesStarted: number;
    zeroGains: number;
  };
  triggerResume: () => void;
}

/**
 * Fake AudioContext with a controllable resume() and observable probe
 * artifacts (createBuffer/createBufferSource/zero-gain node).
 */
function installFakeAudio(initialState = 'suspended', mode: ResumeMode = 'flip-to-running'): Installed {
  const spy = {
    resumeCalls: 0,
    buffers: [] as Array<{ channels: number; length: number }>,
    sourcesStarted: 0,
    zeroGains: 0,
  };
  let triggerResume = () => {};
  const ctx: {
    currentTime: number;
    state: string;
    sampleRate: number;
    destination: object;
    resume: () => unknown;
    createGain: () => { gain: { value: number; setValueAtTime: () => void }; connect: (n: unknown) => void };
    createBuffer: (channels: number, length: number, rate: number) => { duration: number };
    createBufferSource: () => {
      buffer: unknown;
      connect: (n: unknown) => void;
      start: () => void;
      onended: (() => void) | null;
      disconnect: () => void;
    };
    decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  } = {
    currentTime: 0,
    state: initialState,
    sampleRate: 48000,
    destination: {},
    resume: () => {
      spy.resumeCalls += 1;
      if (mode === 'void') return undefined;
      if (mode === 'reject') return Promise.reject(new Error('denied'));
      if (mode === 'manual') {
        return new Promise<void>((resolve) => {
          triggerResume = () => {
            ctx.state = 'running';
            resolve();
          };
        });
      }
      if (mode === 'flip-to-running') {
        ctx.state = 'running';
        return Promise.resolve();
      }
      return Promise.resolve(); // resolve-dead: state stays put
    },
    createGain: () => {
      const gain = { value: 1, setValueAtTime: () => {} };
      return {
        gain,
        connect: (_n: unknown) => {
          if (gain.value === 0) spy.zeroGains += 1;
        },
      };
    },
    createBuffer: (channels: number, length: number, _rate: number) => {
      spy.buffers.push({ channels, length });
      return { duration: length / 48000 };
    },
    createBufferSource: () => ({
      buffer: null,
      connect: (_n: unknown) => {},
      start: () => {
        spy.sourcesStarted += 1;
      },
      onended: null,
      disconnect: () => {},
    }),
    decodeAudioData: async () => ({ duration: 159.019 }) as AudioBuffer,
  };
  vi.stubGlobal('window', {
    AudioContext: function () {
      return ctx;
    },
  } as unknown as Window & typeof globalThis);
  return { spy, triggerResume: () => triggerResume() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function countLines(log: string[], text: string): number {
  return log.filter((line) => line.includes(text)).length;
}

describe('GAUNTLET 1.2 — single-flight iOS unlock', () => {
  it('A. one tap (gesture + immediate resumeContext) issues ONE native resume', async () => {
    const { spy, triggerResume } = installFakeAudio('suspended', 'manual');
    const engine = new AudioEngine();
    // EXACT production sequence: sync gesture unlock, then async startup.
    const p1 = engine.gestureUnlock();
    const p2 = engine.resumeContext();
    expect(spy.resumeCalls).toBe(1);
    triggerResume();
    await p1;
    await p2;
    expect(spy.resumeCalls).toBe(1);
    // Exactly one 'resume requested' line in the whole log.
    expect(countLines(engine.getStartupLog(), 'resume requested')).toBe(1);
  });

  it('B. second waiter reuses the same in-flight unlock', async () => {
    const { spy, triggerResume } = installFakeAudio('suspended', 'manual');
    const engine = new AudioEngine();
    const p1 = engine.gestureUnlock();
    const p2 = engine.resumeContext();
    const p3 = engine.resumeContext();
    expect(spy.resumeCalls).toBe(1);
    triggerResume();
    await Promise.all([p1, p2, p3]);
    expect(spy.resumeCalls).toBe(1);
    expect(countLines(engine.getStartupLog(), 'resumePromise reused')).toBe(2);
  });

  it('C. concurrent second gesture while unlock pending: one resume, one probe', async () => {
    const { spy, triggerResume } = installFakeAudio('suspended', 'manual');
    const engine = new AudioEngine();
    const p1 = engine.gestureUnlock();
    const p2 = engine.gestureUnlock();
    expect(spy.resumeCalls).toBe(1);
    expect(spy.buffers).toEqual([{ channels: 1, length: 1 }]);
    expect(spy.sourcesStarted).toBe(1);
    triggerResume();
    await Promise.all([p1, p2]);
    expect(spy.resumeCalls).toBe(1);
    expect(spy.sourcesStarted).toBe(1);
  });

  it('D. already running: zero resumes, zero probe', async () => {
    const { spy } = installFakeAudio('running', 'flip-to-running');
    const engine = new AudioEngine();
    await engine.gestureUnlock();
    await engine.resumeContext();
    expect(spy.resumeCalls).toBe(0);
    expect(spy.buffers).toEqual([]);
    expect(spy.sourcesStarted).toBe(0);
  });

  it('E. interrupted state: one resume, post-state verified', async () => {
    const { spy } = installFakeAudio('interrupted', 'flip-to-running');
    const engine = new AudioEngine();
    await engine.gestureUnlock();
    expect(spy.resumeCalls).toBe(1);
    expect(engine.getStartupLog().join('\n')).toMatch(/initial state=interrupted/);
    expect(engine.getStartupLog().join('\n')).toMatch(/resume resolved \(state after=running\)/);
  });

  it('F. legacy resume() returning void: no crash, explicit verification', async () => {
    installFakeAudio('suspended', 'void');
    const engine = new AudioEngine();
    // State never becomes running: verification must fail LOUDLY, not hang.
    await expect(engine.gestureUnlock()).rejects.toThrow('did not start');
  });

  it('G. resume resolves but state dead: actionable error, decode never starts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }))
    );
    const { spy } = installFakeAudio('suspended', 'resolve-dead');
    const engine = new AudioEngine();
    // Full production path: unlock fails -> loadDefaultTrack rejects before
    // any fetch/decode work (resumeContext throws first).
    await expect(engine.loadDefaultTrack()).rejects.toThrow('did not start');
    expect(spy.resumeCalls).toBe(1);
    expect(engine.usedLightTrack()).toBe(false);
    expect(engine.getTrackDurationMs()).toBe(0);
  });

  it('H. probe is one silent source: 1-sample buffer, started, zero-gain path', async () => {
    const { spy } = installFakeAudio('suspended', 'flip-to-running');
    const engine = new AudioEngine();
    await engine.gestureUnlock();
    expect(spy.buffers).toEqual([{ channels: 1, length: 1 }]);
    expect(spy.sourcesStarted).toBe(1);
    expect(spy.zeroGains).toBe(1);
    // No second probe once unlocked.
    await engine.gestureUnlock();
    expect(spy.buffers).toEqual([{ channels: 1, length: 1 }]);
    expect(spy.sourcesStarted).toBe(1);
  });

  it('I. production Start contract: gesture -> startup, ordered log, single resume', async () => {
    const { spy } = installFakeAudio('suspended', 'flip-to-running');
    const engine = new AudioEngine();
    // Mirrors handleStartAction + startRound: sync gesture, then async resume.
    const p1 = engine.gestureUnlock();
    p1.catch(() => {});
    await engine.resumeContext();
    await p1;
    expect(spy.resumeCalls).toBe(1);
    const log = engine.getStartupLog();
    const text = log.join('\n');
    expect(countLines(log, 'start gesture')).toBe(1);
    expect(countLines(log, 'resume requested')).toBe(1);
    expect(countLines(log, 'unlock probe started')).toBe(1);
    expect(
      text.indexOf('start gesture') <
        text.indexOf('resume requested') &&
        text.indexOf('resume requested') < text.indexOf('unlock probe started') &&
        text.indexOf('unlock probe started') < text.indexOf('resume resolved')
    ).toBe(true);
  });

  it('J. gesture facts land in the log (click / isTrusted / userActivation)', async () => {
    installFakeAudio('suspended', 'flip-to-running');
    const engine = new AudioEngine();
    await engine.gestureUnlock({ event: 'click', isTrusted: true, userActivation: true });
    expect(engine.getStartupLog().join('\n')).toMatch(
      /event=click isTrusted=true userActivation\.isActive=true/
    );
  });

  it('K. gestureUnlock without source still works (backwards compatible)', async () => {
    installFakeAudio('suspended', 'flip-to-running');
    const engine = new AudioEngine();
    await engine.gestureUnlock();
    expect(engine.getStartupLog().join('\n')).toMatch(/start gesture/);
  });
});
