// Desktop widget: a spinning record with a small tonearm, drawn in 2D so it stays light enough
// to sit on the desktop all day. Two layouts: 'record' (square) and 'strip' (now playing).
import './widget.css';

const kind = new URLSearchParams(location.search).get('kind') === 'strip' ? 'strip' : 'record';
document.body.classList.add(kind, `os-${navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'}`);

const api = window.needledrop;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const W = kind === 'strip' ? 360 : 220;
const H = kind === 'strip' ? 104 : 220;
const dpr = Math.max(1, window.devicePixelRatio || 1);
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

// Record + arm geometry per layout (CSS pixels). Arm angle 0 points straight down from the pivot.
const L = kind === 'strip'
  ? { cx: 52, cy: 52, r: 42, px: 100, py: 8, len: 50, rest: -0.3, lead: 0.2, sweep: 0.5 }
  : { cx: 98, cy: 120, r: 86, px: 196, py: 24, len: 120, rest: -0.12, lead: 0.2, sweep: 0.3 };

const state = { title: '', artist: '', playing: false, progress: 0, vinyl: '#111111', tint: null, art: null };
let artImg = null;
let angle = 0;
let spin = 0;
let arm = L.rest;

function applyState(s) {
  if (s.art !== undefined && s.art !== state.art) {
    state.art = s.art;
    artImg = null;
    if (s.art) {
      const img = new Image();
      img.onload = () => { artImg = img; };
      img.src = s.art;
    }
  }
  Object.assign(state, { ...s, art: state.art });
  document.getElementById('title').textContent = s.title || 'Nothing playing';
  document.getElementById('artist').textContent = s.artist || '';
  document.getElementById('pp').setAttribute('d', s.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5v14l11-7z');
  document.getElementById('bar').style.transform = `scaleX(${s.progress || 0})`;
  document.body.style.setProperty('--tint', s.tint || 'transparent');
}
api?.onWidgetState(applyState);
if (import.meta.env.DEV) window.__setWidgetState = applyState; // preview without Electron

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => api?.widgetCommand(b.dataset.cmd)));
document.getElementById('hit').addEventListener('click', () => api?.widgetCommand('toggle'));
document.getElementById('hit').addEventListener('dblclick', () => api?.widgetCommand('open'));

function drawRecord(t) {
  const { cx, cy, r } = L;
  // Disc with a soft drop shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = r * 0.18;
  ctx.shadowOffsetY = r * 0.05;
  ctx.fillStyle = state.vinyl;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Grooves, with a couple of track gaps.
  for (let i = 0; i < 34; i++) {
    const rr = r * (0.42 + (i / 34) * 0.54);
    ctx.strokeStyle = i % 9 === 0 ? 'rgba(0,0,0,0.25)' : `rgba(255,255,255,${i % 2 ? 0.035 : 0.055})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Light catching the grooves: fixed in place while the record turns under it.
  const sheen = ctx.createConicGradient(-0.7, cx, cy);
  for (const [s, a] of [[0, 0], [0.06, 0.2], [0.12, 0], [0.5, 0], [0.56, 0.14], [0.62, 0], [1, 0]]) sheen.addColorStop(s, `rgba(255,255,255,${a})`);
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
  ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2, true);
  ctx.fill();

  // Label, turning with the record.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2);
  ctx.clip();
  if (artImg) {
    const s = Math.max((r * 0.72) / artImg.width, (r * 0.72) / artImg.height);
    ctx.drawImage(artImg, (-artImg.width * s) / 2, (-artImg.height * s) / 2, artImg.width * s, artImg.height * s);
  } else {
    ctx.fillStyle = '#d98a4e';
    ctx.fillRect(-r, -r, r * 2, r * 2);
  }
  ctx.restore();

  ctx.fillStyle = '#e8e4dd';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.5, r * 0.028), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawArm() {
  const { px, py, len } = L;
  const k = len / 120;
  const ex = px - Math.sin(arm) * len;
  const ey = py + Math.cos(arm) * len;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6 * k + 2;
  ctx.shadowOffsetY = 3 * k + 1;
  // Counterweight behind the pivot.
  const bx = px + Math.sin(arm) * 18 * k;
  const by = py - Math.cos(arm) * 18 * k;
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineCap = 'round';
  ctx.lineWidth = 9 * k + 2;
  ctx.beginPath();
  ctx.moveTo(px + Math.sin(arm) * 8 * k, py - Math.cos(arm) * 8 * k);
  ctx.lineTo(bx, by);
  ctx.stroke();
  // Tube
  ctx.strokeStyle = '#dcd8d1';
  ctx.lineWidth = 3.4 * k + 1;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // Headshell, turned in toward the groove.
  ctx.translate(ex, ey);
  ctx.rotate(arm + 0.35);
  ctx.fillStyle = '#1d1d1d';
  roundRect(-5 * k - 1, -2, 10 * k + 2, 17 * k + 3, 2.5);
  ctx.fill();
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(-5 * k - 1, 13 * k, 10 * k + 2, 1.2);
  ctx.restore();

  // Pivot: machined plate with a dark bearing cap.
  const plate = ctx.createLinearGradient(px - 12, py - 12, px + 12, py + 12);
  plate.addColorStop(0, '#ece8e1');
  plate.addColorStop(1, '#8e8982');
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.arc(px, py, 12 * k + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.arc(px, py, 5.5 * k + 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // 33⅓ RPM, with spin-up and coast-down.
  const target = state.playing ? (33.333 / 60) * Math.PI * 2 : 0;
  spin += (target - spin) * (1 - Math.exp(-(state.playing ? 3 : 1.2) * dt));
  angle += spin * dt;
  const armTarget = state.title ? (state.playing ? L.lead + Math.min(1, state.progress || 0) * L.sweep : arm > L.rest + 0.05 ? arm : L.rest) : L.rest;
  arm += (armTarget - arm) * (1 - Math.exp(-4 * dt));

  ctx.clearRect(0, 0, W, H);
  drawRecord();
  drawArm();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (import.meta.env.DEV) window.__frame = (t) => { last = t - 16; const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; frame(t); window.requestAnimationFrame = raf; return { arm, spin, playing: state.playing, title: state.title }; };
