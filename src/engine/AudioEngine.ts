import type { ChartEvent } from '../types';
import { TimingClock } from './TimingClock';
import { DEFAULT_TRACK_URL, LIGHT_TRACK_URL } from './defaultTrack';
import { fetchBytesWithProgress, withTimeout, type FetchBytesProgress } from './fetchBytes';
import { perfMark } from './perf';

/** Telemetry-only loading stage (never drives game logic). */
export type AudioLoadStage = 'idle' | 'downloading' | 'decoding' | 'ready' | 'error';

/**
 * Startup phase — WHAT the engine is doing right now. Kept strictly
 * separate from fetchProgress (0..1): progress must NEVER rewrite phase.
 * This separation is what makes the Start overlay truthful ("Включаем
 * звук…" vs "Декодируем основной трек…" are different facts).
 */
export type StartupPhase =
  | 'idle'
  | 'unlocking'
  | 'fetching'
  | 'decoding-stereo'
  | 'decoding-light'
  | 'starting'
  | 'ready'
  | 'error';

export interface StartupLogEntry {
  /** ms since the first logged event of this engine instance. */
  tMs: number;
  event: string;
}

/** Un-narrowed context-state read (see resumeContext). */
function readContextState(ctx: AudioContext): AudioContextState {
  return ctx.state;
}

/**
 * Decode watchdog per attempt: past this the attempt fails over to the next
 * layer instead of waiting forever (decodeAudioData cannot be aborted).
 */
export const DECODE_TIMEOUT_MS = 30_000;

/**
 * Sound-unlock watchdog: resume() outside a honored gesture can pend
 * forever on some WebViews. Past this we fail loudly instead of hanging.
 */
export const RESUME_TIMEOUT_MS = 10_000;

export interface StartTrackOptions {
  /** Loop the buffer (used for the dev guide-loop fallback). Default false. */
  loop?: boolean;
  /** Called exactly once on natural end-of-buffer. Never on manual stop. */
  onEnded?: (() => void) | null;
  /**
   * Anticipation in beats — must match the chart's approachBeats so cues
   * fire exactly at droplet launch. Default 1.5 (1000 ms at 90 BPM).
   */
  approachBeats?: number;
}

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private trackSource: AudioBufferSourceNode | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private readonly clock = new TimingClock();

  private trackStartTime = 0;
  private isPlaying = false;
  private trackBuffer: AudioBuffer | null = null;
  private trackLooped = false;
  private currentBpm = 90;
  private approachBeats = 1.5;

  // Volume state (mute preserves levels without recreating the context).
  private masterVolume = 0.85;
  private sfxVolume = 1.0;
  private muted = false;

  // Custom uploaded track becomes the genuine active track when set.
  // Chart compatibility limit: the chart is fixed to the 90 BPM production
  // groove with no auto-beatmap — a custom track plays as-is and the fixed
  // chart still drives judgment (documented limitation, no BPM detection).
  private customBuffer: AudioBuffer | null = null;
  private customName: string | null = null;

  private defaultBuffer: AudioBuffer | null = null;
  private defaultPromise: Promise<AudioBuffer> | null = null;
  // Light mono fallback (weak phones): fetched on demand, cached per session.
  private lightBytes: ArrayBuffer | null = null;
  private lightBuffer: AudioBuffer | null = null;
  private lastUsedLight = false;

  // Stage 1 preload cache: raw MP3 bytes fetched in background on page open.
  // No AudioContext is touched here (autoplay-safe). Single-flight.
  // Every fetch is stall-bounded (see fetchBytes): a dead connection settles
  // instead of hanging Start forever.
  private preloadPromise: Promise<ArrayBuffer> | null = null;
  private preloadedBytes: ArrayBuffer | null = null;
  private loadStage: AudioLoadStage = 'idle';
  private lastFetchProgress: FetchBytesProgress | null = null;
  private fetchProgressListeners = new Set<(p: FetchBytesProgress) => void>();

  // Startup diagnostics: phase (what) + timestamped log (when/what happened).
  // One iPhone run of this log is enough to identify the hanging stage.
  private startupPhase: StartupPhase = 'idle';
  private phaseListeners = new Set<(p: StartupPhase) => void>();
  private startupLog: StartupLogEntry[] = [];
  private startupT0: number | null = null;
  private startupAttempt = 0;

  private nowMs(): number {
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
    } catch {
      // Fall through to Date.
    }
    return Date.now();
  }

  private logStartup(event: string): void {
    if (this.startupT0 === null) this.startupT0 = this.nowMs();
    this.startupLog.push({ tMs: Math.round(this.nowMs() - this.startupT0), event });
    if (this.startupLog.length > 80) {
      this.startupLog.splice(0, this.startupLog.length - 80);
    }
  }

  private setPhase(phase: StartupPhase): void {
    this.startupPhase = phase;
    for (const cb of this.phaseListeners) {
      try {
        cb(phase);
      } catch {
        // Listener errors must never break loading.
      }
    }
  }

  /** Current startup phase (see StartupPhase). */
  public getStartupPhase(): StartupPhase {
    return this.startupPhase;
  }

  /** Subscribe to phase transitions (immediate snapshot on subscribe). */
  public subscribeStartupPhase(cb: (p: StartupPhase) => void): () => void {
    this.phaseListeners.add(cb);
    try {
      cb(this.startupPhase);
    } catch {
      // Listener errors must never break loading.
    }
    return () => {
      this.phaseListeners.delete(cb);
    };
  }

  /** Human-readable timestamped log, e.g. ["+12ms resume resolved (state=running)"]. */
  public getStartupLog(): string[] {
    return this.startupLog.map((e) => `+${e.tMs}ms ${e.event}`);
  }

  // Lifecycle: suppress the onended callback for manual stops so a manual
  // stop never produces a duplicate "completed" callback.
  private suppressEndedEvent = false;
  private onTrackEnded: (() => void) | null = null;

  // Lookahead cue scheduler
  private lookaheadTimerId: number | null = null;
  private scheduledCueIndices = new Set<string>();
  private disposed = false;

  constructor() {
    // Lazily initialized on pointerdown
  }

  private ensureContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      this.masterGain = this.audioCtx.createGain();
      this.sfxGain = this.audioCtx.createGain();
      this.applyGains();

      this.masterGain.connect(this.audioCtx.destination);
      this.sfxGain.connect(this.audioCtx.destination);
      this.clock.attach(this.audioCtx);
      this.logStartup(`AudioContext created (state=${this.audioCtx.state})`);
    }
    return this.audioCtx;
  }

  // Single-flight unlock: at most ONE native ctx.resume() per unlock
  // attempt, shared by the gesture path and every async waiter. Set
  // synchronously when a cycle starts; cleared on settle.
  private resumePromise: Promise<void> | null = null;

  /**
   * Canonical gesture unlock. Call synchronously FIRST in the Start tap
   * handler, before any async work: iOS Safari honors resume() best inside
   * the trusted gesture. Creates/reuses the context, requests resume
   * exactly once per attempt, fires the silent unlock probe, and returns
   * the shared in-flight promise for async code to await.
   * Safe to call on every tap (no-op when already running; reuses the
   * in-flight unlock when one is pending — never a second native resume).
   *
   * @param source gesture facts for the diagnostic log (event type,
   * isTrusted, userActivation) — what proves the tap was a real click.
   */
  public gestureUnlock(source?: {
    event?: string;
    isTrusted?: boolean;
    userActivation?: boolean | null;
  }): Promise<void> {
    const ctx = this.ensureContext();
    this.logStartup('start gesture');
    if (source) {
      this.logStartup(
        `event=${source.event ?? '?'} isTrusted=${String(source.isTrusted ?? '?')} ` +
          `userActivation.isActive=${String(source.userActivation ?? '?')}`
      );
    }
    this.logStartup(`initial state=${ctx.state}`);
    if (ctx.state === 'running') {
      this.logStartup('already running — no resume, no probe');
      return Promise.resolve();
    }
    if (this.resumePromise) {
      this.logStartup('resumePromise reused (in-flight unlock, no new resume)');
      return this.resumePromise;
    }
    return this.startUnlockCycle(true);
  }

  /**
   * Async unlock for non-gesture code paths (decode, upload). Shares the
   * same single-flight state machine: reuses an in-flight gesture unlock
   * instead of issuing a competing resume(). No probe outside gestures.
   */
  public async resumeContext(): Promise<AudioContext> {
    const ctx = this.ensureContext();
    if (ctx.state === 'running') return ctx;
    if (this.resumePromise) {
      this.logStartup('resumePromise reused (in-flight unlock, no new resume)');
      await this.resumePromise;
      return ctx;
    }
    await this.startUnlockCycle(false);
    return ctx;
  }

  /**
   * Starts one unlock cycle: exactly ONE native resume() call plus (for
   * gesture cycles) one silent probe. Stores the promise synchronously so
   * any concurrent caller reuses it. Clears itself on settle.
   */
  private startUnlockCycle(withProbe: boolean): Promise<void> {
    const ctx = this.ensureContext();
    this.logStartup(withProbe ? 'resume requested' : 'resume requested (background, no probe)');

    let native: Promise<void>;
    try {
      const result = ctx.resume() as unknown;
      // Old webkitAudioContext.resume() returns void, not a promise.
      native =
        result && typeof (result as Promise<void>).then === 'function'
          ? (result as Promise<void>)
          : Promise.resolve();
    } catch (err) {
      native = Promise.reject(err);
    }

    if (withProbe) {
      this.startUnlockProbe(ctx);
    }

    const cycle = (async (): Promise<void> => {
      try {
        await withTimeout(
          native,
          RESUME_TIMEOUT_MS,
          () =>
            new Error(
              'Sound unlock timed out: the browser did not resume audio. ' +
                'Tap Start again (a real tap, not auto-play).'
            )
        );
      } catch (err) {
        this.logStartup(
          `resume rejected: ${err instanceof Error ? err.message : String(err)}`
        );
        throw err;
      }
      const after = readContextState(ctx);
      this.logStartup(`resume resolved (state after=${after})`);
      if (after !== 'running') {
        const msg =
          `Audio did not start (context state="${after}" after resume). ` +
          `На iPhone помогает: повторный тап по Start, перезагрузка страницы, ` +
          `Safari напрямую вместо встроенного браузера.`;
        this.logStartup(`resume ineffective: state=${after}`);
        throw new Error(msg);
      }
    })();

    const tracked = cycle.then(
      () => {
        if (this.resumePromise === tracked) this.resumePromise = null;
      },
      (err: unknown) => {
        if (this.resumePromise === tracked) this.resumePromise = null;
        throw err;
      }
    );
    this.resumePromise = tracked;
    return tracked;
  }

  /**
   * Silent iOS unlock probe: a 1-sample all-zeros buffer started through a
   * zero-gain node. Inaudible by construction (no samples, no gain path),
   * started synchronously in the trusted gesture to help WebKit honor the
   * unlock. Touches neither the gameplay clock nor master/SFX volumes;
   * nodes disconnect onended (no leak). Runs at most once per unlock
   * cycle — in-flight reuse never re-probes, running needs no probe.
   */
  private startUnlockProbe(ctx: AudioContext): void {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0;
      source.connect(zeroGain);
      zeroGain.connect(ctx.destination);
      source.onended = () => {
        try {
          source.disconnect();
          zeroGain.disconnect();
        } catch {
          // Best-effort cleanup only.
        }
      };
      source.start();
      this.logStartup('unlock probe started (1-sample silence, zero-gain)');
    } catch (err) {
      this.logStartup(
        `unlock probe failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public getTimingClock(): TimingClock {
    return this.clock;
  }

  // ---------------------------------------------------------------- volumes

  private applyGains(): void {
    if (!this.audioCtx) return;
    const t = this.audioCtx.currentTime;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, t);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.setValueAtTime(this.muted ? 0 : this.sfxVolume, t);
    }
  }

  /**
   * Real mute: silences track + SFX via gain while the audio clock keeps
   * running uninterrupted (no context recreation, no chart timing change).
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1.5, volume));
    this.applyGains();
  }

  /**
   * Adjusts volume of SFX and rhythm cues (0 to 1.5)
   */
  public setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1.5, volume));
    this.applyGains();
  }

  // ------------------------------------------------------------------ tracks

  /**
   * Loads and decodes an audio file via fetch & audioCtx.decodeAudioData
   */
  public async loadAudio(url: string): Promise<AudioBuffer> {
    const ctx = await this.resumeContext();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio from ${url}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
    this.trackBuffer = decodedBuffer;
    return decodedBuffer;
  }

  /**
   * Decode user-uploaded audio bytes into the genuine active gameplay track.
   * Callers must revoke any object URL they created after decoding.
   */
  public async setCustomTrackFromBytes(bytes: ArrayBuffer, name?: string): Promise<AudioBuffer> {
    const ctx = await this.resumeContext();
    // decodeAudioData detaches/transfers in some browsers — copy for safety.
    const copy = bytes.slice(0);
    const decoded = await ctx.decodeAudioData(copy);
    this.customBuffer = decoded;
    this.customName = name ?? 'custom track';
    return decoded;
  }

  public hasCustomTrack(): boolean {
    return this.customBuffer !== null;
  }

  public getCustomTrackName(): string | null {
    return this.customName;
  }

  public getCustomBuffer(): AudioBuffer | null {
    return this.customBuffer;
  }

  public clearCustomTrack(): void {
    this.customBuffer = null;
    this.customName = null;
  }

  private notifyFetchProgress(p: FetchBytesProgress): void {
    this.lastFetchProgress = p;
    for (const cb of this.fetchProgressListeners) {
      try {
        cb(p);
      } catch {
        // Listener errors must never break loading.
      }
    }
  }

  private async fetchTrackBytes(url: string): Promise<ArrayBuffer> {
    return fetchBytesWithProgress(url, {
      onProgress: (p) => this.notifyFetchProgress(p),
    });
  }

  /**
   * Stage 1 — background preload (call on page open, no gesture needed):
   * fetches the default-song bytes while the user reads the start screen.
   * Never creates/resumes AudioContext. Single-flight: concurrent callers
   * share one fetch; failures reset so Start can retry.
   */
  public preloadDefaultTrackBytes(): Promise<ArrayBuffer> {
    if (this.preloadedBytes) return Promise.resolve(this.preloadedBytes);
    if (this.preloadPromise) return this.preloadPromise;

    this.loadStage = 'downloading';
    perfMark('audio-fetch-start');
    this.preloadPromise = this.fetchTrackBytes(DEFAULT_TRACK_URL).then((bytes) => {
      this.preloadedBytes = bytes;
      perfMark('audio-fetch-end');
      return bytes;
    }).catch((err: unknown) => {
      this.preloadPromise = null;
      if (!this.defaultBuffer) this.loadStage = 'error';
      throw err;
    });
    return this.preloadPromise;
  }

  /** Telemetry-only stage (Downloading / Decoding / Ready); not game truth. */
  public getLoadStage(): AudioLoadStage {
    if (this.defaultBuffer) return 'ready';
    return this.loadStage;
  }

  /** True when default-song bytes are already cached (Start = decode only). */
  public isPreloaded(): boolean {
    return this.preloadedBytes !== null || this.defaultBuffer !== null;
  }

  /** Last known fetch progress (null before any bytes arrive). */
  public getFetchProgress(): FetchBytesProgress | null {
    return this.lastFetchProgress;
  }

  /**
   * Subscribe to fetch progress (for Start-button % display). The callback
   * fires only while a fetch is actually running. Returns an unsubscribe.
   */
  public subscribeFetchProgress(cb: (p: FetchBytesProgress) => void): () => void {
    this.fetchProgressListeners.add(cb);
    const current = this.lastFetchProgress;
    if (current) {
      try {
        cb(current);
      } catch {
        // Listener errors must never break loading.
      }
    }
    return () => {
      this.fetchProgressListeners.delete(cb);
    };
  }

  /**
   * Async production path: decode the pre-rendered default song.
   * Stage 2 — runs on Start (after the user gesture): reuses preloaded
   * bytes when available, otherwise fetches first.
   *
   * Layered fallback (weak phones): full stereo first (~61 MB PCM); when
   * its fetch or decode fails, the light mono mix (~30 MB PCM) is tried.
   * Only when both fail does the caller fall back to the badged dev guide
   * loop. Throws in that case — never hangs: fetch is stall-bounded and
   * each decode is watchdogged (decodeAudioData has no abort API).
   *
   * No parallel decoders and no double cache: a timed-out stereo decode
   * keeps running in the background (it cannot be cancelled), so its late
   * result is deliberately DROPPED, not cached — otherwise a struggling
   * phone would briefly hold stereo AND mono buffers at once, the exact
   * opposite of the fallback's goal. End state is always a single buffer.
   */
  public async loadDefaultTrack(): Promise<AudioBuffer> {
    if (this.defaultBuffer) return this.defaultBuffer;
    if (this.lightBuffer) return this.lightBuffer;
    if (this.defaultPromise) return this.defaultPromise;

    this.startupAttempt += 1;
    this.logStartup(`--- load attempt #${this.startupAttempt} ---`);
    this.defaultPromise = (async () => {
      this.setPhase('unlocking');
      const ctx = await this.resumeContext();
      try {
        if (!this.preloadedBytes) {
          this.setPhase('fetching');
          this.logStartup('fetch stereo started');
          await this.preloadDefaultTrackBytes();
          this.logStartup('fetch stereo finished');
        }
        this.setPhase('decoding-stereo');
        const decoded = await this.decodeTracked(ctx, this.preloadedBytes as ArrayBuffer, false);
        this.lastUsedLight = false;
        this.setPhase('ready');
        return decoded;
      } catch (stereoErr) {
        // Layer 2: light mono mix. Kinder to weak-phone decoders.
        perfMark('audio-light-fallback');
        this.logStartup(
          `stereo layer failed: ${stereoErr instanceof Error ? stereoErr.message : String(stereoErr)}`
        );
        this.lastFetchProgress = null;
        this.setPhase('fetching');
        this.logStartup('fetch light started');
        const lightBytes =
          this.lightBytes ?? (await this.fetchTrackBytes(LIGHT_TRACK_URL));
        this.lightBytes = lightBytes;
        this.logStartup('fetch light finished');
        this.setPhase('decoding-light');
        try {
          const decoded = await this.decodeTracked(ctx, lightBytes, true);
          this.lastUsedLight = true;
          this.setPhase('ready');
          return decoded;
        } catch (lightErr) {
          this.setPhase('error');
          throw lightErr instanceof Error ? lightErr : stereoErr;
        }
      }
    })();

    try {
      return await this.defaultPromise;
    } catch (err) {
      this.defaultPromise = null;
      this.loadStage = 'error';
      this.setPhase('error');
      throw err;
    }
  }

  /** True when the resolved default track is the light mono mix. */
  public usedLightTrack(): boolean {
    return this.lastUsedLight;
  }

  private async decodeTracked(
    ctx: AudioContext,
    bytes: ArrayBuffer,
    light: boolean
  ): Promise<AudioBuffer> {
    const label = light ? 'light' : 'stereo';
    // Slice: decodeAudioData may detach the input in some browsers —
    // the cached copy stays intact for potential re-decodes.
    const t0 = this.nowMs();
    this.logStartup(`decode ${label} started`);
    // NOTE: no late-result caching by design. If this decode times out, a
    // fallback decode starts while this one may still run (it cannot be
    // cancelled); caching a late stereo result on top of the light buffer
    // would pin both in memory on a struggling phone.
    const decoded = await withTimeout(
      ctx.decodeAudioData(bytes.slice(0)),
      DECODE_TIMEOUT_MS,
      () =>
        new Error(
          `Decoding the default track took longer than ${(DECODE_TIMEOUT_MS / 1000).toFixed(0)} s. Falling back.`
        )
    );
    const elapsed = Math.round(this.nowMs() - t0);
    this.logStartup(`decode ${label} resolved in ${elapsed}ms`);
    if (light) {
      this.lightBuffer = decoded;
    } else {
      this.defaultBuffer = decoded;
    }
    this.loadStage = 'ready';
    perfMark('audio-decode-end');
    return decoded;
  }

  /** Active buffer duration in ms (0 when no track loaded). Source of truth. */
  public getTrackDurationMs(): number {
    if (this.trackBuffer) return this.trackBuffer.duration * 1000;
    if (this.customBuffer) return this.customBuffer.duration * 1000;
    if (this.defaultBuffer) return this.defaultBuffer.duration * 1000;
    if (this.lightBuffer) return this.lightBuffer.duration * 1000;
    return 0;
  }

  public isTrackLooped(): boolean {
    return this.trackLooped;
  }

  // ------------------------------------------------------------------ clock

  /**
   * Input calibration offset (ms). Judgment-only: subtracted from the
   * measured tap time before judging (positive => tap counts as earlier).
   * Never shifts visuals, progress, audio scheduling, or auto-miss timing.
   * Default 0.
   */
  public setOffsetMs(offsetMs: number): void {
    this.clock.setInputOffsetMs(offsetMs);
  }

  public getOffsetMs(): number {
    return this.clock.getInputOffsetMs();
  }

  /**
   * Raw song position in ms derived purely from AudioContext.currentTime.
   * No calibration applied — use for visuals, progress, miss detection.
   */
  public getExactSongTime(): number {
    if (!this.isPlaying || !this.audioCtx) {
      return 0;
    }
    return this.clock.getSongTimeMs();
  }

  public getAudioCurrentTime(): number {
    return this.audioCtx ? this.audioCtx.currentTime : 0;
  }

  // ---------------------------------------------------------------- playback

  /**
   * Starts track playback with lookahead scheduling.
   * Cleans any previous source/scheduler state first.
   */
  public startTrack(
    audioBuffer: AudioBuffer,
    chartData: ChartEvent[],
    bpm = 90,
    offsetMs = 0,
    options: StartTrackOptions = {}
  ): void {
    if (!this.audioCtx || !this.masterGain) {
      throw new Error('AudioContext not initialized. Call resumeContext() first.');
    }

    this.stopTrack();

    this.setPhase('starting');
    this.logStartup('track started');
    this.trackBuffer = audioBuffer;
    this.currentBpm = bpm;
    if (options.approachBeats !== undefined && Number.isFinite(options.approachBeats)) {
      this.approachBeats = options.approachBeats;
    }
    // offsetMs is input calibration (judgment only) — never shifts the
    // audio timeline itself. Kept as a parameter for backwards compat.
    this.clock.setInputOffsetMs(offsetMs);
    this.scheduledCueIndices.clear();
    this.suppressEndedEvent = false;
    this.onTrackEnded = options.onEnded ?? null;
    this.trackLooped = options.loop ?? false;

    const lookaheadDelaySec = 0.1; // 100ms lookahead start delay
    this.trackStartTime = this.audioCtx.currentTime + lookaheadDelaySec;
    this.clock.setTrackStartTime(this.trackStartTime);
    this.isPlaying = true;

    this.trackSource = this.audioCtx.createBufferSource();
    this.trackSource.buffer = audioBuffer;
    this.trackSource.loop = this.trackLooped;
    this.trackSource.connect(this.masterGain);

    this.trackSource.onended = () => {
      if (this.suppressEndedEvent) {
        this.suppressEndedEvent = false;
        return;
      }
      // Natural end of buffer: reflect reality, clear scheduler, notify once.
      this.isPlaying = false;
      if (this.lookaheadTimerId !== null) {
        window.clearInterval(this.lookaheadTimerId);
        this.lookaheadTimerId = null;
      }
      this.trackSource = null;
      const cb = this.onTrackEnded;
      this.onTrackEnded = null;
      if (cb) cb();
    };

    this.trackSource.start(this.trackStartTime);

    // Lookahead scheduler for Rhythm Heaven cues
    this.startLookaheadScheduler(chartData);
  }

  /**
   * Stops current playback cleanly. Never triggers the natural-end callback.
   */
  public stopTrack(): void {
    if (this.lookaheadTimerId !== null) {
      window.clearInterval(this.lookaheadTimerId);
      this.lookaheadTimerId = null;
    }

    if (this.trackSource) {
      this.suppressEndedEvent = true;
      try {
        this.trackSource.onended = null;
        this.trackSource.stop();
        this.trackSource.disconnect();
      } catch {
        // Already stopped
      }
      this.trackSource = null;
    }

    this.onTrackEnded = null;
    this.isPlaying = false;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /** Idempotent cleanup for React StrictMode / unmount. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTrack();
  }

  /**
   * Schedules audio cues (quiet wooden anticipation tick) with a lookahead
   * window. Cues fire ONLY for notes flagged `cue` (tutorial + selected
   * pattern openings) — the real drum groove carries all other timing, so
   * the woodblock never competes with the music. Cue time = droplet launch
   * (approachBeats before target). Timing is audio-clock synchronized.
   */
  private startLookaheadScheduler(chartData: ChartEvent[]): void {
    const SCHEDULE_INTERVAL_MS = 25;
    const LOOKAHEAD_WINDOW_SEC = 0.12;

    this.lookaheadTimerId = window.setInterval(() => {
      if (!this.isPlaying || !this.audioCtx) return;

      const currentCtxTime = this.audioCtx.currentTime;
      const beatDuration = 60 / this.currentBpm;
      const approachTimeSec = beatDuration * this.approachBeats;

      chartData.forEach((note) => {
        if (note.status !== 'pending') return;
        if (note.cue !== true) return;
        // Cue scheduling uses the raw audio timeline (no input calibration).
        const noteAudioTime = this.trackStartTime + note.timeMs / 1000;

        // Launch cue exactly when the droplet leaves the bamboo hishaku.
        const cueTime = noteAudioTime - approachTimeSec;
        const cueKey = `cue_${note.id}`;

        if (
          !this.scheduledCueIndices.has(cueKey) &&
          cueTime >= currentCtxTime - 0.015 &&
          cueTime <= currentCtxTime + LOOKAHEAD_WINDOW_SEC
        ) {
          this.scheduledCueIndices.add(cueKey);
          this.scheduleWoodenTick(Math.max(currentCtxTime, cueTime));
        }
      });
    }, SCHEDULE_INTERVAL_MS);
  }

  private scheduleWoodenTick(targetTime: number): void {
    if (!this.audioCtx || !this.sfxGain) return;

    // 1. Resonant bamboo woodblock body ("tok!")
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, targetTime);
    osc.frequency.exponentialRampToValueAtTime(320, targetTime + 0.04);

    // Quiet on purpose: the real groove leads, the cue only orients.
    gain.gain.setValueAtTime(0.45, targetTime);
    gain.gain.exponentialRampToValueAtTime(0.001, targetTime + 0.05);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(targetTime);
    osc.stop(targetTime + 0.055);

    // 2. High-frequency acoustic transient click (cuts through phone speakers)
    const clickOsc = this.audioCtx.createOscillator();
    const clickGain = this.audioCtx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(2400, targetTime);
    clickOsc.frequency.exponentialRampToValueAtTime(1100, targetTime + 0.015);
    clickGain.gain.setValueAtTime(0.3, targetTime);
    clickGain.gain.exponentialRampToValueAtTime(0.001, targetTime + 0.02);

    clickOsc.connect(clickGain);
    clickGain.connect(this.sfxGain);

    clickOsc.start(targetTime);
    clickOsc.stop(targetTime + 0.025);

    // 3. Hishaku droplet launch overtone
    const dropOsc = this.audioCtx.createOscillator();
    const dropGain = this.audioCtx.createGain();
    dropOsc.type = 'sine';
    dropOsc.frequency.setValueAtTime(1450, targetTime);
    dropOsc.frequency.exponentialRampToValueAtTime(2200, targetTime + 0.03);
    dropGain.gain.setValueAtTime(0.22, targetTime);
    dropGain.gain.exponentialRampToValueAtTime(0.001, targetTime + 0.038);

    dropOsc.connect(dropGain);
    dropGain.connect(this.sfxGain);

    dropOsc.start(targetTime);
    dropOsc.stop(targetTime + 0.04);
  }

  /**
   * SFX: Tea Pouring Splash (Hit)
   */
  public playPourSound(rating: 'PERFECT' | 'GOOD'): void {
    if (!this.audioCtx || !this.sfxGain) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = rating === 'PERFECT' ? 880 : 700;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + 0.14);

    gain.gain.setValueAtTime(rating === 'PERFECT' ? 0.75 : 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.19);

    // Sharp water splash transient
    const splashNoise = ctx.createBufferSource();
    const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }
    splashNoise.buffer = noiseBuffer;
    const splashGain = ctx.createGain();
    splashGain.gain.setValueAtTime(0.4, now);
    splashNoise.connect(splashGain);
    splashGain.connect(this.sfxGain);
    splashNoise.start(now);

    if (rating === 'PERFECT') {
      const bell = ctx.createOscillator();
      const bellGain = ctx.createGain();
      bell.type = 'triangle';
      bell.frequency.setValueAtTime(1760, now);
      bellGain.gain.setValueAtTime(0.45, now);
      bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      bell.connect(bellGain);
      bellGain.connect(this.sfxGain);
      bell.start(now);
      bell.stop(now + 0.35);

      // Higher harmonic bell shimmer
      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(3520, now);
      chimeGain.gain.setValueAtTime(0.22, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      chime.connect(chimeGain);
      chimeGain.connect(this.sfxGain);
      chime.start(now);
      chime.stop(now + 0.25);
    }
  }

  /**
   * SFX: Missed Note
   */
  public playMissSound(): void {
    if (!this.audioCtx || !this.sfxGain) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(80, now + 0.12);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.14);
  }

  /**
   * Lightweight dev-only guide loop (~2 bars of metronome clicks) used only
   * when the pre-rendered default asset is unavailable. Fast (<50 ms),
   * looped, and clearly badged in the UI — not a substitute for the mix.
   */
  public generateDevGuideLoop(bpm = 90): AudioBuffer {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.clock.attach(this.audioCtx);
    }
    const sampleRate = this.audioCtx.sampleRate;
    const beatSec = 60 / bpm;
    const totalSec = beatSec * 8; // 2 bars of 4/4
    const totalSamples = Math.floor(sampleRate * totalSec);
    const buffer = this.audioCtx.createBuffer(2, totalSamples, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const out = buffer.getChannelData(ch);
      for (let beat = 0; beat < 8; beat++) {
        const start = Math.floor(beat * beatSec * sampleRate);
        const len = Math.floor(sampleRate * 0.05);
        const freq = beat % 4 === 0 ? 1200 : 800;
        for (let s = 0; s < len && start + s < totalSamples; s++) {
          const t = s / sampleRate;
          out[start + s] += Math.sin(2 * Math.PI * freq * t) * 0.4 * Math.exp(-t * 60);
        }
      }
    }
    return buffer;
  }
}
