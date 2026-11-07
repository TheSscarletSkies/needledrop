// The wall behind the sideboard, and the window light falling across it.
// The window is never seen — only its light: panes, mullions, the leaves of a plant outside and the
// weather, projected by a spotlight "cookie" so they fall on the wall, the deck and the table alike.
import * as THREE from 'three';
import { WindowWeather } from './weather.js';

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

export const ROOM_THEMES = {
  dark: { wall: '#3a2a21', windowColor: 0xffd2a3, windowIntensity: 240000 },
  light: { wall: '#dcd4c9', windowColor: 0xffe7cc, windowIntensity: 60000 },
};

// Where the sun is and what colour its light is, through the day. The window light moves with it:
// a high morning sun throws the panes low on the wall, golden hour stretches them up and warm.
// At night there's only cool moonlight at the window (the lamp in the room is the key light).
export const TIMES = {
  morning: { color: 0xfff1de, k: 0.8, pos: [62, 112, 52], target: [6, 8] },
  day: { color: null, k: 1, pos: [80, 70, 40], target: [4, 16] },
  golden: { color: 0xffa25a, k: 1.3, pos: [108, 44, 30], target: [-2, 10] },
  night: { color: 0x8ea7d8, k: 0.17, pos: [72, 92, 40], target: [4, 10] },
};
export function timeNow(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  return h >= 5.5 && h < 10 ? 'morning' : h >= 10 && h < 16.5 ? 'day' : h >= 16.5 && h < 19.5 ? 'golden' : 'night';
}

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
    this.weather = new WindowWeather();
    this.window.map = this.weather.texture;
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
    this.theme = t;
    this.#paint();
    this.#applyLight();
  }

  // Paint the wall any colour (null = the room's own). The window light and plaster stay the same.
  setWallColor(hex) {
    this.wallColor = hex || null;
    this.#paint();
  }

  #paint() {
    const color = this.wallColor || this.theme?.wall;
    if (!color || color === this.painted) return;
    this.painted = color;
    this.wallMat.map?.dispose();
    this.wallMat.map = plasterTexture(color);
    this.wallMat.needsUpdate = true;
  }

  setWeather(kind) {
    this.weather.set(kind);
    this.#applyLight();
  }

  setTime(name) {
    this.time = TIMES[name] || TIMES.day;
    this.window.position.set(...this.time.pos);
    this.window.target.position.set(this.time.target[0], this.time.target[1], WALL_Z);
    this.#applyLight();
  }

  #applyLight() {
    if (!this.theme) return;
    const time = this.time || TIMES.day;
    const base = new THREE.Color(this.theme.windowColor);
    if (time.color !== null) base.lerp(new THREE.Color(time.color), 0.75);
    const { color, intensity } = this.weather.light(base, this.theme.windowIntensity * time.k);
    this.window.color.copy(color);
    this.window.intensity = intensity;
  }

  /** Returns true when the window light changed this frame. */
  update(dt) { return this.weather.update(dt); }
}
