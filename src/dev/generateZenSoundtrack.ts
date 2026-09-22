/**
 * DEV-ONLY procedural mix — NOT part of the production bundle path.
 *
 * This module is intentionally imported by nothing in `src/` production
 * code. It exists for offline sound-design iteration and short previews
 * only. Do NOT call it on the player Start path: it synchronously renders
 * minutes of stereo PCM on the main thread (stall + huge allocation,
 * fatal in Telegram WebViews on mobile). Production gameplay loads the
 * pre-rendered asset via `AudioEngine.loadDefaultTrack()`.
 */

/**
 * DEV-ONLY: full procedural mix rendered synchronously.
 */
export function generateZenSoundtrack(
  audioCtx: AudioContext,
  bpm = 90,
  totalSeconds = 160
): AudioBuffer {
  if (totalSeconds > 30 && typeof console !== 'undefined') {
    console.warn(
      `[dev] generateZenSoundtrack(${bpm}, ${totalSeconds}s) is DEV-ONLY: ` +
        `synchronous long-form synthesis stalls the main thread. ` +
        `Use AudioEngine.loadDefaultTrack() for gameplay.`
    );
  }

  const sampleRate = audioCtx.sampleRate;
  const totalSamples = Math.floor(sampleRate * totalSeconds);
  const buffer = audioCtx.createBuffer(2, totalSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const beatSec = 60 / bpm; // ~0.6667s at the 90 BPM dev default
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

  // 2. Synthesize each beat in the dev BPM grid
  for (let beat = 0; beat < totalBeats; beat++) {
    const beatTime = beat * beatSec;
    const beatStartSample = Math.floor(beatTime * sampleRate);
    const bar = Math.floor(beat / 4);
    const beatInBar = beat % 4; // 0, 1, 2, 3

    // Breakdown silence at Bars 45 - 52 (~1:21 to 1:36)
    const isBreakdown = bar >= 44 && bar < 52;
    const isIntro = bar < 4;

    // --- DRUMS (Punchy transient definition) ---
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
        const snareLen = Math.floor(sampleRate * 0.2);
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

    // --- ROLLING BASS (Active with drums) ---
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

    // --- KOTO / GUITAR ARPEGGIOS ---
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

    // --- RHYTHM GUIDE & BAMBOO BEAT PULSE ---
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
