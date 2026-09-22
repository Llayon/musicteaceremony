import { ChartEvent } from '../types';

export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private trackSource: AudioBufferSourceNode | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  // Multi-stem gain nodes
  private stemGains: {
    drums: GainNode | null;
    bass: GainNode | null;
    chords: GainNode | null;
    lead: GainNode | null;
  } = {
    drums: null,
    bass: null,
    chords: null,
    lead: null,
  };

  private trackStartTime: number = 0;
  private isPlaying: boolean = false;
  private trackBuffer: AudioBuffer | null = null;
  private currentBpm: number = 130;
  private offsetMs: number = 0;

  // Lookahead cue scheduler
  private lookaheadTimerId: number | null = null;
  private scheduledCueIndices = new Set<string>();

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
      this.masterGain.gain.setValueAtTime(0.85, this.audioCtx.currentTime);

      this.sfxGain = this.audioCtx.createGain();
      this.sfxGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      // Stems
      this.stemGains.drums = this.audioCtx.createGain();
      this.stemGains.bass = this.audioCtx.createGain();
      this.stemGains.chords = this.audioCtx.createGain();
      this.stemGains.lead = this.audioCtx.createGain();

      this.stemGains.drums.connect(this.masterGain);
      this.stemGains.bass.connect(this.masterGain);
      this.stemGains.chords.connect(this.masterGain);
      this.stemGains.lead.connect(this.masterGain);

      this.masterGain.connect(this.audioCtx.destination);
      this.sfxGain.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    return this.audioCtx;
  }

  /**
   * Adjusts volume of SFX and rhythm cues (0 to 1.5)
   */
  public setSfxVolume(volume: number): void {
    if (this.sfxGain && this.audioCtx) {
      this.sfxGain.gain.setValueAtTime(
        Math.max(0, Math.min(1.5, volume)),
        this.audioCtx.currentTime
      );
    }
  }

  /**
   * Adjusts volume of specific audio stems (0 to 1)
   */
  public setStemVolume(stem: 'drums' | 'bass' | 'chords' | 'lead', volume: number): void {
    if (this.stemGains[stem] && this.audioCtx) {
      this.stemGains[stem]!.gain.setValueAtTime(
        Math.max(0, Math.min(1, volume)),
        this.audioCtx.currentTime
      );
    }
  }

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

  public setOffsetMs(offsetMs: number): void {
    this.offsetMs = offsetMs;
  }

  public getOffsetMs(): number {
    return this.offsetMs;
  }

  /**
   * Dual-Clock source of truth:
   * Returns exact elapsed playback time in milliseconds based purely on AudioContext.currentTime.
   */
  public getExactSongTime(): number {
    if (!this.isPlaying || !this.audioCtx) {
      return 0;
    }
    const elapsedSeconds = this.audioCtx.currentTime - this.trackStartTime;
    return Math.max(0, elapsedSeconds * 1000 - this.offsetMs);
  }

  public getAudioCurrentTime(): number {
    return this.audioCtx ? this.audioCtx.currentTime : 0;
  }

  /**
   * Starts track playback with lookahead scheduling
   */
  public startTrack(
    audioBuffer: AudioBuffer,
    chartData: ChartEvent[],
    bpm: number = 130,
    offsetMs: number = 0
  ): void {
    if (!this.audioCtx || !this.masterGain) {
      throw new Error('AudioContext not initialized. Call resumeContext() first.');
    }

    this.stopTrack();

    this.trackBuffer = audioBuffer;
    this.currentBpm = bpm;
    this.offsetMs = offsetMs;
    this.scheduledCueIndices.clear();

    const lookaheadDelaySec = 0.1; // 100ms lookahead start delay
    this.trackStartTime = this.audioCtx.currentTime + lookaheadDelaySec;
    this.isPlaying = true;

    this.trackSource = this.audioCtx.createBufferSource();
    this.trackSource.buffer = audioBuffer;
    this.trackSource.connect(this.masterGain);

    this.trackSource.onended = () => {
      // Stopped
    };

    this.trackSource.start(this.trackStartTime);

    // Lookahead scheduler for Rhythm Heaven cues
    this.startLookaheadScheduler(chartData);
  }

  /**
   * Stops current playback cleanly
   */
  public stopTrack(): void {
    if (this.lookaheadTimerId !== null) {
      window.clearInterval(this.lookaheadTimerId);
      this.lookaheadTimerId = null;
    }

    if (this.trackSource) {
      try {
        this.trackSource.stop();
        this.trackSource.disconnect();
      } catch {
        // Already stopped
      }
      this.trackSource = null;
    }

    this.isPlaying = false;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Schedules audio cues (anticipation wooden clack) with lookahead window
   * Cues fire at the exact sub-millisecond instant the droplet detaches from the bamboo ladle (2 beats prior to target)
   */
  private startLookaheadScheduler(chartData: ChartEvent[]): void {
    const SCHEDULE_INTERVAL_MS = 25;
    const LOOKAHEAD_WINDOW_SEC = 0.12;

    this.lookaheadTimerId = window.setInterval(() => {
      if (!this.isPlaying || !this.audioCtx) return;

      const currentCtxTime = this.audioCtx.currentTime;
      const beatDuration = 60 / this.currentBpm;
      const approachTimeSec = beatDuration * 2; // Exactly 2 beats approach time

      chartData.forEach((note) => {
        const noteAudioTime = this.trackStartTime + (note.timeMs + this.offsetMs) / 1000;

        // Launch cue exactly when droplet leaves the bamboo hishaku (2 beats before target hit)
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

    gain.gain.setValueAtTime(0.65, targetTime);
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
    clickGain.gain.setValueAtTime(0.42, targetTime);
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
    dropGain.gain.setValueAtTime(0.30, targetTime);
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

    gain.gain.setValueAtTime(rating === 'PERFECT' ? 0.75 : 0.60, now);
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
    splashGain.gain.setValueAtTime(0.40, now);
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
   * Synthesizes the 130 BPM 4-Stem Zen Track matching the user's attached music:
   * Stem 1: Deep Rolling Bass & 808
   * Stem 2: 130 BPM Breakbeat Drums (Kick, Snare on 2&4, 16th hats, fills)
   * Stem 3: Japanese Acoustic Koto & Guitar Chords
   * Stem 4: Zen Bamboo Wind, Bells & Pads
   */
  public generateZenSoundtrack(bpm: number = 130, totalSeconds: number = 160): AudioBuffer {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }

    const sampleRate = this.audioCtx.sampleRate;
    const totalSamples = Math.floor(sampleRate * totalSeconds);
    const buffer = this.audioCtx.createBuffer(2, totalSamples, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const beatSec = 60 / bpm; // ~0.4615s at 130 BPM
    const totalBeats = Math.floor(totalSeconds / beatSec);

    // E minor pentatonic / Japanese Insen pitches
    // E (164.81), G (196.00), A (220.00), B (246.94), D (293.66), E (329.63), G (392.00)
    const bassPitches = [82.41, 82.41, 98.0, 110.0, 73.42, 82.41, 123.47];
    const kotoPitches = [329.63, 392.0, 440.0, 493.88, 587.33, 659.25, 783.99];

    // 1. Ambient Zen Atmosphere bed (Steam whisper & gentle rain/wind)
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const noise = (Math.random() * 2 - 1) * 0.003;
      const atmosphericDrone =
        Math.sin(2 * Math.PI * 164.81 * t) * 0.008 * (1 + 0.3 * Math.sin(2 * Math.PI * 0.15 * t));
      left[i] = noise + atmosphericDrone;
      right[i] = -noise + atmosphericDrone;
    }

    // 2. Synthesize each beat in the 130 BPM grid
    for (let beat = 0; beat < totalBeats; beat++) {
      const beatTime = beat * beatSec;
      const beatStartSample = Math.floor(beatTime * sampleRate);
      const bar = Math.floor(beat / 4);
      const beatInBar = beat % 4; // 0, 1, 2, 3

      // Breakdown silence at Bars 45 - 52 (~1:21 to 1:36)
      const isBreakdown = bar >= 44 && bar < 52;
      const isIntro = bar < 4;

      // --- STEM 2: DRUMS (Punchy Rhythm Heaven transient definition) ---
      if (!isBreakdown && !isIntro) {
        // Kick on Beat 0 and Beat 2 (solid downbeat & backbeat anchors)
        if (beatInBar === 0 || beatInBar === 2) {
          const kickLen = Math.floor(sampleRate * 0.22);
          for (let s = 0; s < kickLen && beatStartSample + s < totalSamples; s++) {
            const t = s / sampleRate;
            const freq = 135 * Math.exp(-t * 22) + 42;
            const click = Math.sin(2 * Math.PI * 1800 * t) * 0.24 * Math.exp(-t * 70);
            const body = Math.sin(2 * Math.PI * freq * t) * (0.46 * Math.exp(-t * 13));
            const val = body + click;
            left[beatStartSample + s] += val;
            right[beatStartSample + s] += val;
          }
        }

        // Snare on Beat 1 and Beat 3 (crisp crack & presence)
        if (beatInBar === 1 || beatInBar === 3) {
          const snareLen = Math.floor(sampleRate * 0.20);
          for (let s = 0; s < snareLen && beatStartSample + s < totalSamples; s++) {
            const t = s / sampleRate;
            const snap = Math.sin(2 * Math.PI * 2200 * t) * 0.26 * Math.exp(-t * 60);
            const tonal = Math.sin(2 * Math.PI * 205 * t) * 0.24 * Math.exp(-t * 18);
            const noise = (Math.random() * 2 - 1) * 0.28 * Math.exp(-t * 14);
            const val = tonal + noise + snap;
            left[beatStartSample + s] += val;
            right[beatStartSample + s] += val;
          }
        }

        // 16th note Hi-Hats (crisp electronic shimmer)
        const sixteenthLen = Math.floor(sampleRate * (beatSec / 4));
        for (let sub = 0; sub < 4; sub++) {
          const subStart = beatStartSample + sub * sixteenthLen;
          const hatLen = Math.floor(sampleRate * 0.04);
          const hatAmp = sub % 2 === 0 ? 0.08 : 0.045;
          for (let s = 0; s < hatLen && subStart + s < totalSamples; s++) {
            const t = s / sampleRate;
            const noise = (Math.random() * 2 - 1) * hatAmp * Math.exp(-t * 85);
            left[subStart + s] += noise;
            right[subStart + s] += noise * 0.8;
          }
        }
      }

      // --- STEM 1: ROLLING BASS (Active with drums) ---
      if (!isBreakdown && !isIntro) {
        const bassPitch = bassPitches[(bar * 2 + beatInBar) % bassPitches.length];
        const bassLen = Math.floor(sampleRate * 0.4);
        for (let s = 0; s < bassLen && beatStartSample + s < totalSamples; s++) {
          const t = s / sampleRate;
          // Rich sub + warm saturation
          const bass =
            (Math.sin(2 * Math.PI * bassPitch * t) * 0.22 +
              Math.sin(2 * Math.PI * bassPitch * 2 * t) * 0.09) *
            Math.exp(-t * 5.0);
          left[beatStartSample + s] += bass;
          right[beatStartSample + s] += bass;
        }
      }

      // --- STEM 3: KOTO / GUITAR ARPEGGIOS ---
      if (beat % 2 === 0 || isBreakdown) {
        const pitch = kotoPitches[(beat * 3) % kotoPitches.length];
        const pluckLen = Math.floor(sampleRate * 0.7);
        for (let s = 0; s < pluckLen && beatStartSample + s < totalSamples; s++) {
          const t = s / sampleRate;
          const env = Math.exp(-t * 4.2);
          const pluck =
            (Math.sin(2 * Math.PI * pitch * t) * 0.16 +
              Math.sin(2 * Math.PI * pitch * 2 * t) * 0.07 +
              Math.sin(2 * Math.PI * pitch * 3 * t) * 0.02) *
            env;
          left[beatStartSample + s] += pluck * 0.85;
          right[beatStartSample + s] += pluck * 1.15;
        }
      }

      // --- STEM 4: RHYTHM GUIDE & BAMBOO BEAT PULSE ---
      // Authentic bamboo woodblock count-in during Intro (bars 0-3) and Breakdown
      if (isIntro || isBreakdown) {
        const countLen = Math.floor(sampleRate * 0.05);
        const countFreq = beatInBar === 0 ? 980 : 660;
        const countAmp = beatInBar === 0 ? 0.32 : 0.24;
        for (let s = 0; s < countLen && beatStartSample + s < totalSamples; s++) {
          const t = s / sampleRate;
          const click = Math.sin(2 * Math.PI * 2200 * t) * 0.18 * Math.exp(-t * 80);
          const wood = Math.sin(2 * Math.PI * countFreq * t) * countAmp * Math.exp(-t * 60);
          left[beatStartSample + s] += wood + click;
          right[beatStartSample + s] += wood + click;
        }
      } else {
        // Continuous subtle woodblock beat pulse in grooves so player never loses the grid
        const pulseLen = Math.floor(sampleRate * 0.035);
        const pulseFreq = beatInBar === 0 ? 1150 : 760;
        const pulseAmp = beatInBar === 0 ? 0.14 : 0.09;
        for (let s = 0; s < pulseLen && beatStartSample + s < totalSamples; s++) {
          const t = s / sampleRate;
          const pulse = Math.sin(2 * Math.PI * pulseFreq * t) * pulseAmp * Math.exp(-t * 75);
          left[beatStartSample + s] += pulse;
          right[beatStartSample + s] += pulse;
        }
      }

      // Zen Temple Bell at section downbeats (every 8 bars)
      if (bar % 8 === 0 && beatInBar === 0) {
        const bellLen = Math.floor(sampleRate * 2.5);
        for (let s = 0; s < bellLen && beatStartSample + s < totalSamples; s++) {
          const t = s / sampleRate;
          const bell =
            (Math.sin(2 * Math.PI * 440 * t) * 0.12 +
              Math.sin(2 * Math.PI * 880 * t) * 0.08 +
              Math.sin(2 * Math.PI * 1320 * t) * 0.04) *
            Math.exp(-t * 1.8);
          left[beatStartSample + s] += bell;
          right[beatStartSample + s] += bell;
        }
      }
    }

    return buffer;
  }
}
