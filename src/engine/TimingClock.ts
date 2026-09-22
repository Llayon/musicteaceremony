/**
 * TimingClock — small central abstraction over the Web Audio timeline.
 *
 * Audio source of truth:
 *   AudioContext.currentTime is the authoritative gameplay clock. Visuals,
 *   progress, miss detection and input judgment all derive from it; frame
 *   deltas, Date.now(), React timers and setInterval are never game truth
 *   (a short setInterval is used only as a lookahead cue scheduler — actual
 *   sound timing is determined by Web Audio scheduling).
 *
 * Input timestamp source:
 *   PointerEvent.timeStamp (browser performance timeline) where plausible,
 *   otherwise AudioContext.currentTime at handler execution time.
 *
 * Timestamp conversion:
 *   performance timeline -> audio timeline via AudioContext.getOutputTimestamp()
 *   mapping when available, feature-detected with a safe fallback. The
 *   mapping is validated for plausibility (rejects epoch-based timestamps
 *   and estimates more than ~1s away from currentTime).
 *
 * Calibration semantics:
 *   - inputOffsetMs (default 0): subtracted from the measured tap time
 *     BEFORE judging. Positive inputOffsetMs makes a recorded tap count as
 *     EARLIER (compensates for hearing audio late, e.g. Bluetooth delay);
 *     negative makes it count as LATER. Affects judgment only — never
 *     visuals, progress, audio scheduling, or auto-miss timing.
 *   - audioOutputOffsetMs (default 0): optional manual compensation for
 *     output-path latency. Positive means the audible output is late.
 *     Reported/available for visual alignment; NOT applied to judgment in
 *     Gauntlet 0 and left at 0 unless a device-specific need is proven.
 *
 * Fallback path:
 *   If getOutputTimestamp / baseLatency / outputLatency are unavailable
 *   (common in Telegram WebViews), or timestamps fail plausibility checks,
 *   conversion falls back to AudioContext.currentTime sampled in the event
 *   handler. This is robust but carries handler-execution jitter — it is
 *   described honestly as audio-clock synchronized timing, never
 *   sub-millisecond physical input accuracy.
 */

export interface OutputLatencyInfo {
  /** ctx.baseLatency in ms when exposed, else null. */
  baseLatencyMs: number | null;
  /** ctx.outputLatency in ms when exposed, else null. */
  outputLatencyMs: number | null;
  /** Whether getOutputTimestamp mapping is available. */
  hasOutputTimestamp: boolean;
}

const PLAUSIBILITY_WINDOW_SEC = 1.0;

export class TimingClock {
  private audioCtx: AudioContext | null = null;
  private trackStartTimeSec = 0;

  /**
   * Input calibration in ms. Subtracted from measured tap time pre-judge.
   * Positive => tap counts as earlier. Default 0. Judgment only.
   */
  private inputOffsetMs = 0;

  /**
   * Optional output-path compensation in ms. Default 0. Not applied to
   * judgment in Gauntlet 0; available for visual alignment experiments.
   */
  private audioOutputOffsetMs = 0;

  public attach(audioCtx: AudioContext): void {
    this.audioCtx = audioCtx;
  }

  public setTrackStartTime(trackStartTimeSec: number): void {
    this.trackStartTimeSec = trackStartTimeSec;
  }

  public getTrackStartTime(): number {
    return this.trackStartTimeSec;
  }

  public setInputOffsetMs(offsetMs: number): void {
    this.inputOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
  }

  public getInputOffsetMs(): number {
    return this.inputOffsetMs;
  }

  public setAudioOutputOffsetMs(offsetMs: number): void {
    this.audioOutputOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
  }

  public getAudioOutputOffsetMs(): number {
    return this.audioOutputOffsetMs;
  }

  /** Raw audio clock in seconds (0 when unattached). */
  public getAudioTimeSec(): number {
    return this.audioCtx ? this.audioCtx.currentTime : 0;
  }

  /**
   * Raw song position in ms derived purely from the audio clock.
   * Used for visuals, progress bars and auto-miss detection.
   * Never includes inputOffsetMs.
   */
  public getSongTimeMs(): number {
    if (!this.audioCtx) return 0;
    const elapsedSec = this.audioCtx.currentTime - this.trackStartTimeSec;
    return Math.max(0, elapsedSec * 1000);
  }

  /**
   * Convert a browser event timestamp (PointerEvent.timeStamp,
   * performance-timeline ms) into an audio-clock time in seconds.
   * Returns null when conversion is unavailable/implausible so callers
   * can fall back to sampling currentTime directly.
   */
  public performanceEventToAudioTimeSec(eventTimeStamp: number): number | null {
    const ctx = this.audioCtx;
    if (!ctx || !Number.isFinite(eventTimeStamp)) return null;

    const getOutputTimestamp = (
      ctx as AudioContext & {
        getOutputTimestamp?: () => { contextTime: number; performanceTime: number };
      }
    ).getOutputTimestamp;
    if (typeof getOutputTimestamp !== 'function') return null;

    let mapping: { contextTime: number; performanceTime: number };
    try {
      mapping = getOutputTimestamp.call(ctx);
    } catch {
      return null;
    }
    if (
      !mapping ||
      !Number.isFinite(mapping.contextTime) ||
      !Number.isFinite(mapping.performanceTime)
    ) {
      return null;
    }

    // Guard against epoch-based timeStamp implementations: performanceTime
    // from getOutputTimestamp is performance-timeline based. If the event
    // timestamp is implausibly far from it, the two clocks are not
    // comparable — bail out instead of building a fragile precision hack.
    const eventPerfMs = eventTimeStamp;
    if (eventPerfMs > 1e12 || eventPerfMs < -1e12) return null; // epoch-based
    const skewMs = Math.abs(eventPerfMs - mapping.performanceTime);
    // performanceTime may be in seconds on some implementations — accept
    // either unit by trying both interpretations conservatively.
    const skewMsAlt = Math.abs(eventPerfMs / 1000 - mapping.performanceTime);
    if (Math.min(skewMs, skewMsAlt) > 60_000) return null;

    const deltaSec = (eventPerfMs - mapping.performanceTime) / 1000;
    const estimated = mapping.contextTime + deltaSec;

    // Plausibility: the event must be near "now" on the audio clock.
    // A tap cannot be seconds in the past/future relative to handler time.
    if (Math.abs(estimated - ctx.currentTime) > PLAUSIBILITY_WINDOW_SEC) return null;
    return estimated;
  }

  /**
   * Judgment-ready song time for an input event. Applies inputOffsetMs
   * (positive => earlier). Falls back safely to the raw audio-clock song
   * time when the event timestamp is missing or implausible.
   */
  public inputToSongTimeMs(eventTimeStamp?: number): number {
    const rawSongMs = this.getSongTimeMs();
    if (eventTimeStamp === undefined || eventTimeStamp === null) return rawSongMs - this.inputOffsetMs;

    const audioSec = this.performanceEventToAudioTimeSec(eventTimeStamp);
    if (audioSec === null) return rawSongMs - this.inputOffsetMs;

    const songMs = Math.max(0, (audioSec - this.trackStartTimeSec) * 1000);
    return songMs - this.inputOffsetMs;
  }

  /** Feature-detected output latency report. Never throws. */
  public getLatencyInfo(): OutputLatencyInfo {
    const ctx = this.audioCtx as
      | (AudioContext & { baseLatency?: number; outputLatency?: number })
      | null;
    let base: number | null = null;
    let out: number | null = null;
    if (ctx) {
      if (typeof ctx.baseLatency === 'number' && Number.isFinite(ctx.baseLatency)) {
        base = ctx.baseLatency * 1000;
      }
      if (typeof ctx.outputLatency === 'number' && Number.isFinite(ctx.outputLatency)) {
        out = ctx.outputLatency * 1000;
      }
    }
    const hasOutputTimestamp =
      !!this.audioCtx &&
      typeof (
        this.audioCtx as unknown as { getOutputTimestamp?: unknown }
      ).getOutputTimestamp === 'function';
    return { baseLatencyMs: base, outputLatencyMs: out, hasOutputTimestamp };
  }
}
