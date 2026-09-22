import type { ChartEvent } from '../types';
import { TimingClock } from './TimingClock';
import { DEFAULT_TRACK_URL } from './defaultTrack';
import { fetchBytesWithProgress, type FetchBytesProgress } from './fetchBytes';
import { perfMark } from './perf';

/** Telemetry-only loading stage (never drives game logic). */
export type AudioLoadStage = 'idle' | 'downloading' | 'decoding' | 'ready' | 'error';

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

  // Stage 1 preload cache: raw MP3 bytes fetched in background on page open.
  // No AudioContext is touched here (autoplay-safe). Single-flight.
  // Every fetch is stall-bounded (see fetchBytes): a dead connection settles
  // instead of hanging Start forever.
  private preloadPromise: Promise<ArrayBuffer> | null = null;
  private preloadedBytes: ArrayBuffer | null = null;
  private loadStage: AudioLoadStage = 'idle';
  private lastFetchProgress: FetchBytesProgress | null = null;
  private fetchProgressListeners = new Set<(p: FetchBytesProgress) => void>();

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

  /**
   * Initializes or resumes AudioContext to bypass mobile autoplay restrictions.
   */
  public async resumeContext(): Promise<AudioContext> {
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
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    return this.audioCtx;
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
    this.preloadPromise = fetchBytesWithProgress(DEFAULT_TRACK_URL, {
      onProgress: (p) => {
        this.lastFetchProgress = p;
        for (const cb of this.fetchProgressListeners) {
          try {
            cb(p);
          } catch {
            // Listener errors must never break loading.
          }
        }
      },
    }).then((bytes) => {
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
   * bytes when available, otherwise fetches first. Throws when the asset
   * is missing so callers can fall back explicitly (dev guide loop)
   * instead of silently synthesizing 160 s on the tap path.
   */
  public async loadDefaultTrack(): Promise<AudioBuffer> {
    if (this.defaultBuffer) return this.defaultBuffer;
    if (this.defaultPromise) return this.defaultPromise;

    this.defaultPromise = (async () => {
      const ctx = await this.resumeContext();
      this.loadStage = 'decoding';
      perfMark('audio-decode-start');
      const bytes = this.preloadedBytes ?? (await this.preloadDefaultTrackBytes());
      // Slice: decodeAudioData may detach the input in some browsers —
      // the cached copy stays intact for potential re-decodes.
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      this.defaultBuffer = decoded;
      this.loadStage = 'ready';
      perfMark('audio-decode-end');
      return decoded;
    })();

    try {
      return await this.defaultPromise;
    } catch (err) {
      this.defaultPromise = null;
      this.loadStage = 'error';
      throw err;
    }
  }

  /** Active buffer duration in ms (0 when no track loaded). Source of truth. */
  public getTrackDurationMs(): number {
    if (this.trackBuffer) return this.trackBuffer.duration * 1000;
    if (this.customBuffer) return this.customBuffer.duration * 1000;
    if (this.defaultBuffer) return this.defaultBuffer.duration * 1000;
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
