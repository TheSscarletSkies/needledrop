// What's outside the window, as the light it lets in. The spotlight "cookie" is a small canvas that's
// redrawn about 15 times a second: a branch swaying in the breeze, raindrops gathering and running
// down the glass, or snow drifting through the sunbeam. Everything heavy (blurred panes, blurred
// leaves, soft sprites) is painted once up front, so a frame is just a handful of drawImage calls.
//
// Drawing happens in a 1024-unit space scaled onto a 512 px canvas.
import * as THREE from 'three';

const S = 512;
const K = S / 1024;
const PANES = [[250, 200], [530, 200], [250, 520], [530, 520]];
const PANE_W = 250;
const PANE_H = 290;
const FPS = 15;

export const WEATHERS = ['breeze', 'rain', 'snow', 'still'];

function canvas(w = S, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function paneLayer() {
  const [c, ctx] = canvas();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.filter = `blur(${10 * K}px)`;
  ctx.fillStyle = '#fff';
  for (const [x, y] of PANES) ctx.fillRect(x * K, y * K, PANE_W * K, PANE_H * K);
  return c;
}

// The branch, split in two: the stiff limbs, and the twigs and leaves that move more.
function branchLayers() {
  const layers = [canvas(), canvas()];
  for (const [, ctx] of layers) {
    ctx.scale(K, K);
    ctx.filter = `blur(${5 * K}px)`;
    ctx.fillStyle = ctx.strokeStyle = '#000';
  }
  const rand = rng(8);
  const branch = (x, y, angle, len, depth) => {
    const ctx = layers[depth >= 3 ? 0 : 1][1];
    const x2 = x + Math.cos(angle) * len, y2 = y + Math.sin(angle) * len;
    ctx.lineWidth = Math.max(2, depth * 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + x2) / 2 + (rand() - 0.5) * 40, (y + y2) / 2 + (rand() - 0.5) * 40, x2, y2);
    ctx.stroke();
    const leaves = 4 + Math.floor(rand() * 5);
    const leafCtx = layers[1][1]; // every leaf flutters
    for (let i = 0; i < leaves; i++) {
      const t = rand();
      const lx = x + (x2 - x) * t, ly = y + (y2 - y) * t;
      const side = rand() > 0.5 ? 1 : -1;
      leafCtx.save();
      leafCtx.translate(lx, ly);
      leafCtx.rotate(angle + side * (0.6 + rand() * 0.6));
      leafCtx.beginPath();
      leafCtx.ellipse(26, 0, 30 + rand() * 18, 9 + rand() * 6, 0, 0, Math.PI * 2);
      leafCtx.fill();
      leafCtx.restore();
    }
    if (depth > 1) {
      branch(x2, y2, angle - 0.4 - rand() * 0.3, len * 0.7, depth - 1);
      branch(x2, y2, angle + 0.3 + rand() * 0.3, len * 0.65, depth - 1);
    }
  };
  branch(80, 120, 0.55, 230, 4);
  return layers.map(([c]) => c);
}

// A raindrop on glass: a soft shadow ring, and the bright spot where it focuses light, just below.
function dropSprite() {
  const N = 64;
  const [c, ctx] = canvas(N);
  const ring = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  ring.addColorStop(0, 'rgba(0,0,0,0.25)');
  ring.addColorStop(0.65, 'rgba(0,0,0,0.6)');
  ring.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, N, N);
  const cx = N / 2, cy = N * 0.6;
  const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, N * 0.2);
  spot.addColorStop(0, 'rgba(255,255,255,0.95)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, N, N);
  return c;
}

// A snowflake's shadow: a soft dark dot.
function flakeSprite() {
  const N = 32;
  const [c, ctx] = canvas(N);
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.4, 'rgba(0,0,0,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  return c;
}

// Frost creeping in from the corners of each pane: it scatters light, so the corners dim softly.
function frostLayer() {
  const [c, ctx] = canvas();
  ctx.scale(K, K);
  const rand = rng(31);
  for (const [x, y] of PANES) {
    for (const [cx, cy] of [[x, y], [x + PANE_W, y], [x, y + PANE_H], [x + PANE_W, y + PANE_H]]) {
      const r = 70 + rand() * 50 + (cy > y ? 30 : 0); // more frost settles at the bottom
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    // crystalline speckle along the bottom edge
    for (let i = 0; i < 160; i++) {
      const px = x + rand() * PANE_W, py = y + PANE_H - (rand() ** 2) * 60;
      ctx.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.15})`;
      ctx.fillRect(px, py, 2 + rand() * 3, 2 + rand() * 3);
    }
  }
  return c;
}

// How the light itself changes: rain greys and dims it, snow makes it cool and clear.
const LIGHT = {
  breeze: { tint: null, amount: 0, intensity: 1 },
  still: { tint: null, amount: 0, intensity: 1 },
  rain: { tint: new THREE.Color(0xa9b8cc), amount: 0.55, intensity: 0.6 },
  snow: { tint: new THREE.Color(0xdde7ff), amount: 0.8, intensity: 1.15 },
};
// How hard the wind blows the branch.
const WIND = { breeze: 1, rain: 1.7, snow: 0.45, still: 0 };

export class WindowWeather {
  kind = 'breeze';
  t = 0;
  #since = 1;

  constructor() {
    [this.canvas, this.ctx] = canvas();
    this.panes = paneLayer();
    [this.limbs, this.twigs] = branchLayers();
    this.dropImg = dropSprite();
    this.flakeImg = flakeSprite();
    this.frost = frostLayer();
    this.rand = rng(77);
    this.drops = [];
    this.flakes = [];
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.#draw();
  }

  get animated() { return this.kind !== 'still'; }

  set(kind) {
    this.kind = WEATHERS.includes(kind) ? kind : 'breeze';
    this.drops = [];
    this.flakes = [];
    if (this.kind === 'rain') for (let i = 0; i < 70; i++) this.#spawnDrop(true);
    if (this.kind === 'snow') for (let i = 0; i < 190; i++) this.flakes.push(this.#flake(true));
    this.#draw();
  }

  // Tint and dim a base light colour/intensity for the current weather.
  light(baseColor, baseIntensity) {
    const l = LIGHT[this.kind];
    const color = new THREE.Color(baseColor);
    if (l.tint) color.lerp(l.tint, l.amount);
    return { color, intensity: baseIntensity * l.intensity };
  }

  /** Advance the weather; returns true when the cookie was redrawn (so the frame must render). */
  update(dt) {
    if (!this.animated) return false;
    this.t += dt;
    this.#since += dt;
    if (this.#since < 1 / FPS) return false;
    const step = Math.min(this.#since, 0.2);
    this.#since = 0;
    if (this.kind === 'rain') this.#rain(step);
    if (this.kind === 'snow') this.#snow(step);
    this.#draw();
    return true;
  }

  // ---- rain ----
  #spawnDrop(anywhere = false) {
    const pane = PANES[Math.floor(this.rand() * PANES.length)];
    const r = 2 + this.rand() ** 2.5 * 8; // mostly fine drops, a few fat ones
    this.drops.push({
      pane, r,
      x: pane[0] + 8 + this.rand() * (PANE_W - 16),
      sx: 0.85 + this.rand() * 0.3, // no two drops quite round
      y: pane[1] + 6 + this.rand() * (anywhere ? PANE_H - 12 : PANE_H * 0.85),
      vy: 0, running: false, stall: 0, age: 0,
    });
  }

  #rain(dt) {
    const rand = this.rand;
    // New drops land; the glass fills up to a point.
    const land = dt * 22;
    for (let i = 0; i < land; i++) if (this.drops.length < 150 && rand() < land - i) this.#spawnDrop();
    const trails = [];
    for (const d of this.drops) {
      d.age += dt;
      // A drop that collects enough water lets go and runs, stopping and starting as it goes.
      if (!d.running && d.r > 7.5 && rand() < dt * 0.25) d.running = true;
      if (!d.running) { d.r = Math.min(10, d.r + dt * 0.12); continue; }
      if (d.stall > 0) { d.stall -= dt; d.vy *= 0.6; } else if (rand() < dt * 0.9) d.stall = 0.2 + rand() * 0.6;
      else d.vy = Math.min(d.vy + 260 * dt, 160);
      const dy = d.vy * dt;
      d.y += dy;
      d.x += (rand() - 0.5) * dt * 30;
      // ...leaving a beaded trail behind it.
      if (dy > 0 && rand() < dt * 2.5) trails.push({ pane: d.pane, x: d.x, y: d.y - d.r * 1.5, r: d.r * (0.25 + rand() * 0.2), vy: 0, running: false, stall: 0, age: 0 });
      // Running drops swallow the small ones in their path.
      for (const o of this.drops) {
        if (o !== d && !o.running && !o.gone && Math.abs(o.x - d.x) < d.r && o.y > d.y - d.r && o.y < d.y + d.r) {
          o.gone = true;
          d.r = Math.min(11, Math.hypot(d.r, o.r * 0.5));
        }
      }
      if (d.y > d.pane[1] + PANE_H - 4) d.gone = true;
    }
    // Trails dry out after a while.
    this.drops = this.drops.filter((d) => !d.gone && !(d.r < 3 && d.age > 3 && rand() < dt * 0.6)).concat(trails);
  }

  // ---- snow ----
  #flake(anywhere) {
    const depth = this.rand(); // 0 far (small, sharp), 1 near (big, soft, faint)
    return {
      x: this.rand() * 1100 - 40,
      y: anywhere ? this.rand() * 1024 : -20 - this.rand() * 60,
      size: 6 + depth * 18,
      alpha: 0.75 - depth * 0.45,
      vy: 25 + (1 - depth) * 10 + depth * 45,
      phase: this.rand() * Math.PI * 2,
      sway: 8 + this.rand() * 18,
    };
  }

  #snow(dt) {
    for (const f of this.flakes) {
      f.y += f.vy * dt;
      f.x += Math.sin(this.t * 0.9 + f.phase) * f.sway * dt + 6 * dt;
      if (f.y > 1060) Object.assign(f, this.#flake(false));
    }
  }

  // ---- compose ----
  #sway() {
    const w = WIND[this.kind];
    const t = this.t;
    // Two slow swells plus the odd gust.
    const gust = Math.max(0, Math.sin(t * 0.21) - 0.6) * 2.5;
    const base = (Math.sin(t * 0.55) * 0.018 + Math.sin(t * 1.3 + 1.2) * 0.008) * (1 + gust) * w;
    const flutter = (Math.sin(t * 2.7) * 0.006 + Math.sin(t * 4.3 + 0.7) * 0.004) * (1 + gust * 1.5) * w;
    return [base, base * 1.6 + flutter];
  }

  #draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.panes, 0, 0);
    if (this.kind === 'snow') ctx.drawImage(this.frost, 0, 0);

    if (this.kind === 'rain') {
      ctx.setTransform(K, 0, 0, K, 0, 0);
      ctx.save();
      ctx.beginPath();
      for (const [x, y] of PANES) ctx.rect(x, y, PANE_W, PANE_H);
      ctx.clip();
      // Rain falling outside: faint fast streaks crossing the beam.
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 46; i++) {
        const x = ((i * 97.3 + this.t * 40) % 1100) - 40;
        const y = ((i * 211.7 + this.t * 900) % 1150) - 80;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 6, y + 55);
      }
      ctx.stroke();
      for (const d of this.drops) {
        const s = d.r * 2.4;
        const stretch = d.running ? 1 + Math.min(d.vy / 160, 1) * 0.5 : 1;
        const w = s * (d.sx || 1);
        ctx.drawImage(this.dropImg, d.x - w / 2, d.y - (s * stretch) / 2, w, s * stretch);
      }
      ctx.restore();
    }

    // The branch sways from where it enters the frame.
    const [a1, a2] = this.#sway();
    const px = 80 * K, py = 120 * K;
    for (const [img, a] of [[this.limbs, a1], [this.twigs, a2]]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.translate(-px, -py);
      ctx.drawImage(img, 0, 0);
    }

    if (this.kind === 'snow') {
      ctx.setTransform(K, 0, 0, K, 0, 0);
      for (const f of this.flakes) {
        ctx.globalAlpha = f.alpha;
        ctx.drawImage(this.flakeImg, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.texture.needsUpdate = true;
  }
}
