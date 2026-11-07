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
    this.wallMat.map?.dispose();
    this.wallMat.map = plasterTexture(t.wall);
    this.wallMat.needsUpdate = true;
    this.theme = t;
    this.#applyLight();
  }

  setWeather(kind) {
    this.weather.set(kind);
    this.#applyLight();
  }

  #applyLight() {
    if (!this.theme) return;
    const { color, intensity } = this.weather.light(this.theme.windowColor, this.theme.windowIntensity);
    this.window.color.copy(color);
    this.window.intensity = intensity;
  }

  /** Returns true when the window light changed this frame. */
  update(dt) { return this.weather.update(dt); }
}
