import * as THREE from 'three';

/** Procedural canvas textures (no external assets). */

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit as THREE.CanvasTexture;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

/** Sci-fi hull plating: panel seams, bolts, subtle grime. 1 tile = 2m. */
export function hullTex(): THREE.CanvasTexture {
  return canvasTex('hull', 256, 256, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    // subtle tonal panels
    const panels = [
      [0, 0, 128, 96],
      [128, 0, 128, 160],
      [0, 96, 128, 160],
      [128, 160, 128, 96],
    ];
    for (const [x, y, pw, ph] of panels) {
      const v = 238 + Math.floor(Math.random() * 14);
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(x + 2, y + 2, pw - 4, ph - 4);
    }
    c.strokeStyle = 'rgba(40,46,60,0.55)';
    c.lineWidth = 3;
    for (const [x, y, pw, ph] of panels) c.strokeRect(x + 1.5, y + 1.5, pw - 3, ph - 3);
    // bolts
    c.fillStyle = 'rgba(40,46,60,0.45)';
    for (const [x, y, pw, ph] of panels) {
      for (const [bx, by] of [
        [x + 8, y + 8],
        [x + pw - 8, y + 8],
        [x + 8, y + ph - 8],
        [x + pw - 8, y + ph - 8],
      ]) {
        c.beginPath();
        c.arc(bx, by, 2.2, 0, Math.PI * 2);
        c.fill();
      }
    }
    // small vents
    c.fillStyle = 'rgba(40,46,60,0.35)';
    for (let i = 0; i < 5; i++) c.fillRect(150, 30 + i * 7, 40, 3);
    // grime at bottom
    const g = c.createLinearGradient(0, h * 0.75, 0, h);
    g.addColorStop(0, 'rgba(120,110,95,0)');
    g.addColorStop(1, 'rgba(120,110,95,0.18)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}

export function hazardTex(): THREE.CanvasTexture {
  return canvasTex('hazard', 128, 128, (c, w, h) => {
    c.fillStyle = '#ffc21a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a1c24';
    for (let i = -4; i < 8; i++) {
      c.beginPath();
      c.moveTo(i * 32, 0);
      c.lineTo(i * 32 + 16, 0);
      c.lineTo(i * 32 + 16 + h, h);
      c.lineTo(i * 32 + h, h);
      c.closePath();
      c.fill();
    }
  });
}

export function solarTex(): THREE.CanvasTexture {
  return canvasTex('solar', 128, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1b2f6e');
    g.addColorStop(1, '#10204f');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#8fa8e8';
    c.lineWidth = 1.5;
    for (let i = 0; i <= 8; i++) {
      c.beginPath();
      c.moveTo(i * 16, 0);
      c.lineTo(i * 16, h);
      c.stroke();
      c.beginPath();
      c.moveTo(0, i * 16);
      c.lineTo(w, i * 16);
      c.stroke();
    }
  });
}

export function containerTex(): THREE.CanvasTexture {
  return canvasTex('container', 128, 128, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0)';
      c.fillRect(i * 16, 0, 8, h);
    }
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 4;
    c.strokeRect(2, 2, w - 4, h - 4);
  });
}

export function gridFloorTex(): THREE.CanvasTexture {
  return canvasTex('grid', 128, 128, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(30,34,44,0.5)';
    c.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      c.beginPath();
      c.moveTo(i * 16, 0);
      c.lineTo(i * 16, h);
      c.stroke();
      c.beginPath();
      c.moveTo(0, i * 16);
      c.lineTo(w, i * 16);
      c.stroke();
    }
  });
}

/** Text/emblem decal (team logos, Pd-46 signs). */
export function labelTex(text: string, sub: string, bg: string, fg: string, w = 512, h = 256): THREE.CanvasTexture {
  return canvasTex('label|' + text + '|' + sub + '|' + bg + '|' + fg, w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = fg;
    c.lineWidth = 10;
    c.strokeRect(12, 12, w - 24, h - 24);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `bold ${Math.floor(h * 0.42)}px "Russo One", "Arial Black", sans-serif`;
    c.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) {
      c.font = `bold ${Math.floor(h * 0.16)}px "Russo One", "Arial Black", sans-serif`;
      c.fillText(sub, w / 2, h * 0.76);
    }
  });
}

/** Big Pd element tile (palladium, 46). */
export function palladiumTex(): THREE.CanvasTexture {
  return canvasTex('pd', 256, 256, (c, w, h) => {
    c.fillStyle = '#1d2a3a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#7ff0ff';
    c.lineWidth = 10;
    c.strokeRect(14, 14, w - 28, h - 28);
    c.fillStyle = '#7ff0ff';
    c.textAlign = 'center';
    c.font = 'bold 44px "Russo One", sans-serif';
    c.fillText('46', 62, 70);
    c.font = 'bold 120px "Russo One", sans-serif';
    c.fillText('Pd', w / 2, 175);
    c.font = 'bold 26px "Russo One", sans-serif';
    c.fillText('PALLADIUM', w / 2, 222);
  });
}

export function ventTex(): THREE.CanvasTexture {
  return canvasTex('vent', 64, 64, (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(20,24,34,0.6)';
    for (let i = 0; i < 6; i++) c.fillRect(6, 6 + i * 9, w - 12, 5);
  });
}
