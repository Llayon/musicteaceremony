import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBytesWithProgress, FetchStalledError, withTimeout } from '../fetchBytes';

function mockResponse(chunks: Uint8Array[], opts: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = opts;
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  return {
    ok,
    status,
    headers: { get: (name: string) => (name === 'Content-Length' ? String(total) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBytesWithProgress', () => {
  it('streams chunks, reports progress, merges bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4, 5]),
    ])));
    const seen: number[] = [];
    const bytes = await fetchBytesWithProgress('http://x/a.mp3', {
      stallTimeoutMs: 1000,
      onProgress: (p) => seen.push(p.received),
    });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(seen).toEqual([2, 5]);
  });

  it('rejects on HTTP error (settles, never hangs)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse([], { ok: false, status: 404 })));
    await expect(fetchBytesWithProgress('http://x/missing.mp3')).rejects.toThrow('HTTP 404');
  });

  it('aborts a stalled body instead of hanging forever', async () => {
    const hanging = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      // Headers arrived, body never yields a chunk.
      body: new ReadableStream<Uint8Array>({ start() {} }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => hanging));
    await expect(
      fetchBytesWithProgress('http://x/stalled.mp3', { stallTimeoutMs: 30 })
    ).rejects.toThrow(FetchStalledError);
  });

  it('falls back to arrayBuffer when streaming is unavailable', async () => {
    const bytes = new Uint8Array([7, 8]).buffer;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => bytes,
    })));
    const out = await fetchBytesWithProgress('http://x/old.mp3');
    expect(new Uint8Array(out)).toEqual(new Uint8Array([7, 8]));
  });
});

describe('withTimeout (decode watchdog shape)', () => {
  it('passes fast resolutions through untouched', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, () => new Error('x'))).resolves.toBe(42);
  });

  it('passes rejections through untouched', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 50, () => new Error('x'))
    ).rejects.toThrow('boom');
  });

  it('rejects a hung promise after the timeout (game starts via fallback)', async () => {
    await expect(
      withTimeout(new Promise<never>(() => {}), 20, () => new Error('decode too slow'))
    ).rejects.toThrow('decode too slow');
  });
});
