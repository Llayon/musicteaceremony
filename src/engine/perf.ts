/**
 * Dev-only performance marks. Zero-cost in production when the API is
 * absent, never throws, never affects game logic. Use to split Start
 * latency into network / decode / init facts instead of guesses.
 */
export function perfMark(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name);
    }
  } catch {
    // Telemetry must never break gameplay.
  }
}

/** Elapsed ms between two marks, or null when unavailable. */
export function perfSpanMs(startMark: string, endMark: string): number | null {
  try {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
      return null;
    }
    const entry = performance.measure(`span:${startMark}->${endMark}`, startMark, endMark);
    return entry.duration;
  } catch {
    return null;
  }
}
