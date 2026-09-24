# Zen Tea Ceremony — Rhythm Engine

Rhythm Heaven-style rhythm game (React + Pixi.js v8 + Web Audio API) for
Telegram Mini Apps and mobile browsers. Production track: “Rhodes &
Rimshot Groove”, 90 BPM, authored beatmap in `src/data/zenChart.ts`.

## Scripts

```bash
npm ci
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest
npm run build       # normal build (base /)
GITHUB_PAGES=true npm run build   # project pages (base /musicteaceremony/)
```

Live: https://llayon.github.io/musicteaceremony/

## Timing model

`AudioContext.currentTime` is the authoritative gameplay clock. Visuals,
progress, miss detection and input judgment derive from it (see
`src/engine/TimingClock.ts`). Judgment windows: PERFECT ±50 ms,
GOOD ±100 ms, candidate search ±120 ms.

## iOS Safari audio unlock (verified on iPhone 11 Pro Max)

Audio unlock **must originate from a trusted button `click`**. A Start
path driven by `pointerdown` left `AudioContext.resume()` pending forever
on the tested iPhone — while MP3, decode and phone performance were all
fine. Rules locked by `src/components/__tests__/startGesture.guard.test.ts`:

- Start/restart buttons use `onClick` only, never `onPointerDown`;
- the wrapper `pointerdown` handler starts nothing while IDLE/FINISHED;
- one tap issues at most one native `resume()` (single-flight in
  `AudioEngine.gestureUnlock()` + a silent 1-sample unlock probe).

One-tap startup on iPhone 11 Pro Max / Safari: PASS.

## Startup diagnostics

Settings → “Диагностика запуска”: engine phase
(`idle/unlocking/fetching/decoding-stereo/decoding-light/starting/ready/error`)
plus a timestamped log (context/resume/decode/track events). One slow-device
run of this list identifies the hanging stage.
