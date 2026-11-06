// The wall behind the sideboard, and the window light falling across it.
// The window is never seen — only its light: panes, mullions and the leaves of a plant outside,
// projected by a spotlight "cookie" so they fall on the wall, the deck and the table alike.
import * as THREE from 'three';

const WALL_Z = -34;

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Lime plaster: low-contrast trowel marks and pores.
function plasterTexture(color) {
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
  const rand = rng(21);
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, r = 30 + rand() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.5;
    g.addColorStop(0, light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 7;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.5);
  return t;
}

// The light cookie: four window panes with soft mullions, and a leafy branch across them.
function windowCookie() {
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = '#fff';
  const panes = [[250, 200], [530, 200], [250, 520], [530, 520]];
  for (const [x, y] of panes) ctx.fillRect(x, y, 250, 290);

  // Branch with leaves, from the upper left.
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  const rand = rng(8);
  const branch = (x, y, angle, len, depth) => {
    const x2 = x + Math.cos(angle) * len, y2 = y + Math.sin(angle) * len;
    ctx.lineWidth = Math.max(2, depth * 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + x2) / 2 + (rand() - 0.5) * 40, (y + y2) / 2 + (rand() - 0.5) * 40, x2, y2);
    ctx.stroke();
    const leaves = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < leaves; i++) {
      const t = rand();
      const lx = x + (x2 - x) * t, ly = y + (y2 - y) * t;
      const side = rand() > 0.5 ? 1 : -1;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(angle + side * (0.6 + rand() * 0.6));
      ctx.beginPath();
      ctx.ellipse(26, 0, 30 + rand() * 18, 9 + rand() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (depth > 1) {
      branch(x2, y2, angle - 0.4 - rand() * 0.3, len * 0.7, depth - 1);
      branch(x2, y2, angle + 0.3 + rand() * 0.3, len * 0.65, depth - 1);
    }
  };
  branch(80, 120, 0.55, 230, 4);
  ctx.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const ROOM_THEMES = {
  dark: { wall: '#3a2a21', windowColor: 0xffd2a3, windowIntensity: 240000 },
  light: { wall: '#dcd4c9', windowColor: 0xffe7cc, windowIntensity: 60000 },
};

export class Room {
  constructor(scene, tableY) {
    this.wallMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(600, 260), this.wallMat);
    wall.position.set(0, tableY + 130, WALL_Z);
    wall.receiveShadow = true;
    scene.add(wall);
    this.wall = wall;

    // Low afternoon sun from the front right, through a window we never see.
    this.window = new THREE.SpotLight(0xffd9b0, 26000, 0, 0.3, 0.3, 2);
    // Aimed above the deck so it lands on the wall rather than bleaching the record.
    this.window.position.set(80, 70, 40);
    this.window.target.position.set(4, 16, WALL_Z);
    this.window.map = windowCookie();
    this.window.castShadow = true;
    this.window.shadow.mapSize.set(2048, 2048);
    this.window.shadow.camera.near = 30;
    this.window.shadow.camera.far = 260;
    this.window.shadow.bias = -0.0004;
    this.window.shadow.radius = 4;
    scene.add(this.window, this.window.target);
  }

  setTheme(name) {
    const t = ROOM_THEMES[name] || ROOM_THEMES.dark;
    this.wallMat.map?.dispose();
    this.wallMat.map = plasterTexture(t.wall);
    this.wallMat.needsUpdate = true;
    this.window.color.set(t.windowColor);
    this.window.intensity = t.windowIntensity;
  }
}
