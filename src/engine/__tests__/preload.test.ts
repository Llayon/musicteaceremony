import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from '../AudioEngine';

function mockFetchBytes(bytes: Uint8Array, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('default-track preload (stage 1: fetch-only, no AudioContext)', () => {
  it('shares one fetch across concurrent callers (single-flight)', async () => {
    const fetchMock = mockFetchBytes(new Uint8Array([1, 2, 3]));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new AudioEngine();
    expect(engine.getLoadStage()).toBe('idle');
    const [a, b] = await Promise.all([
      engine.preloadDefaultTrackBytes(),
      engine.preloadDefaultTrackBytes(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(a)).toEqual(new Uint8Array([1, 2, 3]));
    expect(a.byteLength).toBe(b.byteLength);
  });

  it('reuses cached bytes without refetching', async () => {
    const fetchMock = mockFetchBytes(new Uint8Array([9]));
    vi.stubGlobal('fetch', fetchMock);

    const engine = new AudioEngine();
    await engine.preloadDefaultTrackBytes();
    await engine.preloadDefaultTrackBytes();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resets after failure so Start can retry', async () => {
    const fail = mockFetchBytes(new Uint8Array(), false, 404);
    vi.stubGlobal('fetch', fail);

    const engine = new AudioEngine();
    await expect(engine.preloadDefaultTrackBytes()).rejects.toThrow();
    expect(engine.getLoadStage()).toBe('error');

    const ok = mockFetchBytes(new Uint8Array([7]));
    vi.stubGlobal('fetch', ok);
    const bytes = await engine.preloadDefaultTrackBytes();
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([7]));
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('loadDefaultTrack decodes cached bytes without refetching', async () => {
    const fetchMock = mockFetchBytes(new Uint8Array([1, 2, 3, 4]));
    vi.stubGlobal('fetch', fetchMock);

    const decodedBuffer = { duration: 159.019 } as AudioBuffer;
    const decodeAudioData = vi.fn(async () => decodedBuffer);
    const gainNode = () => ({ gain: { setValueAtTime: () => {} }, connect: () => {} });
    vi.stubGlobal('window', {
      AudioContext: function () {
        return {
          currentTime: 100,
          state: 'running',
          sampleRate: 48000,
          destination: {},
          resume: async () => {},
          createGain: gainNode,
          decodeAudioData,
        };
      },
    } as unknown as Window & typeof globalThis);

    const engine = new AudioEngine();
    await engine.preloadDefaultTrackBytes();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const buf = await engine.loadDefaultTrack();
    expect(buf).toBe(decodedBuffer);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second fetch
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(engine.getLoadStage()).toBe('ready');
    expect(engine.getTrackDurationMs()).toBeCloseTo(159019, 0);
  });
});
