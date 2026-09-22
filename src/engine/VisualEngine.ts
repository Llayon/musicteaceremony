import {
  Application,
  Container,
  Sprite,
  Texture,
  Rectangle,
  AnimatedSprite,
  Graphics,
} from 'pixi.js';
import { ChartEvent, HitRating } from '../types';
import { SPRITESHEET_MANIFEST, generateSpritesheetCanvas } from '../assets/spritesheet';
import { AudioEngine } from './AudioEngine';
import {
  beatPulsePhase,
  clampedDropletProgress,
  dropletPosition,
  isDropletVisible,
  registerImpact,
  takeDueImpacts,
  type PendingImpact,
} from './dropMotion';

interface PooledNote {
  sprite: Sprite;
  inUse: boolean;
  noteId: string | null;
}

interface PooledFeedback {
  sprite: Sprite;
  inUse: boolean;
  spawnTimeMs: number;
  startX: number;
  startY: number;
}

interface PooledSplash {
  sprite: Sprite;
  inUse: boolean;
  spawnTimeMs: number;
}

export class VisualEngine {
  private app: Application | null = null;
  private container: HTMLDivElement | null = null;
  private audioEngine: AudioEngine;

  // Scene layers
  private stageContainer: Container | null = null;
  private backgroundLayer: Container | null = null;
  private gameLayer: Container | null = null;
  private feedbackLayer: Container | null = null;

  // Spritesheet and textures dictionary
  private textures: Map<string, Texture> = new Map();
  private steamAnimation: AnimatedSprite | null = null;
  private cupSprite: Sprite | null = null;
  private ladleSprite: Sprite | null = null;
  private targetRing: Graphics | null = null;

  // Object Pools
  private notePool: PooledNote[] = [];
  private feedbackPool: PooledFeedback[] = [];
  private splashPool: PooledSplash[] = [];

  // Visual constants (Virtual 9:16 Canvas coordinate space: 360 x 640)
  public static readonly VIRTUAL_WIDTH = 360;
  public static readonly VIRTUAL_HEIGHT = 640;

  // Dynamic tempo setting
  private currentBpm: number = 90;

  // Beat-grid phase in ms (production track: FIRST_BEAT_MS = 40).
  private firstBeatOffsetMs: number = 40;

  // Anticipation in beats (chart config: 1.5 at 90 BPM = 1000 ms flight).
  private approachBeats: number = 1.5;

  // Approach time in ms, derived from the audio-clock tempo + chart config.
  public getApproachTimeMs(): number {
    return (60000 / this.currentBpm) * this.approachBeats;
  }

  public setBpm(bpm: number): void {
    this.currentBpm = bpm;
    if (this.steamAnimation) {
      // Sync steam animation speed to tempo
      this.steamAnimation.animationSpeed = 0.13 * (bpm / 90);
    }
  }

  public setApproachBeats(beats: number): void {
    if (Number.isFinite(beats) && beats > 0) {
      this.approachBeats = beats;
    }
  }

  public setFirstBeatOffsetMs(offsetMs: number): void {
    if (Number.isFinite(offsetMs) && offsetMs >= 0) {
      this.firstBeatOffsetMs = offsetMs;
    }
  }

  /**
   * Deferred visual impact: judgment (score/delta) happens at tap time, but
   * splash/plate/cup fire when the droplet actually reaches the cup at
   * note.timeMs. Replaces any pending impact for the same note (no doubles).
   */
  public registerHitImpact(noteId: string, rating: HitRating, impactTimeMs: number): void {
    this.pendingImpacts = registerImpact(this.pendingImpacts, noteId, rating, impactTimeMs);
  }

  // Target Hit position (Porcelain cup mouth)
  private readonly targetX = 180;
  private readonly targetY = 445;

  // Ladle / Spawn position (Top-Right of screen)
  private readonly spawnX = 295;
  private readonly spawnY = 230;

  // Dynamic state
  private activeEvents: ChartEvent[] = [];
  private cupReactionResetTime: number = 0;
  private teaFillLevel: number = 0; // 0 to 1
  private destroyed = false;
  private ringResetTimer: number | null = null;
  // Deferred visual impacts (fire at note.timeMs, not at tap time).
  private pendingImpacts: PendingImpact[] = [];

  constructor(audioEngine: AudioEngine) {
    this.audioEngine = audioEngine;
  }

  /**
   * Initializes Pixi.js v8 Application with 9:16 orientation & scaleMode nearest
   */
  public async init(containerElement: HTMLDivElement): Promise<void> {
    if (this.destroyed) return;
    this.container = containerElement;

    // 1. Create Pixi.js v8 Application
    const app = new Application();
    await app.init({
      width: VisualEngine.VIRTUAL_WIDTH,
      height: VisualEngine.VIRTUAL_HEIGHT,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      backgroundColor: 0x1a1917,
      antialias: false,
    });

    this.app = app;
    containerElement.replaceChildren(app.canvas);

    // Apply pixel-art CSS styling to canvas
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.objectFit = 'contain';
    app.canvas.style.imageRendering = 'pixelated';

    // 2. Build Textures from procedural pixel spritesheet
    this.buildSpritesheetTextures();

    // 3. Assemble Layers
    this.stageContainer = new Container();
    this.backgroundLayer = new Container();
    this.gameLayer = new Container();
    this.feedbackLayer = new Container();

    this.stageContainer.addChild(this.backgroundLayer);
    this.stageContainer.addChild(this.gameLayer);
    this.stageContainer.addChild(this.feedbackLayer);
    app.stage.addChild(this.stageContainer);

    // 4. Construct Zen Scene
    this.setupBackground();
    this.setupCupAndSteam();
    this.setupLadle();
    this.setupTargetRing();

    // 5. Initialize Object Pools
    this.initObjectPools();

    // 6. Connect Pixi.js v8 Render Loop
    // DUAL-CLOCK PRINCIPLE: app.ticker solely reads songPosition from AudioContext and interpolates visuals.
    app.ticker.add(() => {
      this.updateRenderLoop();
    });
  }

  /**
   * Builds pixel-perfect subtextures from the canvas atlas
   */
  private buildSpritesheetTextures(): void {
    const canvas = generateSpritesheetCanvas();
    const baseTexture = Texture.from(canvas);

    // Enforce nearest scale mode for crisp pixel art in Pixi v8
    if (baseTexture.source) {
      baseTexture.source.scaleMode = 'nearest';
    }

    // Cut frames according to SPRITESHEET_MANIFEST
    Object.entries(SPRITESHEET_MANIFEST.frames).forEach(([name, frame]) => {
      const texture = new Texture({
        source: baseTexture.source,
        frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
      });
      this.textures.set(name, texture);
    });
  }

  /**
   * Sets up Zen Tea Room aesthetic background
   */
  private setupBackground(): void {
    if (!this.backgroundLayer) return;

    const bgGfx = new Graphics();

    // Soft warm shoji screen gradient wall
    bgGfx.rect(0, 0, VisualEngine.VIRTUAL_WIDTH, 480).fill(0x23201d);

    // Shoji paper lattice lines (delicate Japanese sliding screen)
    bgGfx.stroke({ width: 1.5, color: 0x38332d });
    for (let x = 30; x < VisualEngine.VIRTUAL_WIDTH; x += 60) {
      bgGfx.moveTo(x, 0).lineTo(x, 480);
    }
    for (let y = 60; y < 480; y += 70) {
      bgGfx.moveTo(0, y).lineTo(VisualEngine.VIRTUAL_WIDTH, y);
    }

    // Soft sunrise sun circle on shoji screen
    bgGfx.circle(180, 160, 65).fill({ color: 0xd9534f, alpha: 0.15 });

    // Wooden Tea Table / Tatami flooring (bottom section)
    bgGfx.rect(0, 480, VisualEngine.VIRTUAL_WIDTH, 160).fill(0x362c23);
    bgGfx.rect(0, 476, VisualEngine.VIRTUAL_WIDTH, 6).fill(0x524335);

    // Tatami edge border ribbon (Keri)
    bgGfx.rect(0, 520, VisualEngine.VIRTUAL_WIDTH, 4).fill(0x1a2416);

    this.backgroundLayer.addChild(bgGfx);
  }

  /**
   * Sets up Porcelain Cup and Animated Steam
   */
  private setupCupAndSteam(): void {
    if (!this.gameLayer) return;

    const cupTex = this.textures.get('cup_empty');
    if (cupTex) {
      this.cupSprite = new Sprite(cupTex);
      this.cupSprite.anchor.set(0.5, 0.8);
      this.cupSprite.position.set(this.targetX, this.targetY + 44);
      this.cupSprite.scale.set(2.0); // 2x pixel scale
      this.gameLayer.addChild(this.cupSprite);
    }

    // 4-frame Animated Steam sprite
    const steamFrames = [
      this.textures.get('steam_0')!,
      this.textures.get('steam_1')!,
      this.textures.get('steam_2')!,
      this.textures.get('steam_3')!,
    ].filter(Boolean);

    if (steamFrames.length > 0) {
      this.steamAnimation = new AnimatedSprite(steamFrames);
      this.steamAnimation.anchor.set(0.5, 1.0);
      this.steamAnimation.position.set(this.targetX, this.targetY - 12);
      this.steamAnimation.scale.set(1.8);
      // Speed synced to 90 BPM (1.5 beats per sec -> 4 frames per beat ≈ 6 fps)
      this.steamAnimation.animationSpeed = 0.13;
      this.steamAnimation.play();
      this.gameLayer.addChild(this.steamAnimation);
    }
  }

  /**
   * Sets up Bamboo Ladle (Hishaku)
   */
  private setupLadle(): void {
    if (!this.gameLayer) return;

    const ladleTex = this.textures.get('bamboo_ladle');
    if (ladleTex) {
      this.ladleSprite = new Sprite(ladleTex);
      this.ladleSprite.anchor.set(0.8, 0.3);
      this.ladleSprite.position.set(this.spawnX + 20, this.spawnY - 20);
      this.ladleSprite.scale.set(1.6);
      this.gameLayer.addChild(this.ladleSprite);
    }
  }

  /**
   * Target zone indicator ring (subtle zen circle)
   */
  private setupTargetRing(): void {
    if (!this.gameLayer) return;

    this.targetRing = new Graphics();
    this.targetRing
      .ellipse(this.targetX, this.targetY, 26, 8)
      .stroke({ width: 2, color: 0xa1c484, alpha: 0.6 });
    this.gameLayer.addChild(this.targetRing);
  }

  /**
   * Allocates Object Pools for zero GC pauses during gameplay
   */
  private initObjectPools(): void {
    if (!this.gameLayer || !this.feedbackLayer) return;

    const dropTex = this.textures.get('tea_drop')!;
    const goldenDropTex = this.textures.get('tea_drop_golden')!;
    const splashTex = this.textures.get('splash_1')!;
    const perfectTex = this.textures.get('plate_perfect')!;

    // 1. Note Pool (20 items)
    for (let i = 0; i < 20; i++) {
      const sprite = new Sprite(dropTex || goldenDropTex);
      sprite.anchor.set(0.5, 0.5);
      sprite.scale.set(1.6);
      sprite.visible = false;
      this.gameLayer.addChild(sprite);
      this.notePool.push({ sprite, inUse: false, noteId: null });
    }

    // 2. Feedback Plates Pool (10 items)
    for (let i = 0; i < 10; i++) {
      const sprite = new Sprite(perfectTex);
      sprite.anchor.set(0.5, 0.5);
      sprite.scale.set(1.2);
      sprite.visible = false;
      this.feedbackLayer.addChild(sprite);
      this.feedbackPool.push({
        sprite,
        inUse: false,
        spawnTimeMs: 0,
        startX: 0,
        startY: 0,
      });
    }

    // 3. Splash Pool (8 items)
    for (let i = 0; i < 8; i++) {
      const sprite = new Sprite(splashTex);
      sprite.anchor.set(0.5, 0.8);
      sprite.scale.set(1.5);
      sprite.visible = false;
      this.gameLayer.addChild(sprite);
      this.splashPool.push({ sprite, inUse: false, spawnTimeMs: 0 });
    }
  }

  /**
   * Sets current chart events to track
   */
  public setChartEvents(events: ChartEvent[]): void {
    this.activeEvents = events;
  }

  /**
   * Core Pixi Render Loop
   * Strictly reads songPosition from AudioEngine, interpolating note positions with zero drift.
   */
  private updateRenderLoop(): void {
    const songTimeMs = this.audioEngine.getExactSongTime();
    const isPlaying = this.audioEngine.getIsPlaying();

    // 1. Reset cup facial reaction after brief time
    if (this.cupReactionResetTime > 0 && songTimeMs > this.cupReactionResetTime) {
      this.cupReactionResetTime = 0;
      this.updateCupTexture(false);
    }

    // 2. Musically synchronized Beat Bounce (90 BPM tempo anchoring,
    // phased to the real beat grid — NOT to song-time zero).
    const beatMs = 60000 / this.currentBpm;
    const beatPhase = beatPulsePhase(songTimeMs, beatMs, this.firstBeatOffsetMs);
    // Rhythmic bounce pulse: sharp impact on beat, exponential decay
    const beatBounce = isPlaying ? Math.exp(-beatPhase * 4.5) : 0;

    if (this.steamAnimation && isPlaying) {
      this.steamAnimation.scale.set(1.7 + beatBounce * 0.25);
      this.steamAnimation.alpha = 0.6 + beatBounce * 0.3;
    }

    if (this.cupSprite && isPlaying) {
      // Subtle rhythmic squash and stretch on the porcelain cup
      this.cupSprite.position.set(this.targetX, this.targetY + 44 + beatBounce * 2.5);
      this.cupSprite.scale.set(2.0 + beatBounce * 0.05, 2.0 - beatBounce * 0.05);
    }

    if (this.targetRing && isPlaying) {
      // Soft pulsing receptor ring marking the beat
      this.targetRing.alpha = 0.45 + beatBounce * 0.45;
    }

    // 3. Update Pooled Notes via Musically Quantized Visual Interpolation
    this.updateNotes(songTimeMs, isPlaying);

    // 3b. Fire deferred visual impacts whose droplet just reached the cup.
    // Judgment happened at tap time; splash/plate/cup resolve here, exactly
    // at note.timeMs, so what the player sees matches what they hear.
    if (isPlaying && this.pendingImpacts.length > 0) {
      const { due, pending } = takeDueImpacts(this.pendingImpacts, songTimeMs);
      this.pendingImpacts = pending;
      for (const impact of due) {
        this.triggerHitFeedback(impact.rating, songTimeMs);
      }
    }

    // 4. Update Feedback Plates Animation
    this.updateFeedbackPlates(songTimeMs);

    // 5. Update Splashes Animation
    this.updateSplashes(songTimeMs);

    // 6. Synchronized Hishaku Ladle Pour Animation
    // The ladle tilts to pour at the EXACT millisecond the droplet launches
    // (approachBeats before the hit — 1.5 beats / 1000 ms at 90 BPM)
    if (this.ladleSprite) {
      const approachTimeMs = this.getApproachTimeMs();
      let targetTilt = 0;

      if (isPlaying) {
        for (let i = 0; i < this.activeEvents.length; i++) {
          const note = this.activeEvents[i];
          if (note.status !== 'pending') continue;

          const launchTime = note.timeMs - approachTimeMs;
          const timeFromLaunch = songTimeMs - launchTime;

          // Pouring gesture window: 140ms pre-launch windup to 200ms post-launch recovery
          if (timeFromLaunch >= -140 && timeFromLaunch <= 200) {
            if (timeFromLaunch < 0) {
              // Windup: ladle lifts back slightly
              const windup = -timeFromLaunch / 140;
              targetTilt = -0.15 * windup;
            } else if (timeFromLaunch < 65) {
              // SNAP POUR forward: droplet detaches
              const snap = Math.sin((timeFromLaunch / 65) * (Math.PI / 2));
              targetTilt = 0.45 * snap;
            } else {
              // Elastic recovery back to neutral rest position
              const recovery = Math.cos(((timeFromLaunch - 65) / 135) * (Math.PI / 2));
              targetTilt = 0.45 * recovery;
            }
          }
        }
      }

      this.ladleSprite.rotation += (targetTilt - this.ladleSprite.rotation) * 0.35;
    }
  }

  /**
   * Interpolates flying tea droplets based purely on exact song time.
   * Each droplet travels for exactly approachBeats (1.5 beats = 1000 ms
   * at 90 BPM — readable at this tempo, unlike the old 2-beat flight).
   *
   * Impact decoupling: judged (hit) droplets keep flying until note.timeMs
   * — an early tap never vanishes the droplet mid-flight; the deferred
   * impact visuals take over exactly at the cup.
   */
  private updateNotes(songTimeMs: number, isPlaying: boolean): void {
    const approachTimeMs = this.getApproachTimeMs();
    // Collect notes that should currently be visible on screen
    const visibleNotes: ChartEvent[] = [];

    if (isPlaying) {
      for (let i = 0; i < this.activeEvents.length; i++) {
        const note = this.activeEvents[i];
        if (!isDropletVisible(note.status, songTimeMs, note.timeMs, approachTimeMs)) continue;
        visibleNotes.push(note);
      }
    }

    // Hide notes that are no longer visible
    for (const poolItem of this.notePool) {
      if (poolItem.inUse) {
        const stillActive = visibleNotes.some((n) => n.id === poolItem.noteId);
        if (!stillActive) {
          poolItem.inUse = false;
          poolItem.noteId = null;
          poolItem.sprite.visible = false;
        }
      }
    }

    // Position or spawn visible notes
    for (const note of visibleNotes) {
      let poolItem = this.notePool.find((item) => item.inUse && item.noteId === note.id);

      if (!poolItem) {
        // Allocate from pool
        poolItem = this.notePool.find((item) => !item.inUse);
        if (!poolItem) continue; // All pool slots full

        poolItem.inUse = true;
        poolItem.noteId = note.id;
        poolItem.sprite.visible = true;

        // Use golden drop for finale note
        const isGolden = note.id.includes('finale');
        const dropTex = isGolden
          ? this.textures.get('tea_drop_golden')
          : this.textures.get('tea_drop');
        if (dropTex) poolItem.sprite.texture = dropTex;
      }

      // Mathematical visual interpolation:
      // progress = 0.0 at launch (note.timeMs - approachTimeMs), 1.0 exactly
      // at note.timeMs. Position uses CLAMPED progress: past note.timeMs the
      // droplet rests in the cup zone until resolution — never overshoots.
      const { x: currentX, y: currentY } = dropletPosition(
        songTimeMs,
        note.timeMs,
        approachTimeMs,
        this.spawnX,
        this.spawnY,
        this.targetX,
        this.targetY
      );

      poolItem.sprite.position.set(currentX, currentY);

      // Smooth tangent orientation + approach scale use the same clamped
      // progress, so a late droplet rests in the cup instead of overshooting.
      const clampedP = clampedDropletProgress(songTimeMs, note.timeMs, approachTimeMs);
      // Smooth tangent orientation: droplet dynamically angles along its arc trajectory
      const vx = this.targetX - this.spawnX; // -115
      const vy = (this.targetY - this.spawnY) - 55 * Math.PI * Math.cos(clampedP * Math.PI);
      poolItem.sprite.rotation = Math.atan2(vy, vx) + Math.PI / 2;

      // Scale drop slightly as it approaches cup
      const scale = 1.3 + clampedP * 0.35;
      poolItem.sprite.scale.set(scale);
    }
  }

  /**
   * Updates animated feedback banners (PERFECT, GOOD, MISS)
   */
  private updateFeedbackPlates(songTimeMs: number): void {
    const ANIMATION_DURATION_MS = 650;

    for (const item of this.feedbackPool) {
      if (!item.inUse) continue;

      const elapsed = songTimeMs - item.spawnTimeMs;

      if (elapsed > ANIMATION_DURATION_MS) {
        item.inUse = false;
        item.sprite.visible = false;
        continue;
      }

      // Float upward & fade out at end
      const progress = elapsed / ANIMATION_DURATION_MS;
      item.sprite.y = item.startY - progress * 40;

      // Bounce scale pop at start (0 -> 1.3 -> 1.0)
      if (progress < 0.25) {
        const pop = 0.7 + (progress / 0.25) * 0.5;
        item.sprite.scale.set(pop * 1.3);
      } else {
        item.sprite.scale.set(1.3);
      }

      // Fade out on last 30% of lifetime
      if (progress > 0.65) {
        item.sprite.alpha = (1 - progress) / 0.35;
      } else {
        item.sprite.alpha = 1;
      }
    }
  }

  /**
   * Updates splash ripple animations
   */
  private updateSplashes(songTimeMs: number): void {
    const SPLASH_DURATION_MS = 280;

    for (const item of this.splashPool) {
      if (!item.inUse) continue;

      const elapsed = songTimeMs - item.spawnTimeMs;
      if (elapsed > SPLASH_DURATION_MS) {
        item.inUse = false;
        item.sprite.visible = false;
        continue;
      }

      const frameIdx = Math.min(2, Math.floor((elapsed / SPLASH_DURATION_MS) * 3));
      const splashTex = this.textures.get(`splash_${frameIdx}`);
      if (splashTex) item.sprite.texture = splashTex;

      item.sprite.alpha = 1 - elapsed / SPLASH_DURATION_MS;
    }
  }

  /**
   * Triggers visual hit feedback
   */
  public triggerHitFeedback(rating: HitRating, songTimeMs: number): void {
    // 1. Show Feedback Plate from Pool
    const plateItem = this.feedbackPool.find((item) => !item.inUse);
    if (plateItem) {
      plateItem.inUse = true;
      plateItem.spawnTimeMs = songTimeMs;
      plateItem.startX = this.targetX;
      plateItem.startY = this.targetY - 48;

      let texName = 'plate_perfect';
      if (rating === 'GOOD') texName = 'plate_good';
      if (rating === 'MISS') texName = 'plate_miss';

      const tex = this.textures.get(texName);
      if (tex) plateItem.sprite.texture = tex;

      plateItem.sprite.position.set(plateItem.startX, plateItem.startY);
      plateItem.sprite.alpha = 1;
      plateItem.sprite.visible = true;
    }

    // 2. Spawn Water Splash
    if (rating === 'PERFECT' || rating === 'GOOD') {
      const splash = this.splashPool.find((item) => !item.inUse);
      if (splash) {
        splash.inUse = true;
        splash.spawnTimeMs = songTimeMs;
        splash.sprite.position.set(this.targetX, this.targetY - 6);
        splash.sprite.visible = true;
      }

      // Increase tea fill level
      this.teaFillLevel = Math.min(1.0, this.teaFillLevel + 0.12);
    }

    // 3. React Cup Face
    this.cupReactionResetTime = songTimeMs + 450;
    this.updateCupTexture(rating === 'PERFECT' ? 'happy' : rating === 'MISS' ? 'miss' : false);

    // 4. Target ring bounce
    if (this.targetRing) {
      const ringColor = rating === 'PERFECT' ? 0xffea75 : rating === 'GOOD' ? 0x9be887 : 0xff6666;
      this.targetRing.clear();
      this.targetRing
        .ellipse(this.targetX, this.targetY, 32, 10)
        .stroke({ width: 3, color: ringColor, alpha: 0.9 });

      if (this.ringResetTimer !== null) {
        window.clearTimeout(this.ringResetTimer);
      }
      this.ringResetTimer = window.setTimeout(() => {
        this.ringResetTimer = null;
        if (this.targetRing && !this.destroyed) {
          this.targetRing.clear();
          this.targetRing
            .ellipse(this.targetX, this.targetY, 26, 8)
            .stroke({ width: 2, color: 0xa1c484, alpha: 0.6 });
        }
      }, 150);
    }
  }

  /**
   * Switches cup texture based on fill level and reaction
   */
  private updateCupTexture(face: 'happy' | 'miss' | false): void {
    if (!this.cupSprite) return;

    if (face === 'happy') {
      const tex = this.textures.get('cup_happy');
      if (tex) this.cupSprite.texture = tex;
      return;
    }

    if (face === 'miss') {
      const tex = this.textures.get('cup_miss');
      if (tex) this.cupSprite.texture = tex;
      return;
    }

    // Regular state based on fill level
    let stateName = 'cup_empty';
    if (this.teaFillLevel >= 0.8) stateName = 'cup_full';
    else if (this.teaFillLevel >= 0.3) stateName = 'cup_half';

    const tex = this.textures.get(stateName);
    if (tex) this.cupSprite.texture = tex;
  }

  /**
   * Resets visuals for a new round
   */
  public resetScene(): void {
    this.teaFillLevel = 0;
    this.cupReactionResetTime = 0;
    this.pendingImpacts = [];
    this.updateCupTexture(false);

    // Reset all pool items
    this.notePool.forEach((item) => {
      item.inUse = false;
      item.noteId = null;
      item.sprite.visible = false;
    });

    this.feedbackPool.forEach((item) => {
      item.inUse = false;
      item.sprite.visible = false;
    });

    this.splashPool.forEach((item) => {
      item.inUse = false;
      item.sprite.visible = false;
    });
  }

  /**
   * Clean destruction (idempotent — safe under React StrictMode remounts).
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.ringResetTimer !== null) {
      window.clearTimeout(this.ringResetTimer);
      this.ringResetTimer = null;
    }
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.stageContainer = null;
    this.backgroundLayer = null;
    this.gameLayer = null;
    this.feedbackLayer = null;
    this.textures.clear();
    this.notePool = [];
    this.feedbackPool = [];
    this.splashPool = [];
    this.activeEvents = [];
  }
}
