import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, RotateCcw, Play, Award, Zap, Sliders, Music, Sparkles } from 'lucide-react';
import { AudioEngine } from '../engine/AudioEngine';
import { InputJudge, JudgeResult } from '../engine/InputJudge';
import { VisualEngine } from '../engine/VisualEngine';
import { ChartEvent, GameScore } from '../types';
import { ZEN_CHART_METADATA, getFreshChartEvents } from '../data/zenChart';
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
  const [userOffsetMs, setUserOffsetMs] = useState<number>(0);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isTmaActive, setIsTmaActive] = useState<boolean>(false);
  const [songProgress, setSongProgress] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // 4-Stem Volume Mix State (0 to 1)
  const [stemVolumes, setStemVolumes] = useState<{
    drums: number;
    bass: number;
    chords: number;
    lead: number;
  }>({
    drums: 1,
    bass: 1,
    chords: 1,
    lead: 1,
  });

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
      audioEngineRef.current.setOffsetMs(val);
    }
  };

  const handleStemChange = (stem: 'drums' | 'bass' | 'chords' | 'lead', val: number) => {
    setStemVolumes((prev) => ({ ...prev, [stem]: val }));
    if (audioEngineRef.current) {
      audioEngineRef.current.setStemVolume(stem, val);
    }
  };

  const animationFrameId = useRef<number | null>(null);
  const eventsRef = useRef<ChartEvent[]>([]);
  eventsRef.current = chartEvents;

  // Initialize Engines & Telegram WebApp
  useEffect(() => {
    const tmaDetected = TMAService.init();
    setIsTmaActive(tmaDetected);

    const audio = new AudioEngine();
    audioEngineRef.current = audio;

    const visual = new VisualEngine(audio);
    visualEngineRef.current = visual;

    const judge = new InputJudge();
    inputJudgeRef.current = judge;

    if (pixiContainerRef.current) {
      visual.init(pixiContainerRef.current).then(() => {
        visual.setBpm(ZEN_CHART_METADATA.bpm);
      }).catch((err) => {
        console.error('[VisualEngine] Initialization error:', err);
      });
    }

    setChartEvents(getFreshChartEvents());

    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      audio.stopTrack();
      visual.destroy();
    };
  }, []);

  // Main Game Loop for Miss Detection & Round Completion
  const runGameLoop = useCallback(() => {
    const audio = audioEngineRef.current;
    const judge = inputJudgeRef.current;
    const visual = visualEngineRef.current;

    if (!audio || !judge || !visual) return;

    if (audio.getIsPlaying()) {
      const songTimeMs = audio.getExactSongTime();

      // Update progress bar
      const progress = Math.min(100, (songTimeMs / ZEN_CHART_METADATA.songLengthMs) * 100);
      setSongProgress(progress);

      // Check for missed notes
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

      // Check if song has finished
      if (songTimeMs >= ZEN_CHART_METADATA.songLengthMs) {
        audio.stopTrack();
        setGameState('FINISHED');
        TMAService.hapticNotification('success');
        return;
      }
    }

    animationFrameId.current = requestAnimationFrame(runGameLoop);
  }, []);

  // Start / Restart round
  const startRound = async () => {
    const audio = audioEngineRef.current;
    const judge = inputJudgeRef.current;
    const visual = visualEngineRef.current;
    if (!audio || !judge || !visual) return;

    // First user gesture triggers audio context resume
    await audio.resumeContext();

    const freshEvents = getFreshChartEvents();
    setChartEvents(freshEvents);
    visual.setBpm(ZEN_CHART_METADATA.bpm);
    visual.setChartEvents(freshEvents);
    visual.resetScene();

    const initialScore = judge.resetScore();
    setScore(initialScore);
    setLastDelta(null);
    setSongProgress(0);

    // Procedurally generate authentic 130 BPM 4-Stem Zen Track matching chart duration
    const trackDurationSec = Math.ceil(ZEN_CHART_METADATA.songLengthMs / 1000);
    const trackBuffer = audio.generateZenSoundtrack(ZEN_CHART_METADATA.bpm, trackDurationSec);

    audio.startTrack(trackBuffer, freshEvents, ZEN_CHART_METADATA.bpm, userOffsetMs);
    // Apply current stem mix
    audio.setStemVolume('drums', stemVolumes.drums);
    audio.setStemVolume('bass', stemVolumes.bass);
    audio.setStemVolume('chords', stemVolumes.chords);
    audio.setStemVolume('lead', stemVolumes.lead);
    setGameState('PLAYING');

    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = requestAnimationFrame(runGameLoop);
  };

  // Primary Gameplay Tap Handler (sub-millisecond precision)
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();

    if (gameState === 'IDLE' || gameState === 'FINISHED') {
      startRound();
      return;
    }

    if (gameState !== 'PLAYING') return;

    const audio = audioEngineRef.current;
    const judge = inputJudgeRef.current;
    const visual = visualEngineRef.current;
    if (!audio || !judge || !visual) return;

    // Dual-clock source of truth
    const exactSongTime = audio.getExactSongTime();
    const result = judge.handlePointerDown(exactSongTime, eventsRef.current);

    if (result) {
      visual.triggerHitFeedback(result.rating, exactSongTime);
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
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !audioEngineRef.current) return;

    try {
      const url = URL.createObjectURL(file);
      await audioEngineRef.current.loadAudio(url);
      startRound();
    } catch (err) {
      console.error('Failed to load custom audio file:', err);
    }
  };

  const toggleSound = () => {
    setIsMuted(!isMuted);
    // Visual mute toggle
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
              <span className="text-[#84D984]">Dual-Clock Engine</span>
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

        {/* Real-time Sub-millisecond Accuracy Delta Indicator */}
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
            <div className="text-[11px] text-[#8C8375] font-mono">Окно: ±50ms / ±100ms</div>
          )}
        </div>
      </section>

      {/* Song Timeline Progress */}
      <div id="timeline-progress" className="relative z-20 w-full px-4">
        <div className="w-full h-1 bg-[#2C2723] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#6E9855] via-[#84D984] to-[#FCE786] transition-all duration-75"
            style={{ width: `${songProgress}%` }}
          />
        </div>
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
              Держите субмиллисекундный тайминг: <span className="text-[#FCE786] font-semibold">PERFECT (±50 мс)</span>.
            </p>

            <button
              id="btn-start-game"
              type="button"
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#6E9855] to-[#487334] text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-[#487334]/40 hover:brightness-110 active:scale-95 transition-transform"
            >
              Коснитесь экрана для старта
            </button>
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
                <span className="text-[#FCE786]">PERFECT (≤45ms)</span>
                <span className="font-bold text-[#FCE786]">{score.perfectCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#84D984]">GOOD (≤90ms)</span>
                <span className="font-bold text-[#84D984]">{score.goodCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-red-400">MISS (&gt;90ms)</span>
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
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#6E9855] to-[#487334] text-white font-bold text-sm tracking-wider uppercase shadow-lg shadow-[#487334]/40 hover:brightness-110 active:scale-95 transition-transform flex items-center space-x-2"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                startRound();
              }}
            >
              <RotateCcw className="w-4 h-4" />
              <span>Заварить еще раз</span>
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
                <span>Аудио-оффсет:</span>
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
                Сдвиньте влево, если нажатия запаздывают; вправо при Bluetooth-наушниках.
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

          {/* 4-Stem Audio Mixer */}
          <div className="pt-2 border-t border-[#3A332C] space-y-2">
            <span className="text-[11px] font-semibold text-[#F4F1EA] block">
              Микшер 4-х Дорожек (Multi-Stem Mixer):
            </span>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div className="flex justify-between text-[#C4B9A7] mb-0.5">
                  <span>Ударные (Drums):</span>
                  <span className="font-mono text-[#FCE786]">{Math.round(stemVolumes.drums * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={stemVolumes.drums}
                  onChange={(e) => handleStemChange('drums', parseFloat(e.target.value))}
                  className="w-full accent-[#E2A931]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[#C4B9A7] mb-0.5">
                  <span>Бас (Bass):</span>
                  <span className="font-mono text-[#FCE786]">{Math.round(stemVolumes.bass * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={stemVolumes.bass}
                  onChange={(e) => handleStemChange('bass', parseFloat(e.target.value))}
                  className="w-full accent-[#84D984]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[#C4B9A7] mb-0.5">
                  <span>Кото/Аккорды:</span>
                  <span className="font-mono text-[#FCE786]">{Math.round(stemVolumes.chords * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={stemVolumes.chords}
                  onChange={(e) => handleStemChange('chords', parseFloat(e.target.value))}
                  className="w-full accent-[#4DA2FF]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[#C4B9A7] mb-0.5">
                  <span>Колокола/Лид:</span>
                  <span className="font-mono text-[#FCE786]">{Math.round(stemVolumes.lead * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={stemVolumes.lead}
                  onChange={(e) => handleStemChange('lead', parseFloat(e.target.value))}
                  className="w-full accent-[#D984FCE7]"
                />
              </div>
            </div>
          </div>

          {/* Custom Audio Upload */}
          <div className="pt-2 border-t border-[#3A332C]">
            <label className="block text-[11px] text-[#C4B9A7] mb-1.5 font-medium flex items-center space-x-1.5">
              <Music className="w-3.5 h-3.5 text-[#4DA2FF]" />
              <span>Загрузить свой аудиотрек (MP3 / WAV):</span>
            </label>
            <input
              id="custom-audio-input"
              type="file"
              accept="audio/*"
              onChange={handleAudioUpload}
              className="text-xs text-[#A69E92] file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#362C23] file:text-[#C4B9A7] hover:file:bg-[#45392D]"
            />
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
