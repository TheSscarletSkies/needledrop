import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Turntable, TABLE_Y } from './scene/turntable.js';
import { VideoStand } from './scene/videoStand.js';
import { Room, ROOM_THEMES, timeNow } from './scene/room.js';
import { WEATHERS } from './scene/weather.js';
import { Cat, COATS } from './scene/cat.js';
import { FINISHES, HEX, loadImage, dominantColor, makeTableTexture } from './scene/textures.js';
import { SystemSource } from './sources/system.js';
import { YouTubeSource } from './sources/youtube.js';
import { LocalSource } from './sources/local.js';
import { Vinyl } from './audio/crackle.js';
import { Levels } from './audio/levels.js';
import { Speakers } from './scene/speakers.js';

const $ = (s) => document.querySelector(s);
const isDesktop = !!window.needledrop;
document.body.classList.toggle('desktop', isDesktop);
const isMac = /mac/i.test(navigator.platform);
document.body.classList.toggle('mac', isMac);
if (!isMac) {
  // Off macOS the system source follows any media player, not just Spotify and Music.
  document.querySelector('[data-source="system"]').textContent = 'Now playing';
  document.querySelector('#panel-system .panel-title').textContent = 'Your music player';
}

// ---------- settings ----------
const settings = Object.assign(
  { finish: 'walnut', vinyl: 'black', rpm: 33.333, pitch: 0, crackle: 0.45, source: isDesktop ? 'system' : 'youtube', ytUrl: '', coached: false, speakers: true, sleeve: true, volume: 0.85, room: 'evening', weather: 'breeze', rainSound: false, time: 'auto', cat: true, catCoat: 'ginger', customFinish: '#7d4a3e:wood', vinylHex: '#b8323f', wallHex: null },
  JSON.parse(localStorage.getItem('needledrop') || '{}'),
);
const save = () => localStorage.setItem('needledrop', JSON.stringify(settings));

// ---------- renderer / scene ----------
const canvas = $('#scene');
// alpha: the canvas can be see-through where the video tablet's glass is (see cutVideoHole).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.6;
// Fog only fades the far edge of the table into the background; its range follows the camera (see frame()).
scene.fog = new THREE.Fog(0x000000, 200, 400);

const camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = 1.22;
controls.minDistance = 35;
controls.maxDistance = 170;
// Aim a little above the plinth so the speakers and the open lid have headroom at the top.
controls.target.set(0, 2, -1);

// Warm key from the upper left, like a lamp or window: a soft-edged pool of light that falls off
// across the table, so the deck is lit and the room around it isn't.
const key = new THREE.SpotLight(0xffeedd, 40000, 0, 0.44, 0.9, 2);
key.position.set(-45, 95, 35);
key.target.position.set(-6, -8, 3);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.near = 40;
key.shadow.camera.far = 260;
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;
key.shadow.radius = 5;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
fill.position.set(50, 30, -10);
scene.add(fill);

// The sideboard the deck sits on.
const tableMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
const table = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), tableMat);
table.rotation.x = -Math.PI / 2;
table.position.y = TABLE_Y;
table.receiveShadow = true;
scene.add(table);
const room = new Room(scene, TABLE_Y);

const deck = new Turntable(scene);
const speakers = new Speakers(scene, TABLE_Y, deck.mat.wood);
const levels = new Levels();
const stand = new VideoStand(scene, $('#yt-screen'), TABLE_Y);
const cat = new Cat(scene, TABLE_Y);

// ---------- post: ambient occlusion for contact shadows, bloom so LEDs glow ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({ radius: 2.4, distanceExponent: 1.4, thickness: 1.5, scale: 1.1 });
gtao.blendIntensity = 0.85;
// AO must ignore the transparent dust cover.
const gtaoRender = gtao.render.bind(gtao);
gtao.render = (...args) => {
  deck.cover.visible = false;
  gtaoRender(...args);
  deck.cover.visible = true;
};
composer.addPass(gtao);
// Shallow depth of field, focused on the deck, like a photo taken close up.
const dof = new BokehPass(scene, camera, { focus: 120, aperture: 0.00007, maxblur: 0.006 });
const dofRender = dof.render.bind(dof);
dof.render = (...args) => {
  deck.cover.visible = false;
  dofRender(...args);
  deck.cover.visible = true;
};
composer.addPass(dof);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.18, 2.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// DOM layer for the YouTube player, placed in 3D on the tablet stand.
const cssRenderer = new CSS3DRenderer();
cssRenderer.domElement.className = 'css3d';
document.body.insertBefore(cssRenderer.domElement, canvas); // behind the canvas
// Move the player's container into the 3D layer now, before YouTube creates its iframe:
// CSS3DRenderer only re-parents elements when they first become visible, and moving a live
// iframe reloads it and breaks the player.
stand.group.visible = true;
cssRenderer.render(scene, camera);
stand.group.visible = false;

// Far enough to fit the deck, the sleeve on the left and the video stand on the right, at any window shape.
const defaultDistance = () => Math.max(120, 56 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
// ~36° above the table, like a photo taken from a chair: the lit wall fills the top of the frame.
const defaultOffset = (dist) => new THREE.Vector3(0, dist * 0.59, dist * 0.81);
let viewTween = null; // { from, to, t } — eases the camera back to the default framing

function frameCamera() {
  const w = innerWidth, h = innerHeight;
  // macOS reports a 0×0 window for a moment while entering/leaving full screen; ignore it,
  // otherwise the aspect ratio turns into NaN and the camera collapses onto the record.
  if (w < 2 || h < 2) return;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  cssRenderer.setSize(w, h);
  camera.aspect = w / h;
  const dist = defaultDistance();
  const offset = camera.position.clone().sub(controls.target);
  const broken = !Number.isFinite(offset.lengthSq()) || offset.length() < 1;
  if (!frameCamera.done || broken) {
    camera.position.copy(controls.target).add(defaultOffset(dist));
    frameCamera.done = true;
  } else {
    camera.position.copy(controls.target).add(offset.setLength(dist));
  }
  camera.updateProjectionMatrix();
}

function resetView() {
  viewTween = { from: camera.position.clone(), to: controls.target.clone().add(defaultOffset(defaultDistance())), t: 0 };
}
addEventListener('resize', frameCamera);
frameCamera();

// ---------- sources ----------
const vinyl = new Vinyl();
// First user gesture: unlock audio, and start listening so the speakers can move.
function wake() {
  vinyl.unlock();
  if (window.needledrop) levels.startFromWindow();
  else levels.startFromElement(sources.local.audio);
}
vinyl.setLevel(settings.crackle * settings.volume);
const sources = {
  system: new SystemSource(),
  youtube: new YouTubeSource($('#yt-host')),
  local: new LocalSource(),
};
let source = sources[settings.source] || sources.youtube;

const snap = { track: null, position: 0, duration: 0, playing: false, at: performance.now() };
let pendingPlay = false;
let pendingSince = 0;
let polling = false;
let currentTrackId = null;
let currentAlbum = null;
let panelOpen = false;

// Playback-rate factor the deck applies to sources that can follow it.
const speedFactor = () => (settings.rpm > 40 ? 45 / 33.333 : 1) * (1 + settings.pitch);
const followsSpeed = () => source !== sources.system;

function position() {
  if (!snap.playing) return snap.position;
  const rate = followsSpeed() ? speedFactor() : 1;
  return Math.min(snap.duration || Infinity, snap.position + ((performance.now() - snap.at) / 1000) * rate);
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const s = await source.poll();
    Object.assign(snap, s, { at: performance.now() });
    if (s.playing) pendingPlay = false;
    onTrack(s.track);
  } catch (e) {
    console.warn('poll failed', e);
  } finally {
    polling = false;
  }
}
setInterval(poll, 500);

async function onTrack(track) {
  const id = track?.id || null;
  if (id !== currentTrackId) {
    currentTrackId = id;
    $('#t-title').textContent = track?.title || 'Nothing on the platter';
    $('#t-sub').textContent = track ? [track.artist, track.albumName].filter(Boolean).join(' — ') : '';
    $('#t-via').textContent = track?.via || '';
    renderQueue();
    renderPanels();
  }
  const album = track ? `${track.album}|${track.art ? 1 : 0}` : null;
  if (album !== currentAlbum) {
    const first = currentAlbum === null;
    currentAlbum = album;
    await pressRecord(track, !first);
  }
}

let lastArt = null;
const widgetLook = { vinyl: '#0c0c0c', tint: null, art: null };
// Widgets get the same letterbox-trimmed art as the label, as a small square JPEG.
function squareArt(img) {
  try {
    const c = document.createElement('canvas');
    const N = 512; // sharp enough for the label on a large deck widget
    c.width = c.height = N;
    const s = Math.max(N / img.width, N / img.height);
    c.getContext('2d').drawImage(img, (N - img.width * s) / 2, (N - img.height * s) / 2, img.width * s, img.height * s);
    return c.toDataURL('image/jpeg', 0.86);
  } catch { return null; }
}
async function pressRecord(track, animate = true) {
  const img = await loadImage(track?.art);
  lastArt = { img, track };
  widgetLook.tint = img ? `#${dominantColor(img).getHexString()}` : null;
  widgetLook.art = img ? squareArt(img) : null;
  const color = settings.vinyl === 'custom' ? new THREE.Color(settings.vinylHex)
    : settings.vinyl === 'color' && img ? dominantColor(img).lerp(new THREE.Color(0x0a0a0a), 0.12)
    : new THREE.Color(0x0c0c0c);
  deck.setRecord({ img, vinyl: color, track }, animate);
  widgetLook.vinyl = `#${color.getHexString()}`;
  updateMediaSession(track);
}

function switchSource(name, { open = true } = {}) {
  if (!sources[name]) return;
  if (source !== sources[name]) source.pause?.();
  source = sources[name];
  settings.source = name;
  save();
  pendingPlay = false;
  panelOpen = open;
  document.body.classList.remove('src-system', 'src-youtube', 'src-local');
  document.body.classList.add(`src-${name}`);
  $('#settings').hidden = true;
  Object.assign(snap, { track: null, position: 0, duration: 0, playing: false });
  currentTrackId = undefined;
  applySpeed();
  renderPanels();
  poll();
}

// Source panel shows when there's nothing to play, or when asked for (tab or sleeve click).
function renderPanels() {
  document.querySelectorAll('.sources button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.source === source.name)));
  const show = (panelOpen || !snap.track) && $('#settings').hidden;
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = !show || p.id !== `panel-${source.name}`; });
}

// ---------- transport ----------
async function play() {
  wake();
  if (!snap.track) {
    polling = false;
    await poll();
    if (!snap.track) { panelOpen = true; renderPanels(); return; }
  }
  pendingPlay = true;
  pendingSince = performance.now();
  if (deck.landed) source.play(); // otherwise audio starts when the needle lands
}
function pause() {
  pendingPlay = false;
  source.pause();
  snap.position = position();
  snap.playing = false;
}
const toggle = () => (snap.playing || pendingPlay ? pause() : play());
function seekTo(sec) {
  sec = Math.max(0, Math.min(sec, (snap.duration || 1) - 0.5));
  source.seek(sec);
  snap.position = sec;
  snap.at = performance.now();
}

deck.on('landed', () => {
  vinyl.drop();
  coachDone();
  if (pendingPlay && !snap.playing) {
    source.play();
    setTimeout(() => { polling = false; poll(); }, 150);
  }
});
deck.on('lifted', () => vinyl.lift());
deck.on('drop', (p) => {
  if (!snap.track) return;
  coachDone();
  seekTo(p * (snap.duration || 0));
  play();
});
deck.on('rest', () => pause());

$('#play').addEventListener('click', () => { deck.press('start'); toggle(); });
$('#next').addEventListener('click', () => source.next());
$('#prev').addEventListener('click', () => source.prev());

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input')) return;
  if (e.code === 'Space') { e.preventDefault(); deck.press('start'); toggle(); }
  if (e.code === 'ArrowRight') seekTo(position() + 10);
  if (e.code === 'ArrowLeft') seekTo(position() - 10);
  if (e.key === 'n') source.next();
  if (e.key === 'p') source.prev();
  if (e.key === 'Escape') { panelOpen = false; $('#settings').hidden = true; renderPanels(); }
  if (e.code === 'ArrowUp') { e.preventDefault(); setVolume(settings.volume + 0.05); }
  if (e.key === 'm') toggleMute();
  if (e.code === 'ArrowDown') { e.preventDefault(); setVolume(settings.volume - 0.05); }
});

// Clicking anywhere outside Settings (or an open source panel) closes it.
addEventListener('pointerdown', (e) => {
  const t = e.target;
  if (!$('#settings').hidden && !t.closest?.('#settings, #settings-btn')) { $('#settings').hidden = true; renderPanels(); }
  if (panelOpen && snap.track && t !== canvas && !t.closest?.('.panel, .sources')) { panelOpen = false; renderPanels(); }
});

// ---------- seek bar: the hairline under the now-playing bar ----------
const seekBar = $('#seek');
let seeking = null; // fraction while dragging
function seekFraction(e) {
  const r = seekBar.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}
seekBar.addEventListener('pointerdown', (e) => {
  if (!snap.track || !snap.duration) return;
  seekBar.setPointerCapture(e.pointerId);
  seeking = seekFraction(e);
  seekBar.classList.add('dragging');
});
seekBar.addEventListener('pointermove', (e) => {
  const f = seekFraction(e);
  if (seeking !== null) seeking = f;
  seekBar.title = snap.duration ? fmt(f * snap.duration) : '';
});
seekBar.addEventListener('pointerup', () => {
  if (seeking === null) return;
  seekTo(seeking * snap.duration);
  seeking = null;
  seekBar.classList.remove('dragging');
});

// While a record plays and the pointer rests, the now-playing bar fades back.
let lastPointer = performance.now();
for (const evt of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(evt, () => { lastPointer = performance.now(); document.body.classList.remove('idle'); }, { passive: true });
setInterval(() => {
  const idle = snap.playing && performance.now() - lastPointer > 3500 && $('#settings').hidden && !panelOpen;
  document.body.classList.toggle('idle', idle);
}, 500);

// ---------- volume (YouTube and local files; Spotify/Music keep their own) ----------
let unmuteTo = null; // volume to restore when un-muting
function setVolume(v) {
  settings.volume = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  if (settings.volume > 0) unmuteTo = null;
  document.body.classList.toggle('muted', settings.volume === 0);
  $('#mute-icon').setAttribute('d', settings.volume === 0
    ? 'M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.2-2.2-1.1-1.1-2.2 2.2-2.2-2.2-1.1 1.1 2.2 2.2-2.2 2.2 1.1 1.1 2.2-2.2 2.2 2.2 1.1-1.1z'
    : 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12z');
  $('#mute').setAttribute('aria-label', settings.volume === 0 ? 'Unmute' : 'Mute');
  save();
  sources.local.setVolume(settings.volume);
  sources.youtube.setVolume(settings.volume);
  vinyl.setLevel(settings.crackle * settings.volume); // surface noise is part of the record, so it follows the volume
  applyRainSound();
  $('#volume').value = settings.volume;
}
$('#volume').addEventListener('input', (e) => setVolume(+e.target.value));
function toggleMute() {
  if (settings.volume > 0) { const was = settings.volume; setVolume(0); unmuteTo = was; }
  else setVolume(unmuteTo || 0.7);
}
$('#mute').addEventListener('click', toggleMute);

// ---------- system now-playing: media keys, Control Center, lock screen ----------
// Only for what Needledrop itself plays; Spotify and Music report their own.
const mediaSession = navigator.mediaSession;
function updateMediaSession(track) {
  if (!mediaSession) return;
  if (!track || source === sources.system) { mediaSession.metadata = null; return; }
  mediaSession.metadata = new MediaMetadata({
    title: track.title || '', artist: track.artist || '', album: track.albumName || '',
    artwork: widgetLook.art ? [{ src: widgetLook.art, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
}
if (mediaSession) {
  const on = (action, fn) => { try { mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  on('play', () => { deck.press('start'); play(); });
  on('pause', () => { deck.press('start'); pause(); });
  on('nexttrack', () => source.next());
  on('previoustrack', () => source.prev());
  on('seekto', (d) => seekTo(d.seekTime));
  on('seekforward', () => seekTo(position() + 10));
  on('seekbackward', () => seekTo(position() - 10));
}

function applySpeed() {
  deck.setSpeed(settings.rpm);
  deck.setPitch(settings.pitch);
  const r = speedFactor();
  sources.local.setRate(r);
  sources.youtube.setRate?.(r);
  const pct = settings.pitch * 100;
  $('#t-rate').textContent = settings.rpm > 40 || pct !== 0
    ? `${settings.rpm > 40 ? '45' : '33⅓'}${pct ? ` ${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%` : ''}`
    : '';
}
function setSpeed(rpm) { settings.rpm = rpm; save(); applySpeed(); }
function setPitch(p) { settings.pitch = p; save(); applySpeed(); }

// ---------- pointer: tonearm, buttons, cue, pitch, lid, sleeve ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const armPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -deck.armHeight);
const pitchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
let drag = null; // 'arm' | 'pitch'

function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
}

addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  wake();
  setPointer(e);
  const hit = deck.pick(ray) || pickVideo() || pickCat();
  if (!hit) {
    if (panelOpen && snap.track) { panelOpen = false; renderPanels(); }
    return;
  }
  controls.enabled = false;
  switch (hit) {
    case 'arm':
      drag = 'arm';
      if (snap.playing) { source.pause(); snap.position = position(); snap.playing = false; }
      pendingPlay = false;
      deck.startDrag();
      canvas.setPointerCapture(e.pointerId);
      break;
    case 'pitch':
      drag = 'pitch';
      canvas.setPointerCapture(e.pointerId);
      break;
    case 'start': deck.press('start'); toggle(); break;
    case '33': deck.press('33'); setSpeed(33.333); break;
    case '45': deck.press('45'); setSpeed(45); break;
    case 'cue': if (snap.track) toggle(); break;
    case 'cover': deck.toggleCover(); break;
    case 'sleeve': panelOpen = true; $('#settings').hidden = true; renderPanels(); break;
    case 'video': toggle(); break;
    case 'cat': cat.pet(); vinyl.unlock(); vinyl.purr(4.5, settings.volume); break;
  }
  canvas.className = drag ? 'grabbing' : '';
  showTip(null);
}, { capture: true });

canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  const p = new THREE.Vector3();
  if (drag === 'arm') { if (ray.ray.intersectPlane(armPlane, p)) deck.dragTo(p); return; }
  if (drag === 'pitch') { if (ray.ray.intersectPlane(pitchPlane, p)) setPitch(deck.pitchFromPoint(p)); return; }
  const hit = deck.pick(ray) || pickVideo() || pickCat();
  canvas.className = hit === 'arm' || hit === 'pitch' ? 'grab' : hit ? 'pointer' : '';
  showTip(hit, e);
});
canvas.addEventListener('pointerleave', () => showTip(null));

// What each part of the deck does, on hover.
const TIPS = {
  arm: 'Tonearm: drag onto the record to play or seek',
  start: 'Start / stop',
  '33': '33⅓ RPM',
  '45': '45 RPM',
  cue: 'Cue lever: lift or lower the needle',
  pitch: 'Pitch ±8%: drag to change speed',
  cover: 'Dust cover: click to open or close',
  sleeve: 'Album sleeve: change the record',
  video: 'Click to play or pause',
  cat: 'Pet the cat',
};
function pickCat() {
  return cat.group.visible && cat.pickables && ray.intersectObjects(cat.pickables, false).length ? 'cat' : null;
}
// The video tablet, when it's out.
function pickVideo() {
  return stand.group.visible && ray.intersectObjects(stand.pickables, false).length ? 'video' : null;
}
const tip = $('#tip');
function showTip(hit, e) {
  const text = !drag && TIPS[hit];
  tip.classList.toggle('on', !!text);
  if (!text) return;
  tip.textContent = text;
  tip.style.transform = `translate(${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px, ${e.clientY + 18}px)`;
}

canvas.addEventListener('dblclick', (e) => {
  setPointer(e);
  if (!deck.pick(ray)) resetView();
});

addEventListener('pointerup', () => {
  if (drag === 'arm') deck.endDrag();
  drag = null;
  canvas.className = '';
  controls.enabled = true;
});

// ---------- coach mark: one-time hint pointing at the headshell ----------
const coach = $('#coach');
function coachDone() {
  if (settings.coached) return;
  settings.coached = true;
  save();
  coach.classList.remove('on');
}
const headScreen = new THREE.Vector3();
function placeCoach() {
  const show = !settings.coached && snap.track && !snap.playing && !pendingPlay && !drag;
  coach.classList.toggle('on', !!show);
  if (!show) return;
  deck.headshellPosition(headScreen).project(camera);
  coach.style.transform = `translate(${(headScreen.x * 0.5 + 0.5) * innerWidth}px, ${(-headScreen.y * 0.5 + 0.5) * innerHeight}px)`;
}

// ---------- panels ----------
document.querySelectorAll('.sources button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.source === source.name) { panelOpen = !panelOpen; $('#settings').hidden = true; renderPanels(); }
  else switchSource(b.dataset.source);
}));
$('#settings-btn').addEventListener('click', () => {
  const s = $('#settings');
  s.hidden = !s.hidden;
  if (!s.hidden) panelOpen = false;
  renderPanels();
});

$('#yt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  wake();
  const url = $('#yt-url').value;
  if (await sources.youtube.load(url)) {
    settings.ytUrl = url;
    save();
    switchSource('youtube', { open: false });
    applySpeed();
    setTimeout(play, 600);
  }
  renderNotes();
});
$('#yt-url').value = settings.ytUrl;
$('#yt-show').checked = !!settings.showVideo;
$('#yt-show').addEventListener('change', (e) => { settings.showVideo = e.target.checked; save(); });

// Files or folders, from a drop or a picker: queue them and play the first new track.
async function addFiles(files) {
  wake();
  startQueued(await sources.local.add(files));
}
async function startQueued(first) {
  if (first < 0) return;
  if (source !== sources.local) switchSource('local', { open: false });
  sources.local.jump(first);
  polling = false;
  await poll();
  play();
}
$('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#folder-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#clear-queue').addEventListener('click', () => { pause(); sources.local.clear(); polling = false; poll(); });

// In a plain browser a dropped folder arrives as an entry tree; walk it into files, in album order.
async function filesFromDrop(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (window.needledrop || !entries.some((en) => en.isDirectory)) return [...dt.files];
  const out = [];
  const readAll = (dir) => new Promise((resolve) => {
    const reader = dir.createReader();
    const all = [];
    const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, () => resolve(all));
    next();
  });
  async function walk(en) {
    if (en.isFile) out.push({ path: en.fullPath, file: await new Promise((r) => en.file(r, () => r(null))) });
    else if (en.isDirectory) for (const child of await readAll(en)) await walk(child);
  }
  for (const en of entries) await walk(en);
  return out.filter((o) => o.file).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })).map((o) => o.file);
}

let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop-overlay').classList.add('on'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) $('#drop-overlay').classList.remove('on'); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').classList.remove('on');
  addFiles(await filesFromDrop(e.dataTransfer));
});

function renderQueue() {
  const ol = $('#queue');
  ol.innerHTML = '';
  sources.local.queue.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = i === sources.local.index ? 'on' : '';
    li.innerHTML = '<span></span><span></span>';
    li.firstChild.textContent = String(i + 1);
    li.lastChild.textContent = [item.meta.title, item.meta.artist].filter(Boolean).join(' — ');
    li.addEventListener('click', () => { sources.local.jump(i); poll(); });
    ol.appendChild(li);
  });
}
sources.local.onQueueChange = renderQueue;

function renderNotes() {
  for (const [name, s] of Object.entries(sources)) {
    const el = document.querySelector(`[data-note="${name}"]`);
    if (el && el.textContent !== s.note) el.textContent = s.note;
  }
}
setInterval(renderNotes, 1000);

// ---------- settings ----------
const finishes = $('#finishes');
for (const [name, f] of Object.entries(FINISHES)) {
  const b = document.createElement('button');
  b.title = f.label;
  b.setAttribute('aria-label', f.label);
  b.style.background = f.base;
  b.dataset.finish = name;
  b.addEventListener('click', () => setFinish(name));
  finishes.appendChild(b);
}
{
  const b = document.createElement('button');
  b.className = 'custom-swatch';
  b.title = 'Custom colour';
  b.setAttribute('aria-label', 'Custom colour');
  b.dataset.finish = 'custom';
  b.addEventListener('click', () => setFinish(settings.customFinish));
  finishes.appendChild(b);
}

// A colour picker plus a hex field, kept in step. Calls back only with valid '#rrggbb'.
function hexRow(row, onChange) {
  const [picker, text] = row.querySelectorAll('input[type=color], input[type=text]');
  const show = (hex) => { picker.value = hex; text.value = hex; text.removeAttribute('aria-invalid'); };
  picker.addEventListener('input', () => { show(picker.value); onChange(picker.value); });
  text.addEventListener('input', () => {
    let v = text.value.trim();
    if (v && !v.startsWith('#')) v = `#${v}`;
    const ok = HEX.test(v);
    text.setAttribute('aria-invalid', String(!ok && v.length >= 7));
    if (ok) { picker.value = v.toLowerCase(); onChange(v.toLowerCase()); }
  });
  text.addEventListener('blur', () => show(picker.value));
  text.addEventListener('keydown', (e) => e.stopPropagation()); // typing isn't a keyboard shortcut
  return show;
}
const isCustomFinish = (v) => !FINISHES[v];
const showFinishHex = hexRow($('#finish-custom'), (hex) => setFinish(`${hex}${$('#finish-wood').checked ? ':wood' : ''}`));
$('#finish-wood').addEventListener('change', (e) => setFinish(`${settings.customFinish.split(':')[0]}${e.target.checked ? ':wood' : ''}`));
// Light rooms get a mid-tone linen and a touch less exposure, so pale finishes and black vinyl keep their contrast.
const THEMES = {
  dark: { bg: 0x16120f, table: '#2b2521', exposure: 1.0 },
  light: { bg: 0xd2c9bd, table: '#a39a8e', exposure: 0.8 }, // neutral greige, darker than the pale decks
};
// The finish only changes the turntable (and the speakers, which share its veneer).
function setFinish(name) {
  const custom = isCustomFinish(name);
  if (custom && !HEX.test(String(name).split(':')[0])) name = 'walnut';
  settings.finish = name;
  if (isCustomFinish(name)) settings.customFinish = name;
  save();
  const f = deck.setFinish(name);
  const key = isCustomFinish(name) ? 'custom' : name;
  $('#finish-name').textContent = f.label;
  finishes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.finish === key)));
  $('#finish-custom').hidden = key !== 'custom';
  if (key === 'custom') {
    const [hex, kind] = name.split(':');
    showFinishHex(hex);
    $('#finish-wood').checked = kind === 'wood';
  }
}

// The room is its own choice: warm evening light (default) or a bright daylight room.
function setRoom(name) {
  settings.room = name === 'daylight' ? 'daylight' : 'evening';
  save();
  const t = settings.room === 'daylight' ? 'light' : 'dark';
  const theme = THEMES[t];
  document.body.classList.toggle('light', t === 'light');
  scene.background = new THREE.Color(theme.bg);
  scene.fog.color.set(theme.bg);
  renderer.toneMappingExposure = theme.exposure;
  room.setTheme(t);
  tableMat.map?.dispose();
  tableMat.map = makeTableTexture(theme.table);
  tableMat.needsUpdate = true;
  document.querySelectorAll('#room-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.room === settings.room)));
  room.setWallColor(settings.wallHex);
  showWallHex(settings.wallHex || wallDefault());
}
document.querySelectorAll('#room-mode button').forEach((b) => b.addEventListener('click', () => setRoom(b.dataset.room)));

// Time of day: moves the sun at the window and changes the lamp in the room. Auto follows the clock.
const KEY_BY_TIME = {
  morning: { color: 0xf2efe9, k: 0.85, env: 1, fill: 0.4 },
  day: { color: 0xffeedd, k: 1, env: 1, fill: 0.35 },
  golden: { color: 0xffd6ae, k: 0.92, env: 0.9, fill: 0.3 },
  night: { color: 0xffbd80, k: 0.8, env: 0.45, fill: 0.1 }, // just the warm lamp
};
const KEY_BASE = key.intensity;
let shownTime;
function applyTime() {
  const t = settings.time === 'auto' ? timeNow() : settings.time;
  if (t === shownTime) return;
  shownTime = t;
  room.setTime(t);
  const k = KEY_BY_TIME[t];
  key.color.set(k.color);
  key.intensity = KEY_BASE * k.k;
  fill.intensity = k.fill;
  scene.environmentIntensity = 0.6 * k.env;
}
function setTime(t) {
  settings.time = ['auto', ...Object.keys(KEY_BY_TIME)].includes(t) ? t : 'auto';
  save();
  shownTime = null;
  applyTime();
  document.querySelectorAll('#time-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === settings.time)));
}
document.querySelectorAll('#time-mode button').forEach((b) => b.addEventListener('click', () => setTime(b.dataset.t)));
setInterval(applyTime, 60_000); // Auto: the light changes as the day goes on

// What's outside the window. Still costs nothing; the others redraw the window light ~15×/s.
function setWeather(w) {
  settings.weather = WEATHERS.includes(w) ? w : 'breeze';
  save();
  room.setWeather(settings.weather);
  document.querySelectorAll('#weather-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.w === settings.weather)));
  $('#rain-sound-row').hidden = settings.weather !== 'rain';
  applyRainSound();
}
function applyRainSound() {
  vinyl.setRain(settings.weather === 'rain' && settings.rainSound ? settings.volume : 0);
}
document.querySelectorAll('#weather-mode button').forEach((b) => b.addEventListener('click', () => setWeather(b.dataset.w)));
$('#rain-sound').checked = settings.rainSound;
$('#rain-sound').addEventListener('change', (e) => { settings.rainSound = e.target.checked; save(); vinyl.unlock(); applyRainSound(); });

function setVinylMode(v) {
  settings.vinyl = v;
  save();
  document.querySelectorAll('#vinyl-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  $('#vinyl-custom').hidden = v !== 'custom';
  showVinylHex(settings.vinylHex);
  if (lastArt) pressRecord(lastArt.track, false);
}
const showVinylHex = hexRow($('#vinyl-custom'), (hex) => {
  settings.vinylHex = hex;
  save();
  clearTimeout(showVinylHex.t); // re-pressing the record is heavier; wait for the picker to settle
  showVinylHex.t = setTimeout(() => lastArt && pressRecord(lastArt.track, false), 120);
});
// Wall colour: any hex, or Reset to the room's own.
const showWallHex = hexRow($('#wall-custom'), (hex) => { settings.wallHex = hex; save(); room.setWallColor(hex); });
$('#wall-reset').addEventListener('click', () => { settings.wallHex = null; save(); room.setWallColor(null); showWallHex(wallDefault()); });
const wallDefault = () => (settings.room === 'daylight' ? ROOM_THEMES.light.wall : ROOM_THEMES.dark.wall);
document.querySelectorAll('#vinyl-mode button').forEach((b) => b.addEventListener('click', () => setVinylMode(b.dataset.v)));
$('#speakers').checked = settings.speakers;
speakers.visible = settings.speakers;
$('#speakers').addEventListener('change', (e) => { settings.speakers = e.target.checked; speakers.visible = e.target.checked; save(); });
// The sleeve doubles as the "change record" button; with it gone, the source tabs still do that.
const setSleeve = (on) => { deck.sleeve.visible = on; deck.sleevePickables.forEach((m) => { m.layers.set(on ? 0 : 1); }); };
$('#sleeve').checked = settings.sleeve;
setSleeve(settings.sleeve);
$('#sleeve').addEventListener('change', (e) => { settings.sleeve = e.target.checked; setSleeve(e.target.checked); save(); });
// The cat, and its coat.
const coats = $('#coats');
for (const [name, c] of Object.entries(COATS)) {
  const b = document.createElement('button');
  b.title = c.label;
  b.setAttribute('aria-label', c.label);
  b.style.background = c.pattern === 'calico' ? `conic-gradient(${c.base} 0 40%, ${c.light} 0 70%, ${c.stripe} 0)` : c.base;
  b.dataset.coat = name;
  b.addEventListener('click', () => setCat(true, name));
  coats.appendChild(b);
}
function setCat(on, coat = settings.catCoat) {
  settings.cat = on;
  settings.catCoat = COATS[coat] ? coat : 'ginger';
  save();
  cat.group.visible = on;
  if (on) cat.setCoat(settings.catCoat);
  $('#cat').checked = on;
  coats.hidden = !on;
  coats.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.coat === settings.catCoat)));
}
$('#cat').addEventListener('change', (e) => setCat(e.target.checked));
setCat(settings.cat);
$('#crackle').value = settings.crackle;
$('#crackle').addEventListener('input', (e) => { settings.crackle = +e.target.value; vinyl.setLevel(settings.crackle * settings.volume); save(); });
$('#pin').addEventListener('change', (e) => window.needledrop?.pin(e.target.checked));
$('#compact').addEventListener('change', (e) => {
  document.body.classList.toggle('compact', e.target.checked);
  window.needledrop?.compact(e.target.checked);
});

// ---------- desktop widgets (Electron only) ----------
const bridge = window.needledrop;
if (bridge?.getWidgets) {
  const boxes = { deck: $('#w-deck'), strip: $('#w-strip'), onTop: $('#w-top') };
  const apply = (p) => { for (const [k, el] of Object.entries(boxes)) el.checked = !!p[k]; };
  bridge.getWidgets().then(apply);
  for (const [k, el] of Object.entries(boxes)) el.addEventListener('change', async () => apply(await bridge.setWidgets({ [k]: el.checked })));
  bridge.onWidgetClosed((k) => { boxes[k].checked = false; });
  bridge.onRemoteCommand((cmd, arg) => {
    if (cmd === 'toggle') { deck.press('start'); toggle(); }
    if (cmd === 'next') source.next();
    if (cmd === 'prev') source.prev();
    if (cmd === 'pause') pause();
    if (cmd === 'seek' && snap.track) { seekTo(arg * (snap.duration || 0)); play(); }
    if (cmd === 'speed') { deck.press(arg > 40 ? '45' : '33'); setSpeed(arg); }
    if (cmd === 'pitch') setPitch(arg);
  });
}
// Audio files opened with Needledrop (double-click, Open With, dropped on the Dock icon).
bridge?.onOpenFiles?.(async (paths) => startQueued(await sources.local.addPaths(paths)));

let sentArt;
function broadcastToWidgets(progress, wantsPlay, mode) {
  if (!bridge?.broadcast) return;
  const t = snap.track;
  const art = widgetLook.art;
  bridge.broadcast({
    title: t?.title || '', artist: t?.artist || '', playing: wantsPlay, progress,
    vinyl: widgetLook.vinyl, tint: widgetLook.tint,
    // For the 3D deck widget: drive its arm and platter the same way as this window's.
    mode, spinning: wantsPlay, trackKey: t?.album || null,
    finish: settings.finish, rpm: settings.rpm, pitch: settings.pitch,
    ...(art !== sentArt ? { art } : {}),
  });
  sentArt = art;
}

setFinish(settings.finish);
setRoom(settings.room);
setTime(settings.time);
showWallHex(settings.wallHex || wallDefault());
setWeather(settings.weather);
setVinylMode(settings.vinyl);
setVolume(settings.volume);
switchSource(source.name, { open: false });
pressRecord(null, false);
if (settings.ytUrl && source === sources.youtube) sources.youtube.load(settings.ytUrl);

// ---------- loop ----------
function fmt(s) { return fmtTime(s); }
const fmtTime = (s) => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const timer = new THREE.Timer();
timer.connect(document);
let uiTick = 0;

function frame(fixedDt) {
  timer.update();
  const dt = fixedDt ?? Math.min(timer.getDelta(), 0.05);
  const now = performance.now();
  if (pendingPlay && deck.landed && now - pendingSince > 8000) pendingPlay = false;

  const pos = position();
  const progress = snap.duration ? pos / snap.duration : 0;
  const wantsPlay = snap.playing || pendingPlay;
  const mode = !snap.track ? 'rest' : wantsPlay ? 'play' : 'cue';
  deck.update(dt, { mode, progress, spinning: wantsPlay });
  vinyl.surfaceOn(deck.landed && snap.playing);
  levels.update(dt);
  speakers.update(snap.playing ? levels.bass : 0, snap.playing ? levels.mid : 0);

  if ((uiTick += dt) > 0.2) {
    uiTick = 0;
    const shown = seeking !== null ? seeking * snap.duration : pos;
    $('#t-pos').textContent = fmt(shown);
    $('#t-dur').textContent = snap.duration ? `−${fmt(snap.duration - shown)}` : '';
    $('#t-progress').style.transform = `scaleX(${seeking !== null ? seeking : progress})`;
    $('#play').setAttribute('aria-label', wantsPlay ? 'Pause' : 'Play');
    $('#play-icon').setAttribute('d', wantsPlay ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5v14l11-7z');
    document.body.classList.toggle('empty', !snap.track);
    if (!snap.track) $('#t-sub').textContent = source.note || '';
    renderPanels();
    broadcastToWidgets(progress, wantsPlay, mode);
    if (mediaSession && source !== sources.system && snap.track) {
      mediaSession.playbackState = wantsPlay ? 'playing' : 'paused';
      if (snap.duration > 0) {
        try { mediaSession.setPositionState({ duration: snap.duration, position: Math.min(pos, snap.duration), playbackRate: speedFactor() }); } catch { /* ignore */ }
      }
    }
  }
  placeCoach();

  if (viewTween) {
    viewTween.t = Math.min(1, viewTween.t + dt / 0.7);
    const k = 1 - (1 - viewTween.t) ** 3;
    camera.position.lerpVectors(viewTween.from, viewTween.to, k);
    if (viewTween.t >= 1) viewTween = null;
  }
  if (!Number.isFinite(camera.position.lengthSq())) { frameCamera.done = false; frameCamera(); }
  stand.update(dt, settings.showVideo && source === sources.youtube && !!snap.track);
  cat.setSpot(stand.group.visible);
  controls.update();
  const camDist = camera.position.distanceTo(controls.target);
  scene.fog.near = camDist + 45;
  scene.fog.far = camDist + 230;
  dof.uniforms.focus.value = camDist;

  // Nothing moving (paused, arm settled, camera still)? Drop to ~4 fps to save battery.
  const sig = [deck.theta, deck.lift, deck.spin, deck.coverT, deck.recordDrop, deck.pressed.size, stand.t, levels.bass,
    camera.position.x, camera.position.y, camera.position.z, settings.pitch, settings.rpm].map((v) => v.toFixed(4)).join();
  // A turning platter is always motion, even when the arm creeps too slowly to register.
  const weatherMoved = room.update(dt) | cat.update(dt); // both ~15×/s, so idle frames render at that rate, not 60
  const active = fixedDt !== undefined || deck.spin > 0.001 || sig !== lastSig || viewTween || drag || weatherMoved;
  lastSig = sig;
  idleFrames = active ? 0 : idleFrames + 1;
  if (idleFrames > 3 && idleFrames % 15 !== 0) return;

  composer.render(dt);
  cssRenderer.render(scene, camera);
  if (stand.group.visible) cutVideoHole();
}
let lastSig = '';
let idleFrames = 0;

// The video iframe sits *behind* the WebGL canvas. After the frame is drawn, re-draw the scene's depth
// and then the tablet's glass with a fully transparent colour, depth-tested: the canvas turns
// see-through only where the glass is actually visible, so anything in front of it (the deck, the
// tonearm) still hides the video like a real object would.
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
function cutVideoHole() {
  const bg = scene.background;
  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.clearDepth();
  scene.background = null;
  scene.overrideMaterial = depthOnly;
  deck.cover.visible = false; // clear acrylic shouldn't block the picture
  renderer.render(scene, camera);
  deck.cover.visible = true;
  scene.overrideMaterial = null;
  scene.background = bg;
  stand.hole.visible = true;
  renderer.render(stand.hole, camera);
  stand.hole.visible = false;
  renderer.autoClear = true;
}
renderer.setAnimationLoop(() => frame());

if (import.meta.env.DEV) window.__nd = { cat, room, frame, levels, speakers, stand, renderer, scene, camera, controls, deck, snap, sources, settings };
