// Procedural canvas textures. Everything visible on the deck is drawn here — no bitmaps ship with the app.
import * as THREE from 'three';

// Record geometry, in scene units (cm). A 12" LP is 30.5 cm across.
export const RECORD = {
  radius: 15,
  flat: 14.72,       // flat playing surface ends here; the raised edge bead starts
  labelRadius: 5,
  leadIn: 14.55,     // where the stylus first lands
  runOut: 6.4,       // end of the last groove
};

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

function hashString(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const SERIF = "'Iowan Old Style', 'Palatino', Georgia, serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Average colour of an image, used for "colored vinyl" pressings.
export function dominantColor(img) {
  const [, ctx] = canvas(16);
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(trimLetterbox(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Crops near-black bars from the top/bottom (and sides) of an image, e.g. 4:3 video thumbnails.
function trimLetterbox(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const [c, ctx] = canvas(w, h);
  ctx.drawImage(img, 0, 0);
  let data;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch { return img; }
  const dark = (x0, y0, x1, y1) => {
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 4) {
      const i = (y * w + x) * 4;
      sum += data[i] + data[i + 1] + data[i + 2];
      n++;
    }
    return sum / n / 3 < 14;
  };
  let top = 0, bottom = h, left = 0, right = w;
  while (top < h * 0.3 && dark(0, top, w, top + 1)) top++;
  while (bottom > h * 0.7 && dark(0, bottom - 1, w, bottom)) bottom--;
  while (left < w * 0.3 && dark(left, top, left + 1, bottom)) left++;
  while (right > w * 0.7 && dark(right - 1, top, right, bottom)) right--;
  if (top < 3 && left < 3 && h - bottom < 3 && w - right < 3) return img;
  const [o, octx] = canvas(right - left, bottom - top);
  octx.drawImage(c, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return o;
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

// Text set along a circle, centred on `angle` (radians, 0 = 12 o'clock).
function arcText(ctx, text, cx, cy, r, angle, { inward = false } = {}) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = angle - (total / r) / 2 * (inward ? -1 : 1);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const step = widths[i] / r;
    a += (step / 2) * (inward ? -1 : 1);
    ctx.save();
    ctx.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.rotate(inward ? a + Math.PI : a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += (step / 2) * (inward ? -1 : 1);
  });
  ctx.restore();
}

/**
 * The record's playing face. Returns colour, roughness and an anisotropy map whose
 * per-pixel direction runs along the grooves, so highlights fan out radially like real vinyl.
 */
export function makeRecordTextures({ img, vinyl, track }) {
  const SIZE = 2048;
  const seed = hashString(`${track?.title}|${track?.artist}`);
  const rand = rng(seed);
  const cx = SIZE / 2;
  const px = SIZE / 2 / RECORD.flat; // the face texture spans the flat area
  const [c, ctx] = canvas(SIZE);
  const [rc, rctx] = canvas(SIZE);

  const hsl = vinyl.getHSL({});
  const shade = (dl, a = 1) => `hsla(${hsl.h * 360},${hsl.s * 100}%,${Math.max(0, Math.min(100, (hsl.l + dl) * 100))}%,${a})`;

  ctx.fillStyle = shade(0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  rctx.fillStyle = 'rgb(70,70,70)';
  rctx.fillRect(0, 0, SIZE, SIZE);

  // Track gaps: the smooth, glossier bands between songs.
  const gaps = [];
  const nGaps = 3 + Math.floor(rand() * 5);
  for (let i = 0; i < nGaps; i++) gaps.push(RECORD.runOut + 0.8 + rand() * (RECORD.leadIn - RECORD.runOut - 1.6));
  const inGap = (r) => gaps.some((g) => Math.abs(r - g) < 0.07);

  // Grooves: dense rings with modulation, the way loud passages read wider.
  let loud = 0.5;
  for (let r = RECORD.runOut; r <= RECORD.leadIn; r += 0.012) {
    loud += (rand() - 0.5) * 0.15;
    loud = Math.max(0.15, Math.min(1, loud));
    const gap = inGap(r);
    ctx.strokeStyle = gap ? shade(-0.02) : shade(0.012 + loud * 0.035, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cx, r * px, 0, Math.PI * 2);
    ctx.stroke();
    const rough = gap ? 22 : 62 + loud * 30;
    rctx.strokeStyle = `rgb(${rough},${rough},${rough})`;
    rctx.lineWidth = 1.4;
    rctx.beginPath();
    rctx.arc(cx, cx, r * px, 0, Math.PI * 2);
    rctx.stroke();
  }

  // Lead-in and dead wax (run-out) are mirror-smooth.
  const band = (from, to, style) => {
    rctx.fillStyle = style;
    rctx.beginPath();
    rctx.arc(cx, cx, to * px, 0, Math.PI * 2);
    rctx.arc(cx, cx, from * px, 0, Math.PI * 2, true);
    rctx.fill();
  };
  band(RECORD.leadIn, RECORD.flat, 'rgb(26,26,26)');
  band(RECORD.labelRadius, RECORD.runOut, 'rgb(20,20,20)');

  // Hand-etched matrix number in the dead wax.
  const matrix = `ND-${String(seed % 9000 + 1000)}-A1  ·  △ ${String.fromCharCode(65 + (seed % 26))}`;
  ctx.font = `italic ${0.24 * px}px ${SERIF}`;
  ctx.fillStyle = shade(0.09, 0.55);
  arcText(ctx, matrix, cx, cx, (RECORD.labelRadius + 0.75) * px, ((seed % 360) * Math.PI) / 180);
  rctx.font = ctx.font;
  rctx.fillStyle = 'rgb(120,120,120)';
  arcText(rctx, matrix, cx, cx, (RECORD.labelRadius + 0.75) * px, ((seed % 360) * Math.PI) / 180);

  // Label
  const lr = RECORD.labelRadius * px;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cx, lr, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    drawCover(ctx, img, cx - lr, cx - lr, lr * 2, lr * 2);
  } else {
    drawBlankLabel(ctx, cx, lr, seed, track);
  }
  paperGrain(ctx, cx - lr, cx - lr, lr * 2, lr * 2, seed);
  ctx.restore();
  rctx.fillStyle = 'rgb(215,215,215)'; // paper is matte
  rctx.beginPath();
  rctx.arc(cx, cx, lr, 0, Math.PI * 2);
  rctx.fill();

  // Spindle hole
  ctx.fillStyle = '#050505';
  ctx.beginPath();
  ctx.arc(cx, cx, 0.37 * px, 0, Math.PI * 2);
  ctx.fill();

  const map = tex(c);
  const roughnessMap = tex(rc, false);
  map.anisotropy = roughnessMap.anisotropy = 16;
  return { map, roughnessMap, anisotropyMap: grooveAnisotropy(gaps) };
}

function drawBlankLabel(ctx, cx, lr, seed, track) {
  const hue = seed % 360;
  ctx.fillStyle = `hsl(${hue},38%,58%)`;
  ctx.fillRect(cx - lr, cx - lr, lr * 2, lr * 2);
  const ink = `hsl(${hue},35%,16%)`;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = lr * 0.008;
  ctx.beginPath();
  ctx.arc(cx, cx, lr * 0.93, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `${lr * 0.055}px ${SANS}`;
  arcText(ctx, '℗ & © 2026 NEEDLEDROP RECORDS  ·  ALL RIGHTS OF THE MANUFACTURER AND OWNER RESERVED', cx, cx, lr * 0.86, Math.PI, { inward: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic ${lr * 0.13}px ${SERIF}`;
  ctx.fillText('Needledrop', cx, cx - lr * 0.55);
  ctx.font = `600 ${lr * 0.12}px ${SERIF}`;
  ctx.fillText(clip(ctx, track?.title || 'Side A', lr * 1.3), cx, cx - lr * 0.22);
  ctx.font = `${lr * 0.09}px ${SERIF}`;
  ctx.fillText(clip(ctx, track?.artist || '', lr * 1.3), cx, cx + lr * 0.36);
  ctx.font = `600 ${lr * 0.07}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('SIDE A', cx - lr * 0.7, cx + lr * 0.06);
  ctx.textAlign = 'right';
  ctx.fillText('33⅓ RPM', cx + lr * 0.7, cx + lr * 0.06);
  ctx.textAlign = 'center';
  ctx.font = `${lr * 0.055}px ${SANS}`;
  ctx.fillText('STEREO', cx, cx + lr * 0.58);
}

function clip(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function paperGrain(ctx, x, y, w, h, seed) {
  const rand = rng(seed + 1);
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#fff' : '#000';
    ctx.fillRect(x + rand() * w, y + rand() * h, 1.5, 1.5);
  }
  // Slight printing vignette + gloss falloff
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, w * 0.1, x + w / 2, y + h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.04)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Anisotropy map for a disc whose UVs are planar (u,v ∈ [0,1], centre 0.5).
 * RG = tangent direction in UV space, B = strength. Direction is the circle tangent (-v, u).
 */
function grooveAnisotropy(gaps = [], { label = true } = {}) {
  const S = 512;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = 0.5 - (y + 0.5) / S; // canvas is flipped into UV space
      const len = Math.hypot(u, v) || 1;
      const r = (len / 0.5) * RECORD.flat;
      let strength = 1;
      if (label && r < RECORD.labelRadius) strength = 0;
      else if (r < RECORD.runOut || r > RECORD.leadIn) strength = 0.35;
      else if (gaps.some((g) => Math.abs(r - g) < 0.07)) strength = 0.4;
      const i = (y * S + x) * 4;
      d[i] = ((-v / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((u / len) * 0.5 + 0.5) * 255;
      d[i + 2] = strength * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Circular brushing for turned metal (platter top, buttons, counterweight face).
let turnedMetal;
export function turnedMetalAnisotropy() {
  turnedMetal ||= grooveAnisotropy([], { label: false });
  return turnedMetal;
}

// ---- deck finishes -------------------------------------------------------
export const FINISHES = {
  walnut: { label: 'Walnut', base: '#4f311d', grain: '#2c190c', metal: '#cfcac2', felt: '#2a2a2a', ink: '#e9e2d6', lacquer: 0.5, roughness: 0.5, theme: 'dark' },
  oak:    { label: 'Light oak', base: '#c39c6c', grain: '#9a7447', metal: '#d8d3cb', felt: '#3a3836', ink: '#2b231c', lacquer: 0.35, roughness: 0.55, theme: 'light' },
  ebony:  { label: 'Matte black', base: '#1b1a19', grain: null, metal: '#8d8a86', felt: '#151515', ink: '#d9d4cc', lacquer: 0, roughness: 0.75, theme: 'dark' },
  chalk:  { label: 'Chalk white', base: '#e5e0d7', grain: null, metal: '#b9b4ac', felt: '#3b3b3b', ink: '#3a3530', lacquer: 0.3, roughness: 0.5, theme: 'light' },
  blush:  { label: 'Blush', base: '#dcaa9f', grain: null, metal: '#d6c0b6', felt: '#efd9d2', ink: '#6b3f37', lacquer: 0.3, roughness: 0.5, theme: 'light' },
};

// A finish from any colour. The value is '#rrggbb' for a smooth lacquered deck, or '#rrggbb:wood'
// for veneer stained that colour (grain drawn in a darker shade of it). Ink, felt and trim are
// chosen to read against it.
export const HEX = /^#[0-9a-f]{6}$/i;
export function finishFor(value) {
  if (FINISHES[value]) return FINISHES[value];
  const [hex, kind] = String(value || '').split(':');
  if (!HEX.test(hex)) return FINISHES.walnut;
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  const light = lum > 0.22;
  const grain = kind === 'wood' ? `#${c.clone().multiplyScalar(0.45).getHexString()}` : null;
  return {
    label: kind === 'wood' ? 'Custom stain' : 'Custom', base: hex, grain,
    metal: light ? '#cfc9c1' : '#c9c4bc',
    felt: lum > 0.5 ? '#3a3836' : '#232323',
    ink: light ? `#${c.clone().multiplyScalar(0.28).getHexString()}` : '#ece5da',
    lacquer: kind === 'wood' ? 0.45 : 0.35, roughness: kind === 'wood' ? 0.5 : 0.45,
    theme: light ? 'light' : 'dark',
  };
}

export function makeWoodTexture(finish) {
  const [c, ctx] = canvas(1024);
  ctx.fillStyle = finish.base;
  ctx.fillRect(0, 0, 1024, 1024);
  const rand = rng(7);
  if (finish.grain) {
    // Flat-sawn veneer: long flowing lines with occasional cathedral arcs.
    for (let i = 0; i < 320; i++) {
      const y = rand() * 1100 - 40;
      ctx.strokeStyle = finish.grain;
      ctx.globalAlpha = 0.05 + rand() * 0.16;
      ctx.lineWidth = 0.5 + rand() * 2.2;
      ctx.beginPath();
      const amp = 4 + rand() * 14, freq = 0.003 + rand() * 0.004, ph = rand() * 6;
      ctx.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 16) ctx.lineTo(x, y + Math.sin(x * freq + ph) * amp + (rand() - 0.5) * 1.2);
      ctx.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const x0 = rand() * 1024, y0 = rand() * 1024;
      for (let j = 0; j < 9; j++) {
        ctx.globalAlpha = 0.06;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(x0, y0, 120 + j * 22, 12 + j * 7, 0, Math.PI * 0.05, Math.PI * 0.95);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  // Fine speckle for powder-coat / pore texture.
  const img = ctx.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * (finish.grain ? 6 : 9);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// Strobe dots for one row. `dots` evenly spaced around the rim.
export function makeStrobeRow(dots) {
  const [c, ctx] = canvas(4096, 32);
  ctx.fillStyle = '#c9c6c0';
  ctx.fillRect(0, 0, 4096, 32);
  ctx.fillStyle = '#26221f';
  const w = 4096 / dots;
  for (let i = 0; i < dots; i++) ctx.fillRect(i * w + w * 0.28, 6, w * 0.44, 20);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Counterweight tracking-force scale.
export function makeScaleRing() {
  const [c, ctx] = canvas(1024, 64);
  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(0, 0, 1024, 64);
  ctx.fillStyle = '#1b1b1b';
  ctx.strokeStyle = '#1b1b1b';
  ctx.font = `600 22px ${SANS}`;
  ctx.textAlign = 'center';
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * 1024;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, i % 10 === 0 ? 26 : i % 5 === 0 ? 18 : 11);
    ctx.stroke();
    if (i % 10 === 0 && i < 40) ctx.fillText(String(i / 10), x + 2, 52);
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * Silk-screened legend printed on the deck. Drawn in white with alpha; the material tints it,
 * so the same decal works on dark and light finishes.
 */
export function makeLegend(w, h, draw, scale = 64) {
  const [c, ctx] = canvas(Math.round(w * scale), Math.round(h * scale));
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  draw(ctx, c.width, c.height, { SANS, SERIF });
  return tex(c);
}

// Album jacket: printed art with ring wear and softened corners.
// The jacket a record comes in when it has no artwork of its own: a "house" sleeve, printed in
// two inks on a linen-embossed board. Clay board, a sunrise of grooves in blush and ochre,
// with the slight misregistration and ink speckle of a real press run.
const HOUSE = { board: '#6e3d36', cream: '#efe2cc', blush: '#e2a593', ochre: '#d4a04c', ink: '#2b1a16' };

function drawHouseSleeve(ctx, S, track) {
  const rand = rng(11);
  ctx.fillStyle = HOUSE.board;
  ctx.fillRect(0, 0, S, S);
  // Board fibre: faint light and dark flecks.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,240,225,0.05)' : 'rgba(20,6,4,0.07)';
    ctx.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1);
  }

  // The sunrise: a record half-risen over the lower edge, its grooves in alternating inks.
  const cx = S * 0.5, cy = S * 0.94;
  const print = (dx, dy, draw) => { ctx.save(); ctx.translate(dx, dy); draw(); ctx.restore(); };
  const bands = [[0.86, HOUSE.blush], [0.74, HOUSE.board], [0.7, HOUSE.ochre], [0.6, HOUSE.board], [0.57, HOUSE.blush],
    [0.46, HOUSE.board], [0.43, HOUSE.cream], [0.24, HOUSE.ochre], [0.09, HOUSE.board]];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, S * 0.9); // the "horizon": the sun sits on a ruled line
  ctx.clip();
  bands.forEach(([r, color], i) => {
    // Each ink is laid separately, so the blush and ochre sit a hair off register.
    const off = color === HOUSE.blush ? [3, -2] : color === HOUSE.ochre ? [-2, 2] : [0, 0];
    print(off[0], off[1], () => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, S * r * 0.5 * 1.08, Math.PI, 0);
      ctx.fill();
    });
    if (i === 6) { // fine grooves engraved through the cream band
      ctx.strokeStyle = 'rgba(110,61,54,0.35)';
      ctx.lineWidth = 1.2;
      for (let g = 0.25; g < 0.43; g += 0.012) { ctx.beginPath(); ctx.arc(cx, cy, S * g * 0.54, Math.PI, 0); ctx.stroke(); }
    }
  });
  ctx.restore();
  // Rays above the sun, in blush, thin and tapering.
  ctx.save();
  ctx.translate(cx + 3, cy - 2);
  ctx.fillStyle = HOUSE.blush;
  ctx.globalAlpha = 0.45;
  for (let a = -Math.PI * 0.94; a < -Math.PI * 0.05; a += Math.PI / 15) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(S * 0.5, -2.5);
    ctx.lineTo(S * 0.6, -0.8);
    ctx.lineTo(S * 0.6, 0.8);
    ctx.lineTo(S * 0.5, 2.5);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // The horizon rule.
  ctx.fillStyle = HOUSE.cream;
  ctx.fillRect(70, S * 0.9, S - 140, 3);

  // Type, in cream.
  ctx.fillStyle = HOUSE.cream;
  ctx.textAlign = 'left';
  ctx.font = `italic 58px ${SERIF}`;
  ctx.fillText('Needledrop', 70, 122);
  ctx.font = `600 15px ${SANS}`;
  ctx.letterSpacing = '5px';
  ctx.fillText('HIGH FIDELITY  ·  LONG PLAYING', 72, 158);
  // Stereo badge, top right.
  ctx.textAlign = 'center';
  ctx.strokeStyle = HOUSE.cream;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(S - 230, 82, 160, 64, 32);
  ctx.stroke();
  ctx.font = `700 22px ${SANS}`;
  ctx.letterSpacing = '6px';
  ctx.fillText('STEREO', S - 147, 123);
  ctx.letterSpacing = '0px';
  // Title and artist, set large over the sun.
  ctx.textAlign = 'left';
  ctx.font = `600 64px ${SERIF}`;
  ctx.fillText(clip(ctx, track?.title || 'Long Playing Record', S - 140), 70, 300);
  ctx.font = `italic 40px ${SERIF}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(clip(ctx, track?.artist || 'Side A · Side B', S - 140), 72, 356);
  ctx.globalAlpha = 1;
  // Catalogue line under the horizon.
  ctx.font = `600 15px ${SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('ND · 3301', 72, S * 0.9 + 44);
  ctx.textAlign = 'right';
  ctx.fillText('33⅓ RPM', S - 70, S * 0.9 + 44);
  ctx.letterSpacing = '0px';

  // Ink speckle: tiny gaps where the ink didn't take, over everything printed.
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(110,61,54,${0.2 + rand() * 0.3})`;
    const r = 0.5 + rand() * 0.9;
    ctx.beginPath();
    ctx.arc(rand() * S, rand() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Linen emboss for the jacket board: a fine woven cross-hatch, as a bump map.
export function makeBoardBump() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const rand = rng(17);
  for (let y = 0; y < S; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rand() * 0.12})`;
    ctx.fillRect(0, y, S, 1.2);
  }
  for (let x = 0; x < S; x += 3) {
    ctx.fillStyle = `rgba(0,0,0,${0.1 + rand() * 0.12})`;
    ctx.fillRect(x, 0, 1.2, S);
  }
  for (let i = 0; i < 1800; i++) { // slubs in the weave
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
    ctx.fillRect(rand() * S, rand() * S, 4 + rand() * 10, 1.5);
  }
  const t = tex(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

// The paper inner sleeve: off-white stock with fibres, slightly foxed at the edge.
export function makeInnerSleeveTexture() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#e9dfcf';
  ctx.fillRect(0, 0, S, S);
  const rand = rng(23);
  for (let i = 0; i < 2500; i++) {
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(120,96,70,0.12)';
    ctx.lineWidth = 0.6;
    const x = rand() * S, y = rand() * S, a = rand() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (3 + rand() * 9), y + Math.sin(a) * (3 + rand() * 9));
    ctx.stroke();
  }
  const fox = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  fox.addColorStop(0, 'rgba(150,110,60,0)');
  fox.addColorStop(1, 'rgba(150,110,60,0.16)');
  ctx.fillStyle = fox;
  ctx.fillRect(0, 0, S, S);
  return tex(c);
}

export function makeSleeveTexture({ img, track }) {
  const S = 1024;
  const [c, ctx] = canvas(S);
  if (img) {
    drawCover(ctx, img, 0, 0, S, S);
  } else {
    drawHouseSleeve(ctx, S, track);
  }
  // Ring wear from the record inside.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.arc(S / 2 + 6, S / 2 - 4, S * 0.468, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.arc(S / 2 + 6, S / 2 - 4, S * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Edge wear
  const edge = ctx.createLinearGradient(0, 0, 14, 0);
  edge.addColorStop(0, 'rgba(255,255,255,0.25)');
  edge.addColorStop(1, 'rgba(255,255,255,0)');
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate((k * Math.PI) / 2);
    ctx.translate(-S / 2, -S / 2);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, 14, S);
    ctx.restore();
  }
  return tex(c);
}

// Tabletop: a woven linen runner on a sideboard.
export function makeTableTexture(color) {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
  const rand = rng(5);
  for (let y = 0; y < S; y += 2) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.01 + rand() * 0.015})`;
    ctx.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 2) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.01 + rand() * 0.015})`;
    ctx.fillRect(x, 0, 1, S);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  return t;
}

// Lid top roughness: polished acrylic with a little dust and one thumbprint near the front edge,
// where you'd lift it. Values are roughness (0 = mirror). UVs are the shape's own cm coordinates.
export function makeLidSurface(w, d) {
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = 'rgb(7,7,7)';
  ctx.fillRect(0, 0, S, S);
  const rand = rng(31);
  for (let i = 0; i < 900; i++) {
    const v = 40 + rand() * 90;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + rand() * 0.5})`;
    const r = 0.6 + rand() * 1.6;
    ctx.beginPath();
    ctx.arc(rand() * S, rand() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Thumbprint: concentric ridges, front-right of centre (canvas bottom = front of the lid).
  ctx.save();
  ctx.translate(S * 0.62, S * 0.9);
  ctx.rotate(-0.4);
  for (let k = 0; k < 16; k++) {
    ctx.strokeStyle = `rgba(70,70,70,${0.35 - k * 0.015})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, 4 + k * 2.6, 6 + k * 3.4, 0, 0.2, Math.PI * 2 - 0.4);
    ctx.stroke();
  }
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.repeat.set(1 / w, 1 / d);
  t.offset.set(0.5, 0.5);
  return t;
}
