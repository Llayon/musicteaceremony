import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, RotateCcw, Play, Award, Zap, Sliders, Music, Sparkles } from 'lucide-react';
import { AudioEngine } from '../engine/AudioEngine';
import { InputJudge, JudgeResult } from '../engine/InputJudge';
import { VisualEngine } from '../engine/VisualEngine';
import { TIMING_WINDOWS } from '../engine/timing';
import { ChartEvent, GameScore } from '../types';
import { ZEN_CHART_METADATA, getFreshChartEvents, getLastEventTimeMs } from '../data/zenChart';
import { perfMark } from '../engine/perf';
import { TMAService } from '../services/tma';

type GameState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'FINISHED';

export const RhythmGame: React.FC = () => {
  const pixiContainerRef = useRef<HTMLDivElement>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const visualEngineRef = useRef<VisualEngine | null>(null);
  const inputJudgeRef = useRef<InputJudge | null>(null);

  const [gameState, setGameState] = useState<GameState>('IDLE');
  const [chartEvents, setChartEvents] = useState<ChartEvent[]>([]);
  const [score, setScore] = useState<GameScore>({
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfectCount: 0,
    goodCount: 0,
    missCount: 0,
    accuracy: 100,
    zenLevel: 50,
    rank: 'ZEN_MASTER',
  });

  const [lastDelta, setLastDelta] = useState<{ delta: number; rating: string } | null>(null);
  // Input calibration (ms). Judgment-only: positive makes a tap count as
  // earlier (Bluetooth/output-delay compensation). Never shifts visuals,
  // audio scheduling, or auto-miss timing. Default 0.
  const [userOffsetMs, setUserOffsetMs] = useState<number>(0);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isTmaActive, setIsTmaActive] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  // Custom-upload progress (reading a big phone file + mobile decode can
  // take tens of seconds with zero feedback otherwise).
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  // Song progress bypasses React state: written straight to the DOM node
  // every frame so PLAYING re-renders only on game events (taps/misses).
  // Pixi stays the sole 60 FPS renderer.
  const progressFillRef = useRef<HTMLDivElement>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [activeTrackLabel, setActiveTrackLabel] = useState<string>('default song');

  // Dedicated SFX / Rhythm Cues Volume (0 to 1.5)
  const [sfxVolume, setSfxVolume] = useState<number>(1.2);

  const handleSfxVolumeChange = (val: number) => {
    setSfxVolume(val);
    if (audioEngineRef.current) {
      audioEngineRef.current.setSfxVolume(val);
    }
  };

  const handleOffsetChange = (val: number) => {
    setUserOffsetMs(val);
    if (audioEngineRef.current) {
      // Input-only calibration — visuals/progress keep raw audio time.
      audioEngineRef.current.setOffsetMs(val);
    }
  };

  const animationFrameId = useRef<number | null>(null);
  const eventsRef = useRef<ChartEvent[]>([]);
  eventsRef.current = chartEvents;
  const gameStateRef = useRef<GameState>('IDLE');
  gameStateRef.current = gameState;

  const cancelGameLoop = useCallback(() => {
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
  }, []);

  /** Effective round length: real buffer duration, but gameplay ends with a
   * short ring-out tail after the final note (the Rhodes outro keeps playing
   * only briefly under the results — no 15 s dead wait, no hard cut). */
  const getEffectiveDurationMs = useCallback((): number => {
    const audio = audioEngineRef.current;
    if (audio && !audio.isTrackLooped()) {
      const bufMs = audio.getTrackDurationMs();
      const lastNoteMs = getLastEventTimeMs(eventsRef.current);
      const musicEndMs =
        Number.isFinite(bufMs) && bufMs > 0 ? bufMs : ZEN_CHART_METADATA.songLengthMs;
      if (lastNoteMs > 0) {
        return Math.min(musicEndMs, lastNoteMs + 3000);
      }
      return musicEndMs;
    }
    return ZEN_CHART_METADATA.songLengthMs;
  }, []);

  const finishRound = useCallback(() => {
    cancelGameLoop();
    const audio = audioEngineRef.current;
    if (audio && audio.getIsPlaying()) {
      audio.stopTrack();
    }
    if (gameStateRef.current === 'PLAYING') {
      setGameState('FINISHED');
      TMAService.hapticNotification('success');
    }
  }, [cancelGameLoop]);

  // Initialize Engines & Telegram WebApp (StrictMode-safe: full cleanup).
  useEffect(() => {
    let cancelled = false;
    perfMark('app-mounted');

    const tmaDetected = TMAService.init();
    setIsTmaActive(tmaDetected);

    const audio = new AudioEngine();
    audioEngineRef.current = audio;

    // Stage-1 preload: fetch song bytes while the user reads the start
    // screen. No AudioContext here (autoplay-safe). Failures are silent —
    // Start falls back to the badged dev guide loop.
    audio.preloadDefaultTrackBytes().catch(() => {
      // Intentionally silent: loading state is resolved at Start time.
    });

    const visual = new VisualEngine(audio);
    visualEngineRef.current = visual;

    const judge = new InputJudge();
    inputJudgeRef.current = judge;

    if (pixiContainerRef.current) {
      visual.init(pixiContainerRef.current).then(() => {
        if (!cancelled) {
          visual.setBpm(ZEN_CHART_METADATA.bpm);
          visual.setApproachBeats(ZEN_CHART_METADATA.approachBeats);
          visual.setFirstBeatOffsetMs(ZEN_CHART_METADATA.firstBeatOffsetMs);
          perfMark('pixi-ready');
        }
      }).catch((err) => {
        console.error('[VisualEngine] Initialization error:', err);
      });
    }

    setChartEvents(getFreshChartEvents());

    return () => {
      cancelled = true;
      cancelGameLoop();
      audio.dispose();
      visual.destroy();
      audioEngineRef.current = null;
      visualEngineRef.current = null;
      inputJudgeRef.current = null;
    };
  }, [cancelGameLoop]);

  // Main Game Loop for Miss Detection & Round Completion (single RAF owner).
  // Reads raw audio-clock song time; lookahead timers only prepare cues.
  const runGameLoop = useCallback(() => {
    const audio = audioEngineRef.current;
    const judge = inputJudgeRef.current;
    const visual = visualEngineRef.current;

    if (!audio || !judge || !visual) return;

    if (audio.getIsPlaying()) {
      const songTimeMs = audio.getExactSongTime();

      // Update progress bar against the effective (real-buffer) duration.
      // Direct DOM write (no React state): zero re-renders from the loop.
      const durationMs = getEffectiveDurationMs();
      const progress = durationMs > 0 ? Math.min(1, songTimeMs / durationMs) : 0;
      if (progressFillRef.current) {
        progressFillRef.current.style.transform = `scaleX(${progress})`;
      }

      // Check for missed notes (raw audio time — calibration never shifts this).
      const misses: JudgeResult[] = judge.checkMissedNotes(songTimeMs, eventsRef.current);
      if (misses.length > 0) {
        misses.forEach(() => {
          visual.triggerHitFeedback('MISS', songTimeMs);
          audio.playMissSound();
          setLastDelta({ delta: 99, rating: 'MISS' });
        });
        setScore(judge.getScore());
        setChartEvents([...eventsRef.current]);
      }

      // Check if song has finished (buffer truth, not a hardcoded constant).
      if (songTimeMs >= durationMs) {
        finishRound();
        return;
      }
    } else if (gameStateRef.current === 'PLAYING') {
      // Track stopped naturally (onended) without reaching the duration
      // guard — e.g. a short custom track. Finish honestly.
      finishRound();
      return;
    }

    animationFrameId.current = requestAnimationFrame(runGameLoop);
  }, [finishRound, getEffectiveDurationMs]);

  // Start / Restart round (async audio path — never blocks on Start).
  const startRound = async () => {
    const audio = audioEngineRef.current;
    const judge = inputJudgeRef.current;
    const visual = visualEngineRef.current;
    if (!audio || !judge || !visual || isLoadingAudio) return;

    perfMark('start-click');
    cancelGameLoop();
    setIsLoadingAudio(true);
    setAudioError(null);

    try {
      // First user gesture triggers audio context resume
      await audio.resumeContext();

      const freshEvents = getFreshChartEvents();
      setChartEvents(freshEvents);
      visual.setBpm(ZEN_CHART_METADATA.bpm);
      visual.setApproachBeats(ZEN_CHART_METADATA.approachBeats);
      visual.setFirstBeatOffsetMs(ZEN_CHART_METADATA.firstBeatOffsetMs);
      visual.setChartEvents(freshEvents);
      visual.resetScene();

      const initialScore = judge.resetScore();
      setScore(initialScore);
      setLastDelta(null);
      if (progressFillRef.current) {
        progressFillRef.current.style.transform = 'scaleX(0)';
      }

      // Resolve the genuine active track:
      // 1) uploaded custom audio when present, 2) pre-rendered 90 BPM master
      // (async), 3) tiny looped dev guide when the asset is absent.
      // Chart compatibility limit: the chart stays fixed to the 90 BPM
      // production groove — custom audio is NOT re-mapped and there is no
      // BPM detection or auto-beatmap generation.
      let trackBuffer: AudioBuffer | null = audio.getCustomBuffer();
      let loop = false;
      if (trackBuffer) {
        setActiveTrackLabel(`custom: ${audio.getCustomTrackName() ?? 'uploaded track'} (chart stays 90 BPM)`);
      } else {
        try {
          trackBuffer = await audio.loadDefaultTrack();
          setActiveTrackLabel('default song');
        } catch {
          trackBuffer = audio.generateDevGuideLoop(ZEN_CHART_METADATA.bpm);
          loop = true;
          setActiveTrackLabel('dev guide loop (asset missing — see public/audio/README)');
        }
      }

      audio.setSfxVolume(sfxVolume);
      audio.setMuted(isMuted);
      audio.startTrack(trackBuffer, freshEvents, ZEN_CHART_METADATA.bpm, userOffsetMs, {
        loop,
        approachBeats: ZEN_CHART_METADATA.approachBeats,
        onEnded: () => finishRound(),
      });
      perfMark('track-start');
      setGameState('PLAYING');

      cancelGameLoop();
      animationFrameId.current = requestAnimationFrame(runGameLoop);
    } catch (err) {
      console.error('[RhythmGame] Failed to start round:', err);
      setAudioError(err instanceof Error ? err.message : 'Failed to start audio');
    } finally {
      setIsLoadingAudio(false);
    }
  };

  // Primary Gameplay Tap Handler (audio-clock synchronized timing).
  // Uses PointerEvent.timeStamp mapped through TimingClock where feasible,
  // with a safe fallback to the audio clock sampled in the handler.
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();

    if (gameState === 'IDLE' || gameState === 'FINISHED') {
      void startRound();
      return;
    }

    if (gameState !== 'PLAYING') return;

    const audio = audioEngineRef.current;
    const judge = inputJudgeRef.current;
    const visual = visualEngineRef.current;
    if (!audio || !judge || !visual) return;

    const judgmentSongTime = audio.getTimingClock().inputToSongTimeMs(e.timeStamp);
    const result = judge.handlePointerDown(judgmentSongTime, eventsRef.current);

    if (result?.note) {
      // Judgment (score/delta/sound) resolves NOW at tap time; the droplet
      // keeps flying and splash/plate/cup fire at note.timeMs via the
      // engine's deferred impact queue — what the player sees matches the music.
      visual.registerHitImpact(result.note.id, result.rating, result.note.timeMs);
      if (result.rating === 'PERFECT' || result.rating === 'GOOD') {
        audio.playPourSound(result.rating);
      } else {
        audio.playMissSound();
      }

      setLastDelta({
        delta: Math.round(result.deltaMs),
        rating: result.rating,
      });

      setScore(judge.getScore());
      setChartEvents([...eventsRef.current]);
    }
    // Ghost taps (no nearby candidate) are intentionally neutral: no score,
    // combo, haptic, or visual change. See InputJudge docs.
  };

  /**
   * Reads a user-picked file with real progress. `file.arrayBuffer()` gives
   * zero feedback and holds the whole file in RAM at once — on a phone with
   * a tens-of-MB recording that looks like a hang. Streams chunks instead.
   */
  const readFileWithProgress = async (
    file: File,
    onProgress: (fraction: number) => void
  ): Promise<ArrayBuffer> => {
    const stream = (file as File & { stream?: () => ReadableStream<Uint8Array> }).stream;
    if (typeof stream !== 'function' || !file.size) {
      const bytes = await file.arrayBuffer();
      onProgress(1);
      return bytes;
    }
    const reader = stream.call(file).getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress(Math.min(1, received / file.size));
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer as ArrayBuffer;
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const audio = audioEngineRef.current;
    if (!file || !audio || isUploading) return;

    setIsUploading(true);
    setAudioError(null);
    try {
      // Decode directly from bytes (no object URL to leak). The uploaded
      // buffer genuinely becomes the next active gameplay track.
      const sizeMb = file.size / (1024 * 1024);
      if (sizeMb > 25) {
        setUploadStatus(
          `Большой файл (${sizeMb.toFixed(0)} МБ) — чтение и декодирование на телефоне могут занять минуту…`
        );
      } else {
        setUploadStatus('Читаем файл…');
      }
      setUploadProgress(0);
      const bytes = await readFileWithProgress(file, (f) => {
        setUploadProgress(f);
        setUploadStatus(`Читаем файл… ${Math.round(f * 100)}%`);
      });
      // decodeAudioData has no progress API and a multi-minute track can
      // keep a phone CPU busy for 10–60 s — show the stage explicitly.
      setUploadStatus('Декодируем аудио… это самая долгая часть на телефоне');
      setUploadProgress(null);
      await audio.setCustomTrackFromBytes(bytes, file.name);
      const decodedSec = audio.getCustomBuffer()?.duration ?? 0;
      if (decodedSec > 600) {
        setAudioError(
          `Трек очень длинный (${Math.round(decodedSec / 60)} мин) — играть будет, но чарт рассчитан на ~2:39.`
        );
      }
      setUploadStatus('Готово — запускаем…');
      setActiveTrackLabel(`custom: ${file.name} (chart stays 90 BPM)`);
      await startRound();
      setUploadStatus(null);
    } catch (err) {
      console.error('Failed to load custom audio file:', err);
      const msg =
        err instanceof DOMException && err.name === 'EncodingError'
          ? 'Не удалось декодировать файл (возможно, не хватило памяти телефона — попробуйте файл поменьше).'
          : err instanceof Error
            ? err.message
            : 'Failed to decode uploaded audio';
      setAudioError(msg);
      setUploadStatus('Ошибка — попробуйте другой файл');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  const handleClearCustomTrack = () => {
    const audio = audioEngineRef.current;
    if (!audio) return;
    audio.clearCustomTrack();
    setActiveTrackLabel('default song');
  };

  const toggleSound = () => {
    const next = !isMuted;
    setIsMuted(next);
    // Real mute via gain — timing continues uninterrupted.
    if (audioEngineRef.current) {
      audioEngineRef.current.setMuted(next);
    }
  };

  return (
    <div
      id="rhythm-game-wrapper"
      className="relative w-full h-screen max-w-md mx-auto bg-[#181614] text-[#E8E2D5] select-none overflow-hidden flex flex-col justify-between font-sans touch-none"
      onPointerDown={handlePointerDown}
    >
      {/* Top Header HUD */}
      <header
        id="game-hud-top"
        className="relative z-20 px-4 pt-3 pb-2 flex items-center justify-between border-b border-[#2C2723] bg-[#181614]/90 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-[#567D46]/20 border border-[#567D46]/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#84D984]" />
          </div>
          <div>
            <h1 className="text-xs font-semibold tracking-wider text-[#F4F1EA] uppercase">
              {ZEN_CHART_METADATA.title}
            </h1>
            <div className="flex items-center space-x-2 text-[10px] text-[#A69E92]">
              <span>{ZEN_CHART_METADATA.bpm} BPM</span>
              <span>•</span>
              <span className="text-[#84D984]">Audio-clock Engine</span>
              {isTmaActive && (
                <>
                  <span>•</span>
                  <span className="text-[#4DA2FF] font-medium">TMA Haptic</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            id="btn-settings-toggle"
            type="button"
            className="p-2 rounded-lg bg-[#26211C] hover:bg-[#322B24] text-[#C4B9A7] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings(!showSettings);
            }}
            title="Калибровка и настройки"
          >
            <Sliders className="w-4 h-4" />
          </button>
          <button
            id="btn-sound-toggle"
            type="button"
            className="p-2 rounded-lg bg-[#26211C] hover:bg-[#322B24] text-[#C4B9A7] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              toggleSound();
            }}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Zen Score & Timing Gauge Bar */}
      <section id="game-stats-bar" className="relative z-20 px-4 py-2 flex items-center justify-between">
        <div className="flex items-baseline space-x-2">
          <span className="text-2xl font-bold tracking-tight text-[#FFF3B3] font-mono">
            {score.score.toLocaleString()}
          </span>
          {score.combo > 1 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#E2A931]/20 text-[#FCE786] border border-[#E2A931]/40 animate-pulse">
              {score.combo} COMBO!
            </span>
          )}
        </div>

        {/* Real-time audio-clock timing delta indicator */}
        <div className="flex items-center space-x-2">
          {lastDelta ? (
            <div
              className={`text-xs px-2.5 py-1 rounded font-mono font-bold flex items-center space-x-1 ${
                lastDelta.rating === 'PERFECT'
                  ? 'bg-[#E2A931]/20 text-[#FCE786] border border-[#E2A931]'
                  : lastDelta.rating === 'GOOD'
                  ? 'bg-[#3E9E47]/20 text-[#84D984] border border-[#3E9E47]'
                  : 'bg-red-950/40 text-red-400 border border-red-800'
              }`}
            >
              <span>{lastDelta.rating}</span>
              <span className="text-[10px] opacity-85">
                ({lastDelta.delta > 0 ? `+${lastDelta.delta}` : lastDelta.delta}ms)
              </span>
            </div>
          ) : (
            <div className="text-[11px] text-[#8C8375] font-mono">
              Окно: ±{TIMING_WINDOWS.perfectMs}ms / ±{TIMING_WINDOWS.goodMs}ms
            </div>
          )}
        </div>
      </section>

      {/* Song Timeline Progress (updated via ref — no React re-renders) */}
      <div id="timeline-progress" className="relative z-20 w-full px-4">
        <div className="w-full h-1 bg-[#2C2723] rounded-full overflow-hidden">
          <div
            ref={progressFillRef}
            className="h-full w-full origin-left bg-gradient-to-r from-[#6E9855] via-[#84D984] to-[#FCE786]"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
        <div className="mt-1 text-[10px] font-mono text-[#8C8375] truncate">Трек: {activeTrackLabel}</div>
      </div>

      {/* Main Pixi.js v8 Canvas Viewport */}
      <main
        id="pixi-viewport"
        className="relative flex-1 w-full flex items-center justify-center overflow-hidden cursor-pointer"
      >
        <div ref={pixiContainerRef} className="w-full h-full max-h-[640px] aspect-[9/16]" />

        {/* IDLE / START OVERLAY */}
        {gameState === 'IDLE' && (
          <div
            id="start-screen-overlay"
            className="absolute inset-0 bg-[#181614]/75 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center z-30"
          >
            <div className="w-16 h-16 mb-4 rounded-2xl bg-gradient-to-br from-[#567D46] to-[#364F2C] border-2 border-[#84D984]/50 flex items-center justify-center shadow-lg shadow-black/60">
              <Play className="w-8 h-8 text-[#FFF3B3] ml-1" />
            </div>

            <h2 className="text-xl font-bold tracking-wide text-[#F4F1EA] mb-1">
              {ZEN_CHART_METADATA.title}
            </h2>
            <p className="text-xs text-[#C4B9A7] max-w-[280px] mb-6 leading-relaxed">
              Попадайте в ритм {ZEN_CHART_METADATA.bpm} BPM, чтобы наливать горячий чай из бамбукового черпака.
              Держите аудио-точный тайминг: <span className="text-[#FCE786] font-semibold">PERFECT (±{TIMING_WINDOWS.perfectMs} мс)</span>.
            </p>

            <button
              id="btn-start-game"
              type="button"
              disabled={isLoadingAudio}
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#6E9855] to-[#487334] text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-[#487334]/40 hover:brightness-110 active:scale-95 transition-transform disabled:opacity-60"
            >
              {isLoadingAudio ? 'Загрузка аудио…' : 'Коснитесь экрана для старта'}
            </button>
            {audioError && (
              <p className="mt-3 text-[11px] text-red-400 max-w-[280px]">{audioError}</p>
            )}
            <p className="mt-3 text-[11px] text-[#8C8375]">
              Активирует Web Audio API и тактильный отклик Telegram
            </p>
          </div>
        )}

        {/* ROUND SUMMARY OVERLAY (Rhythm Heaven Style) */}
        {gameState === 'FINISHED' && (
          <div
            id="summary-screen-overlay"
            className="absolute inset-0 bg-[#181614]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30 animate-in fade-in"
          >
            <div className="w-14 h-14 mb-3 rounded-full bg-[#E2A931]/20 border border-[#E2A931] flex items-center justify-center">
              <Award className="w-8 h-8 text-[#FCE786]" />
            </div>

            <span className="text-[11px] tracking-widest text-[#A69E92] uppercase font-mono">
              Оценка Чайного Мастера
            </span>
            <h2 className="text-2xl font-black tracking-tight text-[#FCE786] mb-4">
              {score.rank === 'ZEN_MASTER'
                ? 'МАСТЕР ДЗЭНА'
                : score.rank === 'SUPERB'
                ? 'ВЕЛИКОЛЕПНО'
                : score.rank === 'OK'
                ? 'ПРИЕМЛЕМО'
                : 'ПОПРОБУЙТЕ СНОВА'}
            </h2>

            {/* Metrics Breakdown Grid */}
            <div className="w-full max-w-[280px] bg-[#231F1B] border border-[#3A332C] rounded-xl p-4 mb-5 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-[#A69E92]">Точность (Accuracy)</span>
                <span className="font-bold text-[#84D984]">{score.accuracy}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#FCE786]">PERFECT (≤{TIMING_WINDOWS.perfectMs}ms)</span>
                <span className="font-bold text-[#FCE786]">{score.perfectCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#84D984]">GOOD (≤{TIMING_WINDOWS.goodMs}ms)</span>
                <span className="font-bold text-[#84D984]">{score.goodCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-red-400">MISS (&gt;{TIMING_WINDOWS.goodMs}ms)</span>
                <span className="font-bold text-red-400">{score.missCount}</span>
              </div>
              <div className="flex justify-between items-center border-t border-[#3A332C] pt-2">
                <span className="text-[#A69E92]">Макс. Комбо</span>
                <span className="font-bold text-[#FFF3B3]">{score.maxCombo}</span>
              </div>
            </div>

            <button
              id="btn-restart-game"
              type="button"
              disabled={isLoadingAudio}
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#6E9855] to-[#487334] text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-[#487334]/40 hover:brightness-110 active:scale-95 transition-transform flex items-center space-x-2 disabled:opacity-60"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void startRound();
              }}
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isLoadingAudio ? 'Загрузка…' : 'Заварить еще раз'}</span>
            </button>
          </div>
        )}
      </main>

      {/* Settings / Latency Calibration Modal */}
      {showSettings && (
        <div
          id="settings-modal"
          className="absolute inset-x-4 top-16 z-40 p-4 bg-[#231F1B] border border-[#3A332C] rounded-2xl shadow-2xl backdrop-blur-lg"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#3A332C]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#F4F1EA] flex items-center space-x-1.5">
              <Sliders className="w-3.5 h-3.5 text-[#84D984]" />
              <span>Синхронизация и Калибровка (Offset)</span>
            </h3>
            <button
              type="button"
              className="text-xs text-[#A69E92] hover:text-white"
              onClick={() => setShowSettings(false)}
            >
              ✕
            </button>
          </div>

          {/* Latency slider */}
          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between text-[#C4B9A7] mb-1 font-mono">
                <span>Инпут-оффсет (только оценка):</span>
                <span className="text-[#FCE786] font-bold">
                  {userOffsetMs > 0 ? `+${userOffsetMs}` : userOffsetMs} ms
                </span>
              </div>
              <input
                id="offset-slider"
                type="range"
                min="-120"
                max="120"
                step="5"
                value={userOffsetMs}
                onChange={(e) => handleOffsetChange(Number(e.target.value))}
                className="w-full accent-[#6E9855]"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[-30, -15, 0, 15, 30, 60].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleOffsetChange(preset)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                      userOffsetMs === preset
                        ? 'bg-[#6E9855] text-white border-[#84D984]'
                        : 'bg-[#2C2723] text-[#C4B9A7] border-[#3A332C] hover:text-white'
                    }`}
                  >
                    {preset > 0 ? `+${preset}ms` : `${preset}ms`}
                    {preset === 60 ? ' (BT)' : ''}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#8C8375] mt-1.5">
                Положительный оффсет засчитывает нажатия раньше (компенсация задержки
                Bluetooth/аудиовыхода). Влияет только на оценку нажатий — визуал, музыка
                и пропуск нот не сдвигаются. По умолчанию 0.
              </p>
            </div>

          {/* SFX & Rhythm Cues Volume */}
          <div className="pt-2 border-t border-[#3A332C]">
            <div className="flex justify-between text-[#C4B9A7] mb-1 font-mono text-xs">
              <span className="text-[#84D984] font-semibold">Ритм-подсказки и тапы (Cues & SFX):</span>
              <span className="text-[#FCE786] font-bold">
                {Math.round(sfxVolume * 100)}%
              </span>
            </div>
            <input
              id="sfx-volume-slider"
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={sfxVolume}
              onChange={(e) => handleSfxVolumeChange(parseFloat(e.target.value))}
              className="w-full accent-[#84D984]"
            />
            <p className="text-[10px] text-[#8C8375] mt-0.5">
              Усиливает бамбуковый щелчок вылета капли и звон успешного тапа.
            </p>
          </div>

          {/* Custom Audio Upload (genuine active track) */}
          <div className="pt-2 border-t border-[#3A332C]">
            <label className="block text-[11px] text-[#C4B9A7] mb-1.5 font-medium flex items-center space-x-1.5">
              <Music className="w-3.5 h-3.5 text-[#4DA2FF]" />
              <span>Загрузить свой аудиотрек (MP3 / WAV):</span>
            </label>
            <input
              id="custom-audio-input"
              type="file"
              accept="audio/*"
              disabled={isUploading}
              onChange={handleAudioUpload}
              className="text-xs text-[#A69E92] file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#362C23] file:text-[#C4B9A7] hover:file:bg-[#45392D] disabled:opacity-60"
            />
            {(uploadStatus || uploadProgress !== null) && (
              <div className="mt-1.5">
                {uploadStatus && (
                  <p className="text-[11px] font-mono text-[#FCE786] animate-pulse">{uploadStatus}</p>
                )}
                {uploadProgress !== null && (
                  <div className="mt-1 w-full h-1 bg-[#2C2723] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#4DA2FF]"
                      style={{ width: `${Math.round(uploadProgress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
            <p className="text-[10px] text-[#8C8375] mt-1.5">
              Загруженный трек действительно становится игровым (без генерации поверх).
              Ограничение: чарт написан под грув 90 BPM — загруженная музыка играет как есть,
              авто-битмап и BPM-детект не выполняются.
            </p>
            {audioError && (
              <p className="mt-1.5 text-[11px] text-red-400">{audioError}</p>
            )}
            <button
              type="button"
              onClick={handleClearCustomTrack}
              className="mt-1.5 px-2 py-0.5 rounded text-[10px] font-mono border bg-[#2C2723] text-[#C4B9A7] border-[#3A332C] hover:text-white"
            >
              Сбросить на дефолтный трек
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Bottom Zen Bar */}
      <footer
        id="game-hud-bottom"
        className="relative z-20 px-4 py-3 bg-[#181614] border-t border-[#2C2723] flex items-center justify-between"
      >
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#84D984] animate-pulse" />
          <span className="text-[11px] font-mono text-[#A69E92]">
            Дзен: <strong className="text-[#84D984]">{score.zenLevel}%</strong>
          </span>
        </div>

        <div className="text-[11px] font-mono text-[#A69E92] flex items-center space-x-1">
          <Zap className="w-3 h-3 text-[#FCE786]" />
          <span>Такт: {ZEN_CHART_METADATA.bpm} BPM • 4/4</span>
        </div>
      </footer>
    </div>
  );
};
