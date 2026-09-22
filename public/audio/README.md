# Default song asset (required for production gameplay)

Gauntlet 0 production start path loads a **pre-rendered audio file
asynchronously** — it never synthesizes minutes of PCM synchronously when
the player taps Start.

## Required file

```
public/audio/zen-tea-ceremony.mp3
```

Served at runtime as `/audio/zen-tea-ceremony.mp3` (see
`src/engine/defaultTrack.ts` → `DEFAULT_TRACK_URL`).

## Spec

- Format: MP3 (or WAV/OGG the target browsers can decode), stereo
- Sample rate: 44.1 kHz or 48 kHz
- Tempo: 130 BPM, 4/4
- Length: ~160 s to match `ZEN_CHART_METADATA.songLengthMs` (160000)
- Content: the 4-part Zen mix the chart was authored against
  (or any 130 BPM track if the chart is re-authored later)

## How to provide it

1. Render/export the 130 BPM mix to MP3.
2. Place it at `public/audio/zen-tea-ceremony.mp3`.
3. `npm run build` — Vite copies `public/` to `dist/` verbatim.

## Fallbacks (explicit, never silent)

- If the fetch fails (asset absent, e.g. fresh clone/CI), the engine uses
  `AudioEngine.generateDevGuideLoop()` — a tiny (~3.7 s) looped metronome
  so gameplay stays fast and testable. The HUD badges this as
  `dev guide loop (asset missing — see public/audio/README)`.
- `AudioEngine.generateZenSoundtrack()` is retained **dev-only** for
  sound-design iteration and short previews. It warns for durations over
  30 s and must not be called on the Start path.
- Custom user uploads (MP3/WAV via the settings modal) genuinely become
  the active gameplay track through `setCustomTrackFromBytes()`. Chart
  compatibility limit: the chart stays fixed 130 BPM — no BPM detection
  or auto-beatmap is performed.
