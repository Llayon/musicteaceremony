# Default song asset — "Rhodes & Rimshot Groove" (production music)

Gauntlet 0 production start path loads a **pre-rendered audio file
asynchronously** — it never synthesizes minutes of PCM synchronously when
the player taps Start.

## Committed files

```
public/audio/zen-tea-ceremony.mp3         stereo 160 kbps, 3 181 584 bytes
public/audio/zen-tea-ceremony.light.mp3   mono 128 kbps, 2 545 296 bytes
```

Both decode to 159.018667 s. The light mix is a mono fold-down kept as a
decode fallback (~30 MB PCM instead of ~61 MB); the engine tries stereo
first and falls back automatically, badging it as `default song (light mix)`.

Served at runtime as `<base>/audio/zen-tea-ceremony.mp3` (see
`src/engine/defaultTrack.ts` → `DEFAULT_TRACK_URL`, which resolves through
`import.meta.env.BASE_URL` so local builds use `/` and GitHub Project Pages
use `/musicteaceremony/`).

## Verified spec (measured, not assumed)

- Content: Rhodes & Rimshot Groove master (drums + bass + other; the
  supplied vocals stem is digitally silent and is excluded)
- Format: MP3, stereo, 48 kHz, 160 kbps CBR, 3 181 584 bytes
  (transcoded from the supplied 192 kbps master via
  `ffmpeg -codec:a libmp3lame -b:a 160k`; duration bit-identical)
- Duration: 159.018667 s (`songLengthMs: 159019`)
- Tempo: 90 BPM, 4/4, constant end-to-end (drift ≈ −0.12 ms/s)
- Grid: beat k at 40 + k × 666.666… ms; groove bar 1 = 10 040 ms

No heavy mastering, compression, EQ, tempo stretching, or remixing was
applied — the supplied mix is committed as-is.

## To replace the track

1. Render/export the new mix to MP3.
2. Overwrite `public/audio/zen-tea-ceremony.mp3`.
3. Re-verify tempo/phase (see analysis notes in `src/data/zenChart.ts`)
   and re-author the chart — timestamps are compiled from the 90 BPM grid.
4. `npm run build` — Vite copies `public/` to `dist/` verbatim.

## Fallbacks (explicit, never silent)

- If the fetch fails (asset absent, e.g. fresh clone/CI), the engine uses
  `AudioEngine.generateDevGuideLoop()` — a tiny (~3.7 s) looped metronome
  so gameplay stays fast and testable. The HUD badges this as
  `dev guide loop (asset missing — see public/audio/README)`.
- `src/dev/generateZenSoundtrack.ts` is retained **dev-only** (not imported
  by production code) for sound-design iteration and short previews. It
  warns for durations over 30 s and must not be called on the Start path.
- Custom user uploads (MP3/WAV via the settings modal) genuinely become
  the active gameplay track through `setCustomTrackFromBytes()`. Chart
  compatibility limit: the chart stays fixed to the 90 BPM production
  groove — no BPM detection or auto-beatmap is performed.
