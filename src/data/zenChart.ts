import { ChartEvent, ChartMetadata } from '../types';

/**
 * 130 BPM Zen Tea Ceremony Track Analysis
 * Quarter Note (1 beat) = 60,000 / 130 ≈ 461.538 ms
 * 1 Measure (4/4) = 4 * 461.538 ≈ 1846.154 ms
 * Eighth Note = 230.769 ms
 * Sixteenth Note = 115.385 ms
 */
export const ZEN_CHART_METADATA: ChartMetadata = {
  title: 'Утренний Дзен: Чайный Бит',
  artist: 'Zen Master & The Breakbeats',
  bpm: 130,
  offsetMs: 0,
  beatsPerMeasure: 4,
  totalMeasures: 86,
  songLengthMs: 160000, // 2:40 full audio length
};

export const BEAT_MS = 60000 / 130; // 461.53846 ms
export const BAR_MS = BEAT_MS * 4;   // 1846.1538 ms

// Helper to compute exact millisecond timestamp from bar and beat (1-indexed for musicianship)
const t = (bar: number, beat: number, fraction: number = 0): number => {
  return Math.round((bar - 1) * BAR_MS + (beat - 1 + fraction) * BEAT_MS);
};

/**
 * Multi-section Rhythm Heaven Chart:
 * 1. Intro & Calibration (Bars 1-4)
 * 2. Groove A: Steady Steeping (Bars 5-12)
 * 3. Syncopation Section: Bubble Cascade (Bars 13-20)
 * 4. Build-up to Drop (Bars 21-28)
 * 5. Main Drop: Tea Ceremony Climax (Bars 29-44)
 * 6. Zen Pause / Breakdown (Bars 45-52) - Mindful breathing pause
 * 7. Grand Finale (Bars 53-76)
 * 8. Outro (Bars 77-86)
 */
export const ZEN_CHART_EVENTS: ChartEvent[] = [
  // --- SECTION 1: INTRO TEACHING (Bars 1 - 4) ---
  // Bar 2: First cue-and-pour pattern ("1, 2, 3... POUR!")
  { id: 'n_b2_4', timeMs: t(2, 4), type: 'tap', status: 'pending' },

  // Bar 3: Steady pour on beat 4
  { id: 'n_b3_4', timeMs: t(3, 4), type: 'tap', status: 'pending' },

  // Bar 4: Double pour anticipation before the drop
  { id: 'n_b4_3', timeMs: t(4, 3), type: 'tap', status: 'pending' },
  { id: 'n_b4_4', timeMs: t(4, 4), type: 'tap', status: 'pending' },

  // --- SECTION 2: GROOVE A (Bars 5 - 12) ~ 0:07 - 0:22 ---
  // Kick & Snare downbeats with tea pour accents
  { id: 'n_b5_1', timeMs: t(5, 1), type: 'tap', status: 'pending' },
  { id: 'n_b5_3', timeMs: t(5, 3), type: 'tap', status: 'pending' },
  { id: 'n_b6_2', timeMs: t(6, 2), type: 'tap', status: 'pending' },
  { id: 'n_b6_4', timeMs: t(6, 4), type: 'tap', status: 'pending' },

  // Syncopation: 8th-note offbeats
  { id: 'n_b7_1', timeMs: t(7, 1), type: 'tap', status: 'pending' },
  { id: 'n_b7_2_half', timeMs: t(7, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b7_4', timeMs: t(7, 4), type: 'tap', status: 'pending' },

  { id: 'n_b8_2', timeMs: t(8, 2), type: 'tap', status: 'pending' },
  { id: 'n_b8_3', timeMs: t(8, 3), type: 'tap', status: 'pending' },
  { id: 'n_b8_4', timeMs: t(8, 4), type: 'tap', status: 'pending' },

  // Bars 9 - 12: Groove acceleration
  { id: 'n_b9_1', timeMs: t(9, 1), type: 'tap', status: 'pending' },
  { id: 'n_b9_3', timeMs: t(9, 3), type: 'tap', status: 'pending' },
  { id: 'n_b10_2', timeMs: t(10, 2), type: 'tap', status: 'pending' },
  { id: 'n_b10_4', timeMs: t(10, 4), type: 'tap', status: 'pending' },
  { id: 'n_b11_1', timeMs: t(11, 1), type: 'tap', status: 'pending' },
  { id: 'n_b11_2_half', timeMs: t(11, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b11_3_half', timeMs: t(11, 3, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b12_4', timeMs: t(12, 4), type: 'tap', status: 'pending' },

  // --- SECTION 3: SYNCOPATED WATER CASCADE (Bars 13 - 20) ~ 0:22 - 0:37 ---
  { id: 'n_b13_2', timeMs: t(13, 2), type: 'tap', status: 'pending' },
  { id: 'n_b13_3', timeMs: t(13, 3), type: 'tap', status: 'pending' },
  { id: 'n_b14_1', timeMs: t(14, 1), type: 'tap', status: 'pending' },
  { id: 'n_b14_2_half', timeMs: t(14, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b14_4', timeMs: t(14, 4), type: 'tap', status: 'pending' },

  { id: 'n_b15_2', timeMs: t(15, 2), type: 'tap', status: 'pending' },
  { id: 'n_b15_4', timeMs: t(15, 4), type: 'tap', status: 'pending' },
  { id: 'n_b16_1', timeMs: t(16, 1), type: 'tap', status: 'pending' },
  { id: 'n_b16_2', timeMs: t(16, 2), type: 'tap', status: 'pending' },
  { id: 'n_b16_3', timeMs: t(16, 3), type: 'tap', status: 'pending' },
  { id: 'n_b16_4', timeMs: t(16, 4), type: 'tap', status: 'pending' },

  { id: 'n_b17_2', timeMs: t(17, 2), type: 'tap', status: 'pending' },
  { id: 'n_b17_3_half', timeMs: t(17, 3, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b18_1', timeMs: t(18, 1), type: 'tap', status: 'pending' },
  { id: 'n_b18_3', timeMs: t(18, 3), type: 'tap', status: 'pending' },
  { id: 'n_b19_2', timeMs: t(19, 2), type: 'tap', status: 'pending' },
  { id: 'n_b19_4', timeMs: t(19, 4), type: 'tap', status: 'pending' },
  { id: 'n_b20_3', timeMs: t(20, 3), type: 'tap', status: 'pending' },
  { id: 'n_b20_4', timeMs: t(20, 4), type: 'tap', status: 'pending' },

  // --- SECTION 4: BUILD-UP & SNARE ROLLS (Bars 21 - 28) ~ 0:38 - 0:52 ---
  { id: 'n_b21_1', timeMs: t(21, 1), type: 'tap', status: 'pending' },
  { id: 'n_b22_1', timeMs: t(22, 1), type: 'tap', status: 'pending' },
  { id: 'n_b23_1', timeMs: t(23, 1), type: 'tap', status: 'pending' },
  { id: 'n_b23_3', timeMs: t(23, 3), type: 'tap', status: 'pending' },
  { id: 'n_b24_1', timeMs: t(24, 1), type: 'tap', status: 'pending' },
  { id: 'n_b24_2', timeMs: t(24, 2), type: 'tap', status: 'pending' },
  { id: 'n_b24_3', timeMs: t(24, 3), type: 'tap', status: 'pending' },
  { id: 'n_b24_4', timeMs: t(24, 4), type: 'tap', status: 'pending' },

  // Rising intensity
  { id: 'n_b25_2', timeMs: t(25, 2), type: 'tap', status: 'pending' },
  { id: 'n_b25_4', timeMs: t(25, 4), type: 'tap', status: 'pending' },
  { id: 'n_b26_2', timeMs: t(26, 2), type: 'tap', status: 'pending' },
  { id: 'n_b26_4', timeMs: t(26, 4), type: 'tap', status: 'pending' },
  { id: 'n_b27_1', timeMs: t(27, 1), type: 'tap', status: 'pending' },
  { id: 'n_b27_2', timeMs: t(27, 2), type: 'tap', status: 'pending' },
  { id: 'n_b27_3', timeMs: t(27, 3), type: 'tap', status: 'pending' },
  { id: 'n_b27_4', timeMs: t(27, 4), type: 'tap', status: 'pending' },
  // Roll fill before drop
  { id: 'n_b28_2', timeMs: t(28, 2), type: 'tap', status: 'pending' },
  { id: 'n_b28_3', timeMs: t(28, 3), type: 'tap', status: 'pending' },
  { id: 'n_b28_3_half', timeMs: t(28, 3, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b28_4', timeMs: t(28, 4), type: 'tap', status: 'pending' },

  // --- SECTION 5: MAIN DROP (Bars 29 - 44) ~ 0:53 - 1:21 ---
  // High-energy Rhythm Heaven multi-beat pour frenzy
  { id: 'n_b29_1_drop', timeMs: t(29, 1), type: 'tap', status: 'pending' },
  { id: 'n_b29_2', timeMs: t(29, 2), type: 'tap', status: 'pending' },
  { id: 'n_b29_3', timeMs: t(29, 3), type: 'tap', status: 'pending' },
  { id: 'n_b29_4', timeMs: t(29, 4), type: 'tap', status: 'pending' },

  { id: 'n_b30_1', timeMs: t(30, 1), type: 'tap', status: 'pending' },
  { id: 'n_b30_2_half', timeMs: t(30, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b30_4', timeMs: t(30, 4), type: 'tap', status: 'pending' },

  { id: 'n_b31_2', timeMs: t(31, 2), type: 'tap', status: 'pending' },
  { id: 'n_b31_3', timeMs: t(31, 3), type: 'tap', status: 'pending' },
  { id: 'n_b31_4', timeMs: t(31, 4), type: 'tap', status: 'pending' },

  { id: 'n_b32_1', timeMs: t(32, 1), type: 'tap', status: 'pending' },
  { id: 'n_b32_3', timeMs: t(32, 3), type: 'tap', status: 'pending' },
  { id: 'n_b32_4', timeMs: t(32, 4), type: 'tap', status: 'pending' },

  { id: 'n_b33_1', timeMs: t(33, 1), type: 'tap', status: 'pending' },
  { id: 'n_b33_2', timeMs: t(33, 2), type: 'tap', status: 'pending' },
  { id: 'n_b33_3', timeMs: t(33, 3), type: 'tap', status: 'pending' },
  { id: 'n_b33_4', timeMs: t(33, 4), type: 'tap', status: 'pending' },

  { id: 'n_b34_2', timeMs: t(34, 2), type: 'tap', status: 'pending' },
  { id: 'n_b34_4', timeMs: t(34, 4), type: 'tap', status: 'pending' },
  { id: 'n_b35_1', timeMs: t(35, 1), type: 'tap', status: 'pending' },
  { id: 'n_b35_2_half', timeMs: t(35, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b35_4', timeMs: t(35, 4), type: 'tap', status: 'pending' },

  { id: 'n_b36_2', timeMs: t(36, 2), type: 'tap', status: 'pending' },
  { id: 'n_b36_3', timeMs: t(36, 3), type: 'tap', status: 'pending' },
  { id: 'n_b36_4', timeMs: t(36, 4), type: 'tap', status: 'pending' },

  // --- SECTION 5 CONTINUED: CLIMAX SURGE (Bars 37 - 44) ~ 1:06 - 1:21 ---
  { id: 'n_b37_1', timeMs: t(37, 1), type: 'tap', status: 'pending' },
  { id: 'n_b37_3', timeMs: t(37, 3), type: 'tap', status: 'pending' },
  { id: 'n_b37_4', timeMs: t(37, 4), type: 'tap', status: 'pending' },

  { id: 'n_b38_2', timeMs: t(38, 2), type: 'tap', status: 'pending' },
  { id: 'n_b38_3_half', timeMs: t(38, 3, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b38_4', timeMs: t(38, 4), type: 'tap', status: 'pending' },

  { id: 'n_b39_1', timeMs: t(39, 1), type: 'tap', status: 'pending' },
  { id: 'n_b39_2', timeMs: t(39, 2), type: 'tap', status: 'pending' },
  { id: 'n_b39_3', timeMs: t(39, 3), type: 'tap', status: 'pending' },
  { id: 'n_b39_4', timeMs: t(39, 4), type: 'tap', status: 'pending' },

  { id: 'n_b40_2', timeMs: t(40, 2), type: 'tap', status: 'pending' },
  { id: 'n_b40_4', timeMs: t(40, 4), type: 'tap', status: 'pending' },

  { id: 'n_b41_1', timeMs: t(41, 1), type: 'tap', status: 'pending' },
  { id: 'n_b41_2_half', timeMs: t(41, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b41_3', timeMs: t(41, 3), type: 'tap', status: 'pending' },
  { id: 'n_b41_4', timeMs: t(41, 4), type: 'tap', status: 'pending' },

  { id: 'n_b42_2', timeMs: t(42, 2), type: 'tap', status: 'pending' },
  { id: 'n_b42_3', timeMs: t(42, 3), type: 'tap', status: 'pending' },
  { id: 'n_b42_4', timeMs: t(42, 4), type: 'tap', status: 'pending' },

  { id: 'n_b43_1', timeMs: t(43, 1), type: 'tap', status: 'pending' },
  { id: 'n_b43_2', timeMs: t(43, 2), type: 'tap', status: 'pending' },
  { id: 'n_b43_3', timeMs: t(43, 3), type: 'tap', status: 'pending' },
  { id: 'n_b43_4', timeMs: t(43, 4), type: 'tap', status: 'pending' },

  { id: 'n_b44_1', timeMs: t(44, 1), type: 'tap', status: 'pending' },
  { id: 'n_b44_2', timeMs: t(44, 2), type: 'tap', status: 'pending' },
  { id: 'n_b44_3', timeMs: t(44, 3), type: 'tap', status: 'pending' },

  // --- SECTION 6: ZEN TEA BREAKDOWN (Bars 45 - 52) ~ 1:21 - 1:36 ---
  // Mindful rhythmic pours synced to the Koto arpeggio and bamboo beat pulse
  { id: 'n_b45_1', timeMs: t(45, 1), type: 'tap', status: 'pending' },
  { id: 'n_b45_3', timeMs: t(45, 3), type: 'tap', status: 'pending' },

  { id: 'n_b46_2', timeMs: t(46, 2), type: 'tap', status: 'pending' },
  { id: 'n_b46_4', timeMs: t(46, 4), type: 'tap', status: 'pending' },

  { id: 'n_b47_1', timeMs: t(47, 1), type: 'tap', status: 'pending' },
  { id: 'n_b47_3', timeMs: t(47, 3), type: 'tap', status: 'pending' },

  { id: 'n_b48_2', timeMs: t(48, 2), type: 'tap', status: 'pending' },
  { id: 'n_b48_4', timeMs: t(48, 4), type: 'tap', status: 'pending' },

  { id: 'n_b49_1', timeMs: t(49, 1), type: 'tap', status: 'pending' },
  { id: 'n_b49_3', timeMs: t(49, 3), type: 'tap', status: 'pending' },

  { id: 'n_b50_2', timeMs: t(50, 2), type: 'tap', status: 'pending' },
  { id: 'n_b50_4', timeMs: t(50, 4), type: 'tap', status: 'pending' },

  { id: 'n_b51_1', timeMs: t(51, 1), type: 'tap', status: 'pending' },
  { id: 'n_b51_3', timeMs: t(51, 3), type: 'tap', status: 'pending' },
  { id: 'n_b51_4', timeMs: t(51, 4), type: 'tap', status: 'pending' },

  { id: 'n_b52_2', timeMs: t(52, 2), type: 'tap', status: 'pending' },
  { id: 'n_b52_3', timeMs: t(52, 3), type: 'tap', status: 'pending' },
  { id: 'n_b52_4', timeMs: t(52, 4), type: 'tap', status: 'pending' },

  // --- SECTION 7: GRAND CLIMAX & MASTER INFUSION (Bars 53 - 76) ~ 1:36 - 2:20 ---
  { id: 'n_b53_1_climax', timeMs: t(53, 1), type: 'tap', status: 'pending' },
  { id: 'n_b53_3', timeMs: t(53, 3), type: 'tap', status: 'pending' },
  { id: 'n_b54_2', timeMs: t(54, 2), type: 'tap', status: 'pending' },
  { id: 'n_b54_4', timeMs: t(54, 4), type: 'tap', status: 'pending' },

  { id: 'n_b55_1', timeMs: t(55, 1), type: 'tap', status: 'pending' },
  { id: 'n_b55_2_half', timeMs: t(55, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b55_4', timeMs: t(55, 4), type: 'tap', status: 'pending' },

  { id: 'n_b56_2', timeMs: t(56, 2), type: 'tap', status: 'pending' },
  { id: 'n_b56_3', timeMs: t(56, 3), type: 'tap', status: 'pending' },
  { id: 'n_b56_4', timeMs: t(56, 4), type: 'tap', status: 'pending' },

  { id: 'n_b57_1', timeMs: t(57, 1), type: 'tap', status: 'pending' },
  { id: 'n_b57_2', timeMs: t(57, 2), type: 'tap', status: 'pending' },
  { id: 'n_b57_3', timeMs: t(57, 3), type: 'tap', status: 'pending' },
  { id: 'n_b57_4', timeMs: t(57, 4), type: 'tap', status: 'pending' },

  { id: 'n_b58_2', timeMs: t(58, 2), type: 'tap', status: 'pending' },
  { id: 'n_b58_4', timeMs: t(58, 4), type: 'tap', status: 'pending' },

  { id: 'n_b59_1', timeMs: t(59, 1), type: 'tap', status: 'pending' },
  { id: 'n_b59_2_half', timeMs: t(59, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b59_3', timeMs: t(59, 3), type: 'tap', status: 'pending' },
  { id: 'n_b59_4', timeMs: t(59, 4), type: 'tap', status: 'pending' },

  { id: 'n_b60_2', timeMs: t(60, 2), type: 'tap', status: 'pending' },
  { id: 'n_b60_3', timeMs: t(60, 3), type: 'tap', status: 'pending' },
  { id: 'n_b60_4', timeMs: t(60, 4), type: 'tap', status: 'pending' },

  { id: 'n_b61_1', timeMs: t(61, 1), type: 'tap', status: 'pending' },
  { id: 'n_b61_3', timeMs: t(61, 3), type: 'tap', status: 'pending' },
  { id: 'n_b61_4', timeMs: t(61, 4), type: 'tap', status: 'pending' },

  { id: 'n_b62_1', timeMs: t(62, 1), type: 'tap', status: 'pending' },
  { id: 'n_b62_2', timeMs: t(62, 2), type: 'tap', status: 'pending' },
  { id: 'n_b62_3', timeMs: t(62, 3), type: 'tap', status: 'pending' },
  { id: 'n_b62_4', timeMs: t(62, 4), type: 'tap', status: 'pending' },

  { id: 'n_b63_2', timeMs: t(63, 2), type: 'tap', status: 'pending' },
  { id: 'n_b63_4', timeMs: t(63, 4), type: 'tap', status: 'pending' },

  { id: 'n_b64_1', timeMs: t(64, 1), type: 'tap', status: 'pending' },
  { id: 'n_b64_2_half', timeMs: t(64, 2, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b64_4', timeMs: t(64, 4), type: 'tap', status: 'pending' },

  { id: 'n_b65_1', timeMs: t(65, 1), type: 'tap', status: 'pending' },
  { id: 'n_b65_2', timeMs: t(65, 2), type: 'tap', status: 'pending' },
  { id: 'n_b65_3', timeMs: t(65, 3), type: 'tap', status: 'pending' },
  { id: 'n_b65_4', timeMs: t(65, 4), type: 'tap', status: 'pending' },

  { id: 'n_b66_2', timeMs: t(66, 2), type: 'tap', status: 'pending' },
  { id: 'n_b66_4', timeMs: t(66, 4), type: 'tap', status: 'pending' },

  { id: 'n_b67_1', timeMs: t(67, 1), type: 'tap', status: 'pending' },
  { id: 'n_b67_3', timeMs: t(67, 3), type: 'tap', status: 'pending' },
  { id: 'n_b67_4', timeMs: t(67, 4), type: 'tap', status: 'pending' },

  { id: 'n_b68_2', timeMs: t(68, 2), type: 'tap', status: 'pending' },
  { id: 'n_b68_3_half', timeMs: t(68, 3, 0.5), type: 'tap', status: 'pending' },
  { id: 'n_b68_4', timeMs: t(68, 4), type: 'tap', status: 'pending' },

  { id: 'n_b69_1', timeMs: t(69, 1), type: 'tap', status: 'pending' },
  { id: 'n_b69_2', timeMs: t(69, 2), type: 'tap', status: 'pending' },
  { id: 'n_b69_3', timeMs: t(69, 3), type: 'tap', status: 'pending' },
  { id: 'n_b69_4', timeMs: t(69, 4), type: 'tap', status: 'pending' },

  { id: 'n_b70_2', timeMs: t(70, 2), type: 'tap', status: 'pending' },
  { id: 'n_b70_4', timeMs: t(70, 4), type: 'tap', status: 'pending' },

  { id: 'n_b71_1', timeMs: t(71, 1), type: 'tap', status: 'pending' },
  { id: 'n_b71_3', timeMs: t(71, 3), type: 'tap', status: 'pending' },

  { id: 'n_b72_2', timeMs: t(72, 2), type: 'tap', status: 'pending' },
  { id: 'n_b72_4', timeMs: t(72, 4), type: 'tap', status: 'pending' },

  { id: 'n_b73_1', timeMs: t(73, 1), type: 'tap', status: 'pending' },
  { id: 'n_b73_2', timeMs: t(73, 2), type: 'tap', status: 'pending' },
  { id: 'n_b73_3', timeMs: t(73, 3), type: 'tap', status: 'pending' },
  { id: 'n_b73_4', timeMs: t(73, 4), type: 'tap', status: 'pending' },

  { id: 'n_b74_2', timeMs: t(74, 2), type: 'tap', status: 'pending' },
  { id: 'n_b74_3', timeMs: t(74, 3), type: 'tap', status: 'pending' },
  { id: 'n_b74_4', timeMs: t(74, 4), type: 'tap', status: 'pending' },

  { id: 'n_b75_1', timeMs: t(75, 1), type: 'tap', status: 'pending' },
  { id: 'n_b75_2', timeMs: t(75, 2), type: 'tap', status: 'pending' },
  { id: 'n_b75_3', timeMs: t(75, 3), type: 'tap', status: 'pending' },
  { id: 'n_b75_4', timeMs: t(75, 4), type: 'tap', status: 'pending' },

  { id: 'n_b76_1', timeMs: t(76, 1), type: 'tap', status: 'pending' },
  { id: 'n_b76_2', timeMs: t(76, 2), type: 'tap', status: 'pending' },
  { id: 'n_b76_3', timeMs: t(76, 3), type: 'tap', status: 'pending' },
  { id: 'n_b76_4', timeMs: t(76, 4), type: 'tap', status: 'pending' },

  // --- SECTION 8: OUTRO (Bars 77 - 84) ~ 2:21 - 2:38 ---
  { id: 'n_b77_1', timeMs: t(77, 1), type: 'tap', status: 'pending' },
  { id: 'n_b77_3', timeMs: t(77, 3), type: 'tap', status: 'pending' },

  { id: 'n_b78_2', timeMs: t(78, 2), type: 'tap', status: 'pending' },
  { id: 'n_b78_4', timeMs: t(78, 4), type: 'tap', status: 'pending' },

  { id: 'n_b79_1', timeMs: t(79, 1), type: 'tap', status: 'pending' },
  { id: 'n_b79_3', timeMs: t(79, 3), type: 'tap', status: 'pending' },

  { id: 'n_b80_2', timeMs: t(80, 2), type: 'tap', status: 'pending' },
  { id: 'n_b80_4', timeMs: t(80, 4), type: 'tap', status: 'pending' },

  { id: 'n_b81_1', timeMs: t(81, 1), type: 'tap', status: 'pending' },
  { id: 'n_b81_3', timeMs: t(81, 3), type: 'tap', status: 'pending' },

  { id: 'n_b82_2', timeMs: t(82, 2), type: 'tap', status: 'pending' },
  { id: 'n_b82_4', timeMs: t(82, 4), type: 'tap', status: 'pending' },

  { id: 'n_b83_1', timeMs: t(83, 1), type: 'tap', status: 'pending' },
  { id: 'n_b83_4', timeMs: t(83, 4), type: 'tap', status: 'pending' },

  // The Grand Finale Golden Drop on final resolution chord
  { id: 'n_b84_finale_golden', timeMs: t(84, 1), type: 'tap', status: 'pending' },
];

export function getFreshChartEvents(): ChartEvent[] {
  return ZEN_CHART_EVENTS.map((event) => ({
    ...event,
    status: 'pending',
    rating: undefined,
    hitDeltaMs: undefined,
  }));
}
