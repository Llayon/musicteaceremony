import { SpritesheetManifest } from '../types';

/**
 * Exact pixel frame coordinates in the 512x512 pixel-art texture atlas
 */
export const SPRITESHEET_MANIFEST: SpritesheetManifest = {
  meta: {
    image: 'zen_tea_spritesheet.png',
    size: { w: 512, h: 512 },
    scale: 1,
  },
  frames: {
    // Porcelain cup states (w: 64, h: 56)
    cup_empty: { x: 0, y: 0, w: 64, h: 56 },
    cup_half: { x: 64, y: 0, w: 64, h: 56 },
    cup_full: { x: 128, y: 0, w: 64, h: 56 },
    cup_happy: { x: 192, y: 0, w: 64, h: 56 },
    cup_miss: { x: 256, y: 0, w: 64, h: 56 },

    // 4-frame rising steam animation (w: 32, h: 48)
    steam_0: { x: 0, y: 64, w: 32, h: 48 },
    steam_1: { x: 32, y: 64, w: 32, h: 48 },
    steam_2: { x: 64, y: 64, w: 32, h: 48 },
    steam_3: { x: 96, y: 64, w: 32, h: 48 },

    // Flying tea notes / droplets (w: 24, h: 24)
    tea_drop: { x: 140, y: 64, w: 24, h: 24 },
    tea_drop_golden: { x: 168, y: 64, w: 24, h: 24 },

    // Splash animation frames (w: 48, h: 28)
    splash_0: { x: 200, y: 64, w: 48, h: 28 },
    splash_1: { x: 248, y: 64, w: 48, h: 28 },
    splash_2: { x: 296, y: 64, w: 48, h: 28 },

    // Bamboo tea ladle / teapot (w: 80, h: 40)
    bamboo_ladle: { x: 0, y: 120, w: 80, h: 40 },
    bamboo_ladle_pour: { x: 80, y: 120, w: 80, h: 40 },

    // Hit rating plates (w: 96, h: 28)
    plate_perfect: { x: 0, y: 170, w: 96, h: 28 },
    plate_good: { x: 100, y: 170, w: 96, h: 28 },
    plate_miss: { x: 200, y: 170, w: 96, h: 28 },

    // Tatami / wooden table texture tile (w: 64, h: 32)
    tatami_tile: { x: 0, y: 210, w: 64, h: 32 },
  },
};

/**
 * Procedurally generates the 512x512 retro pixel-art spritesheet canvas
 * Ensures crisp pixel rendering with scaleMode: 'nearest'
 */
export function generateSpritesheetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = false;

  // Helper for pixel drawing
  const fillRect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  };

  // Helper for pixel circles
  const fillCircle = (cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // 1. Cup Empty (64x56) at (0, 0)
  const drawCupBase = (ox: number, oy: number, teaLevel: number, face?: 'happy' | 'miss') => {
    // Cup shadow
    ctx.fillStyle = 'rgba(20, 15, 10, 0.25)';
    ctx.beginPath();
    ctx.ellipse(ox + 32, oy + 51, 24, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Porcelain outer body (Ivory white)
    ctx.fillStyle = '#F4F1EA';
    ctx.beginPath();
    ctx.moveTo(ox + 10, oy + 12);
    ctx.quadraticCurveTo(ox + 8, oy + 46, ox + 22, oy + 48);
    ctx.lineTo(ox + 42, oy + 48);
    ctx.quadraticCurveTo(ox + 56, oy + 46, ox + 54, oy + 12);
    ctx.closePath();
    ctx.fill();

    // Cup base foot
    fillRect(ox + 22, oy + 48, 20, 3, '#D9D3C7');

    // Traditional Japanese blue ceramic wave lines (Sometsuke)
    ctx.strokeStyle = '#2B5B84';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + 16, oy + 32);
    ctx.quadraticCurveTo(ox + 24, oy + 28, ox + 32, oy + 32);
    ctx.quadraticCurveTo(ox + 40, oy + 36, ox + 48, oy + 32);
    ctx.stroke();

    // Cup rim (oval)
    ctx.fillStyle = '#E8E2D5';
    ctx.beginPath();
    ctx.ellipse(ox + 32, oy + 12, 22, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner rim hole
    ctx.fillStyle = '#3A332C';
    ctx.beginPath();
    ctx.ellipse(ox + 32, oy + 12, 19, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Liquid if any (Matcha green)
    if (teaLevel > 0) {
      const greenColor = teaLevel >= 1 ? '#567D46' : '#6E9855';
      ctx.fillStyle = greenColor;
      ctx.beginPath();
      ctx.ellipse(ox + 32, oy + 12, 17 * Math.min(1, teaLevel), 4.5 * Math.min(1, teaLevel), 0, 0, Math.PI * 2);
      ctx.fill();

      // Matcha foam bubbles
      ctx.fillStyle = '#9BBA78';
      fillCircle(ox + 36, oy + 11, 1.5, '#AECB8B');
      fillCircle(ox + 28, oy + 13, 1.2, '#AECB8B');
    }

    // Facial expressions (Rhythm Heaven cute minimal eyes)
    if (face === 'happy') {
      ctx.strokeStyle = '#23201D';
      ctx.lineWidth = 2;
      // Arc eyes ^ ^
      ctx.beginPath();
      ctx.arc(ox + 25, oy + 26, 3, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ox + 39, oy + 26, 3, Math.PI, 0);
      ctx.stroke();
      // Cheeks
      ctx.fillStyle = 'rgba(230, 110, 110, 0.45)';
      ctx.beginPath();
      ctx.arc(ox + 20, oy + 29, 3, 0, Math.PI * 2);
      ctx.arc(ox + 44, oy + 29, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (face === 'miss') {
      ctx.fillStyle = '#23201D';
      // Dot eyes
      fillCircle(ox + 25, oy + 26, 2, '#23201D');
      fillCircle(ox + 39, oy + 26, 2, '#23201D');
      // Wavy mouth
      ctx.strokeStyle = '#23201D';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox + 29, oy + 32);
      ctx.lineTo(ox + 32, oy + 30);
      ctx.lineTo(ox + 35, oy + 32);
      ctx.stroke();
    }
  };

  // Draw cups
  drawCupBase(0, 0, 0); // Empty
  drawCupBase(64, 0, 0.5); // Half
  drawCupBase(128, 0, 1.0); // Full
  drawCupBase(192, 0, 1.0, 'happy'); // Happy
  drawCupBase(256, 0, 0.2, 'miss'); // Miss

  // 2. Steam Animation (4 frames, 32x48 each) at (0, 64), (32, 64), (64, 64), (96, 64)
  const drawSteam = (ox: number, oy: number, frame: number) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    const phase = (frame * Math.PI) / 2;
    // Main rising spiral
    ctx.beginPath();
    ctx.moveTo(ox + 16, oy + 42);
    ctx.bezierCurveTo(
      ox + 16 + Math.sin(phase) * 6,
      oy + 30,
      ox + 16 - Math.cos(phase) * 8,
      oy + 18,
      ox + 16 + Math.sin(phase + 1) * 7,
      oy + 6
    );
    ctx.stroke();

    // Side secondary vapor wisps
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + 10, oy + 38);
    ctx.quadraticCurveTo(ox + 8 - Math.sin(phase) * 4, oy + 26, ox + 11, oy + 16);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ox + 22, oy + 38);
    ctx.quadraticCurveTo(ox + 24 + Math.cos(phase) * 4, oy + 26, ox + 21, oy + 14);
    ctx.stroke();
    ctx.restore();
  };

  drawSteam(0, 64, 0);
  drawSteam(32, 64, 1);
  drawSteam(64, 64, 2);
  drawSteam(96, 64, 3);

  // 3. Tea Droplets (24x24)
  // Green Jade Droplet at (140, 64)
  const drawDrop = (ox: number, oy: number, mainColor: string, rimColor: string) => {
    ctx.save();
    ctx.fillStyle = mainColor;
    ctx.beginPath();
    ctx.moveTo(ox + 12, oy + 3);
    ctx.quadraticCurveTo(ox + 3, oy + 14, ox + 5, oy + 18);
    ctx.quadraticCurveTo(ox + 8, oy + 22, ox + 12, oy + 22);
    ctx.quadraticCurveTo(ox + 16, oy + 22, ox + 19, oy + 18);
    ctx.quadraticCurveTo(ox + 21, oy + 14, ox + 12, oy + 3);
    ctx.fill();

    // Rim highlight
    ctx.fillStyle = rimColor;
    ctx.beginPath();
    ctx.ellipse(ox + 10, oy + 14, 2.5, 5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  drawDrop(140, 64, '#4E8337', '#A1D37E');
  drawDrop(168, 64, '#D4A017', '#FFE882'); // Golden drop

  // 4. Splashes (48x28 each)
  const drawSplash = (ox: number, oy: number, scale: number) => {
    ctx.save();
    ctx.strokeStyle = '#5E9346';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#6E9855';

    // Center ripple ring
    ctx.beginPath();
    ctx.ellipse(ox + 24, oy + 18, 16 * scale, 5 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Spurt droplets
    fillCircle(ox + 12 - 4 * scale, oy + 12 - 6 * scale, 2.5 * scale, '#5E9346');
    fillCircle(ox + 36 + 4 * scale, oy + 12 - 6 * scale, 2.5 * scale, '#5E9346');
    fillCircle(ox + 24, oy + 6 - 4 * scale, 3 * scale, '#82AB63');
    ctx.restore();
  };

  drawSplash(200, 64, 0.6);
  drawSplash(248, 64, 1.0);
  drawSplash(296, 64, 1.3);

  // 5. Bamboo Ladle (Hishaku) (80x40) at (0, 120) and (80, 120)
  const drawLadle = (ox: number, oy: number, angleRad: number) => {
    ctx.save();
    ctx.translate(ox + 40, oy + 20);
    ctx.rotate(angleRad);

    // Long bamboo handle
    ctx.fillStyle = '#C8A97E';
    ctx.fillRect(-35, -2.5, 60, 5);
    // Bamboo joints
    ctx.fillStyle = '#8B6A47';
    ctx.fillRect(-15, -3.5, 2, 7);
    ctx.fillRect(10, -3.5, 2, 7);

    // Bamboo cup cylinder
    ctx.fillStyle = '#B49366';
    ctx.fillRect(20, -12, 16, 24);
    ctx.fillStyle = '#8B6A47';
    ctx.fillRect(20, -12, 16, 3);
    ctx.fillRect(20, 9, 16, 3);

    ctx.restore();
  };

  drawLadle(0, 120, -0.15); // Resting
  drawLadle(80, 120, 0.45); // Pouring

  // 6. Hit Rating Plates (96x28)
  const drawPlate = (
    ox: number,
    oy: number,
    text: string,
    bgGrad1: string,
    bgGrad2: string,
    textColor: string,
    borderColor: string
  ) => {
    ctx.save();
    // Shadow
    fillRect(ox + 2, oy + 2, 92, 24, 'rgba(0, 0, 0, 0.35)');

    // Gradient plate body
    const grad = ctx.createLinearGradient(ox, oy, ox, oy + 24);
    grad.addColorStop(0, bgGrad1);
    grad.addColorStop(1, bgGrad2);
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, 92, 24);

    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, 90, 22);

    // Typography (Bold crisp pixel style)
    ctx.font = 'bold 14px monospace, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(text, ox + 46 + 1, oy + 12 + 1);

    // Text main
    ctx.fillStyle = textColor;
    ctx.fillText(text, ox + 46, oy + 12);

    ctx.restore();
  };

  // PERFECT: Gold / Sunrise sakura
  drawPlate(0, 170, 'PERFECT!', '#FCE786', '#E2A931', '#472E06', '#FFF3B3');
  // GOOD: Jade green
  drawPlate(100, 170, 'GOOD', '#84D984', '#3E9E47', '#083B0E', '#B7F5B7');
  // MISS: Slate muted
  drawPlate(200, 170, 'MISS...', '#8C8E94', '#555861', '#FFFFFF', '#D1D3D8');

  // 7. Tatami Tile (64x32) at (0, 210)
  ctx.fillStyle = '#7E8652';
  ctx.fillRect(0, 210, 64, 32);
  ctx.fillStyle = '#6E7643';
  for (let y = 210; y < 242; y += 4) {
    ctx.fillRect(0, y, 64, 1);
  }

  return canvas;
}
