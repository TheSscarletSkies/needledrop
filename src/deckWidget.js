// The turntable as a desktop widget: the same 3D deck as the main window, floating on the desktop
// in a transparent, resizable window. It doesn't play anything itself; it mirrors the main window's
// playback and sends the deck's controls back to it.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Turntable, TABLE_Y } from './scene/turntable.js';
import { loadImage } from './scene/textures.js';

const api = window.needledrop;
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.22; // from straight above the studio lights mirror in the vinyl; keep them faint

const key = new THREE.DirectionalLight(0xffeedd, 2.1);
key.position.set(-42, 48, -26); // low from the upper left: no glare off the vinyl, shadow falls down-right
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32 });
key.shadow.bias = -0.0003;
key.shadow.radius = 4;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
fill.position.set(40, 25, -10);
scene.add(fill);

// Only the deck's own soft shadow lands on the desktop.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.28 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = TABLE_Y;
ground.receiveShadow = true;
scene.add(ground);

const deck = new Turntable(scene);
deck.sleeve.visible = false;
deck.cover.visible = false; // lid off, the way you'd run it on a desk
deck.coverPanels = [];
deck.sleevePickables = []; // raycasts don't skip hidden objects

// Seen from directly above, like a product shot on a desk: flat and graphic on the Mac desktop,
// where the main window keeps its three-quarter view. An orthographic camera, so nothing
// foreshortens; the plinth (46 × 36) fills the window with a margin for its shadow.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
camera.position.set(0.9, 150, 1.1); // nudged toward the shadow so it isn't clipped
camera.up.set(0, 0, -1); // the back of the deck at the top of the window
camera.lookAt(0.9, 0, 1.1);
function fit() {
  const w = innerWidth, h = innerHeight;
  if (w < 2 || h < 2) return;
  renderer.setSize(w, h, false);
  let hw = 23 + 3.2, hh = 18 + 3.6;
  if (w / h > hw / hh) hw = hh * (w / h); else hh = hw / (w / h);
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
  dirty = true;
}
let dirty = true;
addEventListener('resize', fit);
fit();

// ---- state from the main window ----
const state = { mode: 'rest', progress: 0, spinning: false, finish: 'walnut', rpm: 33.333, pitch: 0, trackKey: null };
let artKey;
api?.onWidgetState(async (s) => {
  Object.assign(state, s);
  if (s.finish && s.finish !== deck.finish) deck.setFinish(s.finish);
  deck.setSpeed(state.rpm);
  if (!dragging.pitch) deck.setPitch(state.pitch || 0);
  if (s.art !== undefined) state.artData = s.art;
  const key = `${s.trackKey}|${s.vinyl}|${state.artData ? state.artData.length : 0}`;
  if (key !== artKey) {
    artKey = key;
    const img = await loadImage(state.artData);
    deck.setRecord({ img, vinyl: new THREE.Color(s.vinyl || '#0c0c0c'), track: { title: s.title, artist: s.artist } }, true);
  }
  dirty = true;
});
deck.setRecord({ img: null, vinyl: new THREE.Color(0x0c0c0c), track: null }, false);

const send = (cmd, arg) => api?.widgetCommand(cmd, arg);
deck.on('drop', (p) => send('seek', p));
deck.on('rest', () => send('pause'));

// ---- pointer: deck controls, or move the window from empty space ----
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const armPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -deck.armHeight);
const pitchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
const dragging = { arm: false, pitch: false, window: null };

function setPointer(e) {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
}

canvas.addEventListener('pointerdown', (e) => {
  setPointer(e);
  const hit = deck.pick(ray);
  canvas.setPointerCapture(e.pointerId);
  if (hit === 'arm') { dragging.arm = true; deck.startDrag(); canvas.className = 'grabbing'; return; }
  if (hit === 'pitch') { dragging.pitch = true; return; }
  if (hit === 'start' || hit === 'cue') { deck.press('start'); send('toggle'); return; }
  if (hit === '33' || hit === '45') { deck.press(hit); send('speed', hit === '33' ? 33.333 : 45); return; }
  // Empty space: drag the widget around the desktop.
  dragging.window = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY };
  canvas.className = 'move';
});

canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  const p = new THREE.Vector3();
  if (dragging.arm) { if (ray.ray.intersectPlane(armPlane, p)) deck.dragTo(p); dirty = true; return; }
  if (dragging.pitch) {
    if (ray.ray.intersectPlane(pitchPlane, p)) { const v = deck.pitchFromPoint(p); deck.setPitch(v); send('pitch', v); dirty = true; }
    return;
  }
  if (dragging.window) {
    const d = dragging.window;
    api?.widgetMoveTo(Math.round(d.wx + e.screenX - d.sx) | 0, Math.round(d.wy + e.screenY - d.sy) | 0);
    return;
  }
  const hit = deck.pick(ray);
  canvas.className = hit === 'arm' || hit === 'pitch' ? 'grab' : hit ? 'pointer' : '';
});

canvas.addEventListener('pointerup', () => {
  if (dragging.arm) deck.endDrag();
  dragging.arm = dragging.pitch = false;
  dragging.window = null;
  canvas.className = '';
});
canvas.addEventListener('dblclick', (e) => { setPointer(e); if (!deck.pick(ray)) send('open'); });
document.getElementById('close').addEventListener('click', () => send('close'));

// The × sits just off the plinth's back-right corner, not in the window's empty corner.
const closeBtn = document.getElementById('close');
const corner = new THREE.Vector3();
let closeAt = '';
function placeClose() {
  corner.set(23, 0.2, -18).project(camera); // plinth: 46 wide, 36 deep, top at y = 0
  const x = Math.min(innerWidth - 26, Math.max(4, (corner.x * 0.5 + 0.5) * innerWidth - 4));
  const y = Math.min(innerHeight - 26, Math.max(4, (-corner.y * 0.5 + 0.5) * innerHeight - 26));
  const at = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  if (at !== closeAt) closeBtn.style.transform = closeAt = at;
}

// ---- loop: full rate while anything moves, idle otherwise ----
const timer = new THREE.Timer();
let still = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const before = deck.theta + deck.lift;
  deck.update(dt, { mode: state.mode, progress: state.progress, spinning: state.spinning });
  const moving = state.spinning || deck.spin > 0.01 || Math.abs(deck.theta + deck.lift - before) > 1e-5 || deck.recordDrop > 0 || dragging.arm || deck.pressed.size;
  still = moving || dirty ? 0 : still + 1;
  if (still < 2) { renderer.render(scene, camera); placeClose(); }
  dirty = false;
});
