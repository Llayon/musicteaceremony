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

function streamResponse(bytes: Uint8Array) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'Content-Length' ? String(bytes.byteLength) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function fakeWindow(decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer>, resume?: () => Promise<void>) {
  const gainNode = () => ({ gain: { setValueAtTime: () => {} }, connect: () => {} });
  return {
    AudioContext: function () {
      return {
        currentTime: 100,
        state: 'suspended',
        sampleRate: 48000,
        destination: {},
        resume: resume ?? (async () => {}),
        createGain: gainNode,
        decodeAudioData,
      };
    },
  } as unknown as Window & typeof globalThis;
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
    expect(engine.usedLightTrack()).toBe(false);
  });

  it('falls back to the light mono mix when stereo decode fails', async () => {
    const stereoBytes = new Uint8Array([1, 2, 3]);
    const lightBytes = new Uint8Array([4, 5]);
    const fetchMock = vi.fn(async (url: unknown) =>
      streamResponse(String(url).includes('.light.mp3') ? lightBytes : stereoBytes)
    );
    vi.stubGlobal('fetch', fetchMock);

    const lightBuffer = { duration: 159.019 } as AudioBuffer;
    const decodeAudioData = vi.fn(
      async (_bytes: ArrayBuffer): Promise<AudioBuffer> => lightBuffer
    );
    decodeAudioData.mockRejectedValueOnce(new Error('decode boom'));
    vi.stubGlobal('window', fakeWindow(decodeAudioData));

    const engine = new AudioEngine();
    const buf = await engine.loadDefaultTrack();
    expect(buf).toBe(lightBuffer);
    expect(engine.usedLightTrack()).toBe(true);
    expect(engine.getLoadStage()).toBe('ready');
    expect(engine.getTrackDurationMs()).toBeCloseTo(159019, 0);
    // Stereo fetch + light fetch both happened; stereo decode failed once,
    // light decode succeeded once.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it('throws (caller falls back to metronome) when both mixes fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => streamResponse(new Uint8Array([1]))));
    const decodeAudioData = vi.fn(
      async (_bytes: ArrayBuffer): Promise<AudioBuffer> => {
        throw new Error('nope');
      }
    );
    vi.stubGlobal('window', fakeWindow(decodeAudioData));

    const engine = new AudioEngine();
    await expect(engine.loadDefaultTrack()).rejects.toThrow();
    expect(engine.usedLightTrack()).toBe(false);
    expect(engine.getLoadStage()).toBe('error');
  });

  it('resume watchdog fails loudly instead of hanging Start', async () => {
    vi.stubGlobal('window', fakeWindow(
      async () => ({ duration: 1 }) as AudioBuffer,
      () => new Promise<void>(() => {}) // resume() never settles
    ));
    vi.useFakeTimers();
    try {
      const engine = new AudioEngine();
      const pending = engine.resumeContext();
      const assertion = expect(pending).rejects.toThrow('Sound unlock timed out');
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
