/**
 * Bounded network fetch for audio bytes.
 *
 * Plain `fetch()` has no timeout: on a flaky mobile connection the request
 * can stall FOREVER, and a hung shared preload promise then poisons Start
 * (eternal "loading" with no error and no fallback). This helper fixes that:
 * - stall detection: aborts when no bytes arrive for `stallTimeoutMs`
 *   (slow-but-moving downloads keep going — only dead connections die);
 * - byte progress from Content-Length when the server sends it;
 * - every outcome settles: bytes, HTTP error, or stall abort. Never hangs.
 */

export interface FetchBytesProgress {
  received: number;
  total: number | null;
}

export interface FetchBytesOptions {
  /** Abort when no data arrives within this long (default 15 s). */
  stallTimeoutMs?: number;
  onProgress?: (progress: FetchBytesProgress) => void;
  /** Optional outer abort (e.g. component unmount). */
  signal?: AbortSignal;
}

export class FetchStalledError extends Error {
  constructor(url: string, stallTimeoutMs: number) {
    super(
      `Fetch stalled: no data from ${url} for ${(stallTimeoutMs / 1000).toFixed(0)} s. ` +
        `The connection looks dead, not slow.`
    );
    this.name = 'FetchStalledError';
  }
}

const DEFAULT_STALL_TIMEOUT_MS = 15_000;

export async function fetchBytesWithProgress(
  url: string,
  options: FetchBytesOptions = {}
): Promise<ArrayBuffer> {
  const { stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS, onProgress, signal } = options;
  const controller = new AbortController();

  const abortOuter = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abortOuter, { once: true });
  }

  // Every await below races a stall timer: neither hung headers nor a
  // hung body chunk may stall forever (AbortSignal alone does NOT cancel
  // an already-pending reader.read()).
  const raceStall = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new FetchStalledError(url, stallTimeoutMs)), stallTimeoutMs);
    });
    try {
      return await Promise.race([promise, stall]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const response = await raceStall(fetch(url, { signal: controller.signal }));
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}.`);
    }

    const totalHeader = response.headers?.get?.('Content-Length');
    const total = totalHeader !== null && totalHeader !== undefined ? Number(totalHeader) : NaN;
    const totalBytes = Number.isFinite(total) && total > 0 ? total : null;

    // Old WebViews without streaming bodies: single-shot read (still
    // stall-bounded, just without progress).
    if (!response.body || typeof response.body.getReader !== 'function') {
      const bytes = await raceStall(response.arrayBuffer());
      onProgress?.({ received: bytes.byteLength, total: bytes.byteLength });
      return bytes;
    }

    const reader = response.body.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await raceStall(reader.read());
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          onProgress?.({ received, total: totalBytes });
        }
      }

      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return merged.buffer as ArrayBuffer;
    } finally {
      try {
        reader.cancel();
      } catch {
        // Best-effort cleanup only.
      }
    }
  } finally {
    signal?.removeEventListener('abort', abortOuter);
  }
}
