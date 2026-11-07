// The deck. Every part here either does something or is something a real direct-drive turntable has
// for a reason: the strobe dots verify speed under the lamp, the cue lever actually lifts the arm,
// the pitch slider changes speed, the dust cover opens and closes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  RECORD, FINISHES, makeRecordTextures, makeWoodTexture, makeStrobeRow, makeScaleRing, makeLegend,
  makeSleeveTexture, finishFor, makeBoardBump, makeInnerSleeveTexture, turnedMetalAnisotropy, makeLidSurface,
} from './textures.js';

const PLINTH = { w: 46, d: 36, h: 7 };
const TABLE_Y = -PLINTH.h - 1.4;
const CENTER = new THREE.Vector3(-4, 0, 0);       // spindle
const PIVOT = new THREE.Vector3(11, 0, -11.5);    // tonearm vertical bearing
const ARM_LEN = 19;                               // effective length: pivot → stylus tip
const ARM_HEIGHT = 3.3;                           // tube centre above the plinth
const MAT_TOP = 1.85;
const RECORD_TOP = MAT_TOP + 0.2;
const REST_THETA = THREE.MathUtils.degToRad(78);
const PITCH_RANGE = 0.08;
const PITCH_Z = { center: 8.6, travel: 4.4 };
const OFFSET_ANGLE = THREE.MathUtils.degToRad(22);  // headshell offset, for groove tangency

// ---- tonearm geometry (xz-plane, angle = atan2(z, x)) ----
const D = new THREE.Vector2(CENTER.x - PIVOT.x, CENTER.z - PIVOT.z);
const PHI = Math.atan2(D.y, D.x);
const DIST = D.length();
function thetaForRadius(r) {
  const c = (DIST * DIST + ARM_LEN * ARM_LEN - r * r) / (2 * DIST * ARM_LEN);
  return PHI - Math.acos(THREE.MathUtils.clamp(c, -1, 1));
}
function radiusForTheta(theta) {
  return Math.hypot(PIVOT.x + Math.cos(theta) * ARM_LEN - CENTER.x, PIVOT.z + Math.sin(theta) * ARM_LEN - CENTER.z);
}
const THETA_LEAD = thetaForRadius(RECORD.leadIn);
const THETA_END = thetaForRadius(RECORD.runOut);
const progressToTheta = (p) => thetaForRadius(RECORD.leadIn - THREE.MathUtils.clamp(p, 0, 1) * (RECORD.leadIn - RECORD.runOut));
const radiusToProgress = (r) => (RECORD.leadIn - r) / (RECORD.leadIn - RECORD.runOut);
// A point in arm space (x along the arm, z toward the spindle) → world xz, for a given swing angle.
function armToWorld(x, z, theta) {
  return new THREE.Vector3(PIVOT.x + Math.cos(theta) * x - Math.sin(theta) * z, 0, PIVOT.z + Math.sin(theta) * x + Math.cos(theta) * z);
}

// S-shaped arm tube: leaves the pivot straight, bends away, then comes back in at the offset angle
// so the headshell meets the stylus pointing along the groove.
const HEAD_BACK = 2.9;
const TUBE_END = new THREE.Vector3(ARM_LEN - Math.cos(OFFSET_ANGLE) * HEAD_BACK, 0, -Math.sin(OFFSET_ANGLE) * HEAD_BACK);
const ARM_CURVE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-2.4, 0, 0),
  new THREE.Vector3(3.5, 0, 0),
  new THREE.Vector3(8, 0, -0.55),
  new THREE.Vector3(12, 0, -1.75),
  TUBE_END.clone().add(new THREE.Vector3(-Math.cos(OFFSET_ANGLE) * 1.8, 0, -Math.sin(OFFSET_ANGLE) * 1.8)),
  TUBE_END,
], false, 'centripetal');
function curvePointAtX(x) {
  const pts = ARM_CURVE.getSpacedPoints(200);
  return pts.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
}
const REST_POINT = curvePointAtX(ARM_LEN - 4.2);   // where the tube sits in its cradle
const CUE_POINT = curvePointAtX(5.0);              // where the cue platform meets the tube

export class Turntable {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);

    this.spin = 0;
    this.rpm = 33.333;
    this.pitch = 0;
    this.theta = REST_THETA;
    this.lift = 0;
    this.dragging = false;
    this.dragTheta = REST_THETA;
    this.landed = false;
    this.recordDrop = 0;
    this.coverOpen = true;
    this.coverT = 1;
    this.legends = [];
    this.pressed = new Map();
    this.listeners = {};

    this.#materials();
    this.#plinth();
    this.#platter();
    this.#record();
    this.#tonearm();
    this.#controls();
    this.#cover();
    this.#sleeve();
    this.setFinish('walnut');
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  #emit(evt, ...a) { (this.listeners[evt] || []).forEach((fn) => fn(...a)); }

  #mesh(geo, mat, parent = this.root, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  }

  #materials() {
    const aniso = turnedMetalAnisotropy();
    this.mat = {
      wood: new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 }),
      alu: new THREE.MeshPhysicalMaterial({ color: 0xcfcac2, metalness: 1, roughness: 0.32, anisotropy: 0.8, anisotropyMap: aniso }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.12 }),
      satin: new THREE.MeshStandardMaterial({ color: 0x9c9893, metalness: 1, roughness: 0.38 }),
      black: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.2, roughness: 0.45 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.92 }),
      felt: new THREE.MeshPhysicalMaterial({ color: 0x2a2a2a, roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: 0x555555 }),
    };
  }

  // ---------------- plinth ----------------
  #plinth() {
    const body = this.#mesh(new RoundedBoxGeometry(PLINTH.w, PLINTH.h, PLINTH.d, 8, 1.0), this.mat.wood);
    body.position.y = -PLINTH.h / 2;

    // Isolation feet: rubber damper under a machined cup.
    for (const [x, z] of [[-19.5, -14.5], [19.5, -14.5], [-19.5, 14.5], [19.5, 14.5]]) {
      const cup = this.#mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.9, 48), this.mat.satin);
      cup.position.set(x, -PLINTH.h - 0.45, z);
      const damper = this.#mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.5, 48), this.mat.rubber);
      damper.position.set(x, -PLINTH.h - 1.15, z);
    }

    // Maker's legend, back left.
    this.#legend(-15.6, -16.2, 10, 2, (ctx, w, h, f) => {
      ctx.font = `italic ${h * 0.55}px ${f.SERIF}`;
      ctx.textAlign = 'left';
      ctx.fillText('Needledrop', 0, h * 0.38);
      ctx.font = `600 ${h * 0.2}px ${f.SANS}`;
      ctx.globalAlpha = 0.75;
      ctx.fillText('MODEL ONE  ·  QUARTZ DIRECT DRIVE', 2, h * 0.82);
    }, { anchorLeft: true });
  }

  // Silk-screened text/graphics printed onto the plinth top.
  #legend(x, z, w, h, draw, { anchorLeft = false } = {}) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: makeLegend(w, h, draw), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(anchorLeft ? x + w / 2 : x, 0.004, z);
    m.receiveShadow = true;
    this.root.add(m);
    this.legends.push(m.material);
    return m;
  }

  // ---------------- platter ----------------
  #platter() {
    this.platter = new THREE.Group();
    this.platter.position.copy(CENTER);
    this.root.add(this.platter);

    // Bearing skirt visible under the platter edge.
    const skirt = this.#mesh(new THREE.CylinderGeometry(14.2, 14.2, 0.4, 96), this.mat.black, this.root);
    skirt.position.set(CENTER.x, 0.2, CENTER.z);

    const body = this.#mesh(new THREE.CylinderGeometry(15.5, 15.5, 1.45, 160, 1, false), [this.mat.satin, this.mat.alu, this.mat.satin], this.platter);
    body.position.y = 1.125;

    // Two strobe rows: 180 dots read still at 33⅓, 133 dots at 45, under the 100 Hz lamp.
    // They are not parented to the platter: their apparent motion is computed from the real speed.
    this.strobeRows = [[180, 33.333, 1.48], [133, 45, 0.86]].map(([dots, rpm, y]) => {
      const m = this.#mesh(
        new THREE.CylinderGeometry(15.53, 15.53, 0.5, 160, 1, true),
        new THREE.MeshStandardMaterial({ map: makeStrobeRow(dots), metalness: 0.75, roughness: 0.35 }),
        this.root, { cast: false },
      );
      m.position.set(CENTER.x, y, CENTER.z);
      m.userData.cal = (rpm / 60) * Math.PI * 2;
      return m;
    });

    this.#mesh(new THREE.CylinderGeometry(14.9, 14.9, 0.2, 128), this.mat.felt, this.platter).position.y = MAT_TOP - 0.1;
  }

  // ---------------- record ----------------
  #record() {
    this.recordGroup = new THREE.Group();
    this.recordGroup.position.copy(CENTER);
    this.root.add(this.recordGroup);
    this.recordSpin = new THREE.Group();
    this.recordGroup.add(this.recordSpin);

    // Deep black with a soft sheen: the room shows in it faintly, never as white rings.
    this.recordFace = new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 0, anisotropy: 1, clearcoat: 0.14, clearcoatRoughness: 0.32, envMapIntensity: 0.55 });
    this.recordBody = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0b, roughness: 0.22, clearcoat: 0.5 });

    // Playing surface (flat, planar UVs) + raised edge bead + underside.
    const face = this.#mesh(new THREE.CircleGeometry(RECORD.flat, 192), this.recordFace, this.recordSpin);
    face.rotation.x = -Math.PI / 2;
    face.position.y = RECORD_TOP;
    const profile = [
      [RECORD.flat - 0.02, MAT_TOP], [RECORD.radius - 0.05, MAT_TOP + 0.005], [RECORD.radius, MAT_TOP + 0.06],
      [RECORD.radius, MAT_TOP + 0.17], [RECORD.radius - 0.06, RECORD_TOP + 0.035], [RECORD.flat + 0.06, RECORD_TOP + 0.04],
      [RECORD.flat - 0.02, RECORD_TOP],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    this.#mesh(new THREE.LatheGeometry(profile, 192), this.recordBody, this.recordSpin);
    const under = this.#mesh(new THREE.CircleGeometry(RECORD.flat, 96), this.recordBody, this.recordSpin);
    under.rotation.x = Math.PI / 2;
    under.position.y = MAT_TOP + 0.002;

    // Spindle with a chamfered tip.
    const spindle = this.#mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.1, 32), this.mat.chrome);
    spindle.position.set(CENTER.x, RECORD_TOP + 0.4, CENTER.z);
    const tip = this.#mesh(new THREE.CylinderGeometry(0.16, 0.36, 0.3, 32), this.mat.chrome);
    tip.position.set(CENTER.x, RECORD_TOP + 1.1, CENTER.z);
  }

  // ---------------- tonearm ----------------
  #tonearm() {
    const { alu, chrome, satin, black } = this.mat;

    // Base: plate, height-adjust collar, anti-skate dial.
    const plate = this.#mesh(new THREE.CylinderGeometry(3.0, 3.1, 0.35, 64), alu);
    plate.position.set(PIVOT.x, 0.175, PIVOT.z);
    const collar = this.#mesh(new THREE.CylinderGeometry(1.75, 1.75, 1.2, 48), black);
    collar.position.set(PIVOT.x, 0.95, PIVOT.z);
    const collarRing = this.#mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.32, 48), satin);
    collarRing.position.set(PIVOT.x, 1.25, PIVOT.z);
    const post = this.#mesh(new THREE.CylinderGeometry(0.75, 0.75, ARM_HEIGHT - 1.5, 32), chrome);
    post.position.set(PIVOT.x, 1.5 + (ARM_HEIGHT - 1.5) / 2 - 0.4, PIVOT.z);
    const skate = this.#mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 32), [satin, alu, alu]);
    skate.position.set(PIVOT.x + 2.25, 0.6, PIVOT.z + 2.2);
    this.#legend(PIVOT.x + 2.25, PIVOT.z + 3.55, 3.4, 0.5, (ctx, w, h, f) => {
      ctx.font = `600 ${h * 0.6}px ${f.SANS}`;
      ctx.fillText('ANTI-SKATING', w / 2, h / 2);
    });

    // Yaw: horizontal swing. Holds the gimbal yoke and the vertical-bearing housing.
    this.armYaw = new THREE.Group();
    this.armYaw.position.set(PIVOT.x, ARM_HEIGHT, PIVOT.z);
    this.root.add(this.armYaw);
    const housing = this.#mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.3, 40), satin, this.armYaw);
    housing.position.y = -0.2;
    for (const s of [-1, 1]) {
      const cap = this.#mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.35, 24), chrome, this.armYaw);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(0, 0, s * 1.05);
    }

    // Lift: rotates about the horizontal bearing axis.
    this.armLift = new THREE.Group();
    this.armYaw.add(this.armLift);
    const arm = this.armLift;
    this.armPickables = [];

    const tube = this.#mesh(new THREE.TubeGeometry(ARM_CURVE, 160, 0.235, 20, false), chrome, arm);
    this.armPickables.push(tube);

    // Rear stub, counterweight with tracking-force scale ring.
    const stub = this.#mesh(new THREE.CylinderGeometry(0.3, 0.3, 4.4, 20), satin, arm);
    stub.rotation.z = Math.PI / 2;
    stub.position.x = -4.2;
    const cw = this.#mesh(new THREE.CylinderGeometry(1.35, 1.35, 2.4, 64), [black, alu, alu], arm);
    cw.rotation.z = Math.PI / 2;
    cw.position.x = -5.3;
    const scale = this.#mesh(new THREE.CylinderGeometry(1.38, 1.38, 0.55, 64, 1, true), new THREE.MeshStandardMaterial({ map: makeScaleRing(), roughness: 0.4, metalness: 0.3 }), arm);
    scale.rotation.z = Math.PI / 2;
    scale.position.x = -3.85;

    // Headshell: offset plate, finger lift, locking collar; cartridge with cantilever and stylus.
    const head = new THREE.Group();
    head.position.set(ARM_LEN, 0, 0);
    head.rotation.y = -OFFSET_ANGLE;
    arm.add(head);
    this.head = head;
    const lock = this.#mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 24), black, head);
    lock.rotation.z = Math.PI / 2;
    lock.position.set(-HEAD_BACK + 0.2, 0, 0);
    const shell = this.#mesh(new RoundedBoxGeometry(2.9, 0.22, 1.75, 3, 0.1), satin, head);
    shell.position.set(-1.25, -0.28, 0);
    const finger = this.#mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.7, -0.28, -0.75), new THREE.Vector3(-0.4, -0.25, -1.6), new THREE.Vector3(-0.25, 0.05, -2.2), new THREE.Vector3(-0.2, 0.35, -2.35),
    ]), 24, 0.09, 10), chrome, head);
    const cart = this.#mesh(new RoundedBoxGeometry(1.7, 0.6, 1.15, 3, 0.1), black, head);
    cart.position.set(-0.55, -0.69, 0);
    const accent = this.#mesh(new THREE.BoxGeometry(0.06, 0.4, 0.9), new THREE.MeshStandardMaterial({ color: 0xb8902f, metalness: 1, roughness: 0.3 }), head);
    accent.position.set(0.31, -0.68, 0);
    const tipY = RECORD_TOP - ARM_HEIGHT;
    const cantilever = this.#mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 1, roughness: 0.25 }), head);
    cantilever.position.set(0.08, tipY + 0.2, 0);
    cantilever.rotation.z = 0.75;
    this.armPickables.push(shell, cart, finger, lock);

    // Arm rest with rubber cradle, positioned under where the tube actually sits when parked.
    const rp = armToWorld(REST_POINT.x, REST_POINT.z, REST_THETA);
    const restPost = this.#mesh(new THREE.CylinderGeometry(0.32, 0.38, ARM_HEIGHT - 0.6, 20), satin);
    restPost.position.set(rp.x, (ARM_HEIGHT - 0.6) / 2, rp.z);
    const restBase = this.#mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.25, 24), alu);
    restBase.position.set(rp.x, 0.125, rp.z);
    const cradle = this.#mesh(new THREE.TorusGeometry(0.42, 0.13, 10, 20, Math.PI), this.mat.rubber);
    cradle.position.set(rp.x, ARM_HEIGHT - 0.24, rp.z);
    cradle.rotation.set(Math.PI, 0, 0);
    cradle.rotation.order = 'YXZ';
    cradle.rotation.y = -REST_THETA + Math.PI / 2;

    // Cue: a lever by the base, and a platform arc that rises to lift the tube.
    const cueR = Math.hypot(CUE_POINT.x, CUE_POINT.z);
    const cueOffset = Math.atan2(CUE_POINT.z, CUE_POINT.x);
    const a0 = REST_THETA + cueOffset - 0.08;
    const a1 = THETA_END + cueOffset + 0.06;
    this.cuePlatform = new THREE.Group();
    this.cuePlatform.position.set(PIVOT.x, 0, PIVOT.z);
    this.root.add(this.cuePlatform);
    const arc = this.#mesh(new THREE.TorusGeometry(cueR, 0.16, 8, 32, a1 - a0), black, this.cuePlatform);
    arc.rotation.x = Math.PI / 2;
    arc.rotation.z = a0;
    const cueMid = a0 + 0.1; // post sits at the outer end, clear of the platter
    const cuePost = this.#mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.4, 16), chrome, this.root);
    cuePost.position.set(PIVOT.x + Math.cos(cueMid) * (cueR + 0.45), 1.2, PIVOT.z + Math.sin(cueMid) * (cueR + 0.45));
    this.cueBaseY = ARM_HEIGHT - 0.235 - 0.13 - 0.25;
    this.cueTravel = Math.sin(0.08) * cueR + 0.25;

    this.cueLever = new THREE.Group();
    this.cueLever.position.set(PIVOT.x + 3.55, 0.5, PIVOT.z + 0.4);
    this.root.add(this.cueLever);
    const cueHub = this.#mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 24), satin);
    cueHub.position.set(PIVOT.x + 3.55, 0.35, PIVOT.z + 0.4);
    const handle = this.#mesh(new RoundedBoxGeometry(0.42, 0.42, 3.1, 2, 0.15), chrome, this.cueLever);
    handle.position.z = 1.5;
    handle.userData.button = 'cue';
    const knob = this.#mesh(new THREE.SphereGeometry(0.34, 20, 12), black, this.cueLever);
    knob.position.z = 3.05;
    knob.userData.button = 'cue';
    this.cuePickables = [handle, knob];
    this.#legend(PIVOT.x + 5.3, PIVOT.z + 2.4, 1.8, 1.2, (ctx, w, h, f) => {
      ctx.font = `600 ${h * 0.28}px ${f.SANS}`;
      ctx.fillText('▲ UP', w / 2, h * 0.28);
      ctx.fillText('▼ DOWN', w / 2, h * 0.75);
    });
  }

  // ---------------- controls ----------------
  #controls() {
    const { alu, satin, black } = this.mat;
    this.buttons = {};
    const button = (name, x, z, w, d) => {
      const b = this.#mesh(new RoundedBoxGeometry(w, 0.55, d, 3, 0.16), satin);
      b.position.set(x, 0.18, z);
      b.userData.button = name;
      b.userData.restY = 0.18;
      const well = this.#mesh(new RoundedBoxGeometry(w + 0.25, 0.1, d + 0.25, 2, 0.05), black);
      well.position.set(x, 0.0, z);
      this.buttons[name] = b;
      return b;
    };
    button('start', -18.0, 14.9, 4.6, 2.2);
    button('33', -12.9, 15.1, 2.3, 1.5);
    button('45', -10.2, 15.1, 2.3, 1.5);

    // Engraved, ink-filled legends on the button caps, so you can tell 33 from 45 at a glance.
    const capLegend = (name, w, d, draw) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ map: makeLegend(w, d, draw, 96), transparent: true, color: 0x26221e, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.28;
      this.buttons[name].add(m);
    };
    capLegend('33', 2.1, 1.3, (ctx, w, h, f) => { ctx.font = `600 ${h * 0.6}px ${f.SANS}`; ctx.fillText('33', w / 2, h * 0.54); });
    capLegend('45', 2.1, 1.3, (ctx, w, h, f) => { ctx.font = `600 ${h * 0.6}px ${f.SANS}`; ctx.fillText('45', w / 2, h * 0.54); });
    capLegend('start', 4.3, 1.9, (ctx, w, h, f) => {
      ctx.font = `600 ${h * 0.3}px ${f.SANS}`;
      ctx.fillText('START', w / 2, h * 0.36);
      ctx.fillText('STOP', w / 2, h * 0.72);
    });

    const led = (x, z) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x1a0d05, emissive: 0xff7a1a, emissiveIntensity: 0 });
      this.#mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16), m).position.set(x, 0.04, z);
      return m;
    };
    this.led33 = led(-12.9, 13.75);
    this.led45 = led(-10.2, 13.75);

    this.#legend(-18.0, 13.25, 5, 0.7, (ctx, w, h, f) => {
      ctx.font = `600 ${h * 0.5}px ${f.SANS}`;
      ctx.fillText('START · STOP', w / 2, h / 2);
    });
    this.#legend(-11.55, 16.45, 6, 0.7, (ctx, w, h, f) => {
      ctx.font = `600 ${h * 0.55}px ${f.SANS}`;
      ctx.fillText('33', w * 0.275, h / 2);
      ctx.fillText('45', w * 0.725, h / 2);
    });

    // Strobe lamp: lights the platter rim so the dots can be read.
    const lampPos = new THREE.Vector3(-18.6, 0, 9.2);
    const toCenter = Math.atan2(CENTER.z - lampPos.z, CENTER.x - lampPos.x);
    const lamp = new THREE.Group();
    lamp.position.copy(lampPos);
    lamp.rotation.y = -toCenter;
    this.root.add(lamp);
    this.#mesh(new THREE.CylinderGeometry(1.0, 1.05, 0.3, 32), alu, lamp).position.y = 0.15;
    const hood = this.#mesh(new RoundedBoxGeometry(1.5, 1.6, 1.3, 3, 0.25), black, lamp);
    hood.position.y = 1.0;
    this.lampLens = new THREE.MeshStandardMaterial({ color: 0x2a0800, emissive: 0xff4a12, emissiveIntensity: 0 });
    const lens = this.#mesh(new THREE.CircleGeometry(0.45, 24), this.lampLens, lamp, { cast: false });
    lens.position.set(0.76, 1.05, 0);
    lens.rotation.y = Math.PI / 2;
    this.lampLight = new THREE.SpotLight(0xff5a1e, 0, 9, 0.75, 0.6, 1.4);
    this.lampLight.position.set(lampPos.x + Math.cos(toCenter) * 0.9, 1.05, lampPos.z + Math.sin(toCenter) * 0.9);
    this.lampLight.target.position.set(lampPos.x + Math.cos(toCenter) * 3, 1.2, lampPos.z + Math.sin(toCenter) * 3);
    this.root.add(this.lampLight, this.lampLight.target);

    // Target light: a small pop-up lamp beside the platter that lights the stylus, so you can cue
    // the needle in a dark room. Its glow sits where the needle meets the record.
    const tl = new THREE.Vector3(12.6, 0, 13.4);
    const aim = new THREE.Vector3(7.5, RECORD_TOP, 3.5);
    const toAim = Math.atan2(aim.z - tl.z, aim.x - tl.x);
    this.#mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.25, 32), alu).position.set(tl.x, 0.125, tl.z);
    const stem = this.#mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.9, 16), satin);
    stem.position.set(tl.x, 1.15, tl.z);
    const head = new THREE.Group();
    head.position.set(tl.x, 2.15, tl.z);
    head.rotation.order = 'YZX';
    head.rotation.y = -toAim;
    head.rotation.z = -0.35; // tilted down toward the record
    this.root.add(head);
    const tHood = this.#mesh(new THREE.CylinderGeometry(0.42, 0.52, 1.1, 24), black, head);
    tHood.rotation.z = Math.PI / 2;
    this.targetLens = new THREE.MeshStandardMaterial({ color: 0x332a1e, emissive: 0xfff0d2, emissiveIntensity: 3.2 });
    const tLens = this.#mesh(new THREE.CircleGeometry(0.4, 24), this.targetLens, head, { cast: false });
    tLens.position.x = 0.56;
    tLens.rotation.y = Math.PI / 2;
    this.targetLight = new THREE.SpotLight(0xffecc8, 1300, 30, 0.3, 0.8, 2);
    this.targetLight.position.set(tl.x + Math.cos(toAim) * 0.6, 2.0, tl.z + Math.sin(toAim) * 0.6);
    this.targetLight.target.position.copy(aim);
    this.root.add(this.targetLight, this.targetLight.target);

    // Pitch slider ±8 %, with a quartz-lock light that only shows at exactly 0.
    const slot = this.#mesh(new RoundedBoxGeometry(0.7, 0.12, PITCH_Z.travel * 2 + 1.6, 2, 0.05), this.mat.rubber);
    slot.position.set(19.6, 0.0, PITCH_Z.center);
    this.pitchKnob = this.#mesh(new RoundedBoxGeometry(2.1, 0.8, 1.25, 3, 0.18), alu);
    this.pitchKnob.position.set(19.6, 0.45, PITCH_Z.center);
    this.pitchKnob.userData.button = 'pitch';
    const line = this.#mesh(new THREE.BoxGeometry(2.12, 0.04, 0.08), black, this.pitchKnob);
    line.position.y = 0.4;
    this.#legend(17.6, PITCH_Z.center, 1.8, PITCH_Z.travel * 2 + 1.4, (ctx, w, h, f) => {
      const top = h * (0.7 / (PITCH_Z.travel * 2 + 1.4));
      const bottom = h - top;
      ctx.lineWidth = 2;
      for (let i = 0; i <= 16; i++) {
        const y = top + ((bottom - top) * i) / 16;
        const long = i % 4 === 0;
        ctx.beginPath();
        ctx.moveTo(w - (long ? w * 0.42 : w * 0.24), y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.font = `600 ${w * 0.22}px ${f.SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText('−8', 0, top);
      ctx.fillText('0', w * 0.08, (top + bottom) / 2);
      ctx.fillText('+8', 0, bottom);
    });
    this.#legend(19.6, PITCH_Z.center - PITCH_Z.travel - 1.6, 3, 0.7, (ctx, w, h, f) => {
      ctx.font = `600 ${h * 0.5}px ${f.SANS}`;
      ctx.fillText('PITCH', w / 2, h / 2);
    });
    this.ledPitch = new THREE.MeshStandardMaterial({ color: 0x07140a, emissive: 0x4dff7a, emissiveIntensity: 0 });
    this.#mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16), this.ledPitch).position.set(21.4, 0.04, PITCH_Z.center);
  }

  // ---------------- dust cover ----------------
  // One moulded smoked-acrylic shell with rounded corners and real wall thickness, on friction hinges.
  #cover() {
    const W = PLINTH.w - 1.4, D = PLINTH.d - 1.4, H = 10.5, T = 0.32, R = 1.4;
    const rounded = (w, d, r) => {
      const sh = new THREE.Shape();
      const x = -w / 2, y = -d / 2;
      sh.moveTo(x + r, y);
      sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
      sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
      sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r);
      sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
      return sh;
    };

    // Smoked acrylic (PMMA, ior 1.49): the scene behind is refracted and tinted. Faces are thin;
    // cut edges are looked at "through" the whole sheet, so they read darker and glossier.
    // Neutral grey smoke: a warm tint turns muddy brown against a bright wall.
    const smoke = new THREE.Color(0x4a4947);
    const face = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 1, roughnessMap: makeLidSurface(W, D), transmission: 1, thickness: T,
      ior: 1.49, attenuationColor: smoke, attenuationDistance: 0.9, specularIntensity: 1, envMapIntensity: 1.5,
    });
    const wallFace = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: T,
      ior: 1.49, attenuationColor: smoke, attenuationDistance: 0.9, specularIntensity: 1, envMapIntensity: 1.5,
    });
    // Polished cut edges: a pale, glossy line that catches the light, rather than a dark frame
    // (which is what a tinted see-through edge looks like against a bright wall).
    const edge = new THREE.MeshPhysicalMaterial({
      color: 0xb8b3ad, metalness: 0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.45, depthWrite: false, envMapIntensity: 1.6,
    });

    this.cover = new THREE.Group();
    this.cover.position.set(0, 0.22, -D / 2);
    this.root.add(this.cover);

    // Walls: a rounded-rectangle ring extruded upward. ExtrudeGeometry groups: 0 = caps (the cut
    // edges here), 1 = sides (the inner and outer faces).
    const ring = rounded(W, D, R);
    ring.holes.push(rounded(W - 2 * T, D - 2 * T, R - T));
    const wallsGeo = new THREE.ExtrudeGeometry(ring, { depth: H - T, bevelEnabled: false, curveSegments: 10 });
    wallsGeo.rotateX(-Math.PI / 2);
    wallsGeo.translate(0, 0, D / 2);
    const walls = this.#mesh(wallsGeo, [edge, wallFace], this.cover, { cast: false, receive: false });

    // Top: here the caps are the big faces and the sides are the edges.
    const topGeo = new THREE.ExtrudeGeometry(rounded(W - 0.16, D - 0.16, R - 0.08), {
      depth: T - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 10,
    });
    topGeo.rotateX(-Math.PI / 2);
    topGeo.translate(0, H - T + 0.08, D / 2);
    const top = this.#mesh(topGeo, [face, edge], this.cover, { cast: false, receive: false });
    walls.userData.button = top.userData.button = 'cover';
    this.coverPanels = [walls, top];

    // Silk-screened mark on the lid, back centre.
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.6),
      new THREE.MeshBasicMaterial({
        map: makeLegend(9, 1.6, (ctx, w, h, f) => { ctx.font = `italic ${h * 0.62}px ${f.SERIF}`; ctx.fillText('Needledrop', w / 2, h / 2); }),
        transparent: true, opacity: 0.4, depthWrite: false, color: 0xeee6da,
      }),
    );
    logo.rotation.x = -Math.PI / 2;
    logo.position.set(0, H + 0.01, D * 0.2);
    this.cover.add(logo);

    // Friction hinges: a block in the plinth's back edge with a barrel, and a bracket screwed to the lid.
    for (const x of [-15, 15]) {
      const block = this.#mesh(new RoundedBoxGeometry(3.6, 1.5, 2.0, 3, 0.2), this.mat.black, this.root);
      block.position.set(x, -0.35, -D / 2 - 0.55);
      const barrel = this.#mesh(new THREE.CylinderGeometry(0.34, 0.34, 3.2, 20), this.mat.satin, this.root);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(x, 0.22, -D / 2 - 0.3);
      const bracket = this.#mesh(new RoundedBoxGeometry(2.8, 4.4, 0.2, 2, 0.08), this.mat.satin, this.cover);
      bracket.position.set(x, 2.3, -0.12);
      for (const y of [1.6, 3.5]) {
        const screw = this.#mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), this.mat.chrome, this.cover);
        screw.rotation.x = Math.PI / 2;
        screw.position.set(x, y, -0.25);
      }
    }

    // Rubber bumpers the lid rests on when closed.
    for (const [x, z] of [[-W / 2 + 1, -D / 2 + 1], [W / 2 - 1, -D / 2 + 1], [-W / 2 + 1, D / 2 - 1], [W / 2 - 1, D / 2 - 1]]) {
      this.#mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 16), this.mat.rubber, this.root).position.set(x, 0.1, z);
    }
  }

  // ---------------- album jacket ----------------
  #sleeve() {
    // Printed board with a linen emboss you can see where the window light rakes across it.
    this.sleeveTop = new THREE.MeshStandardMaterial({ roughness: 0.7, bumpMap: makeBoardBump(), bumpScale: 0.6 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.85 });
    this.sleeve = new THREE.Group();
    this.sleeve.position.set(-45, TABLE_Y, 3);
    this.sleeve.rotation.y = 0.13;
    this.root.add(this.sleeve);
    const jacket = this.#mesh(new RoundedBoxGeometry(31.4, 0.32, 31.4, 2, 0.08), [edge, edge, this.sleeveTop, edge, edge, edge], this.sleeve);
    jacket.position.y = 0.36;
    jacket.userData.button = 'sleeve';
    // Paper inner sleeve slipping out of the open side.
    const inner = this.#mesh(new THREE.BoxGeometry(30.6, 0.12, 30.6), new THREE.MeshStandardMaterial({ map: makeInnerSleeveTexture(), roughness: 0.95 }), this.sleeve);
    inner.position.set(3.0, 0.07, -0.2);
    inner.rotation.y = -0.05;
    inner.userData.button = 'sleeve';
    this.sleevePickables = [jacket, inner];
  }

  // ---------------- public API ----------------
  setFinish(name) {
    const f = finishFor(name);
    this.finish = name;
    this.mat.wood.map?.dispose();
    this.mat.wood.map = makeWoodTexture(f);
    this.mat.wood.roughness = f.roughness;
    this.mat.wood.clearcoat = f.lacquer;
    this.mat.wood.needsUpdate = true;
    this.mat.alu.color.set(f.metal);
    this.mat.felt.color.set(f.felt);
    for (const m of this.legends) m.color.set(f.ink);
    return f;
  }

  setRecord({ img, vinyl, track }, animate = true) {
    const { map, roughnessMap, anisotropyMap } = makeRecordTextures({ img, vinyl, track });
    const m = this.recordFace;
    m.map?.dispose(); m.roughnessMap?.dispose(); m.anisotropyMap?.dispose();
    Object.assign(m, { map, roughnessMap, anisotropyMap });
    m.needsUpdate = true;
    this.recordBody.color.copy(vinyl).multiplyScalar(0.85);
    this.sleeveTop.map?.dispose();
    this.sleeveTop.map = makeSleeveTexture({ img, track });
    this.sleeveTop.needsUpdate = true;
    if (animate) this.recordDrop = 1;
  }

  setSpeed(rpm) { this.rpm = rpm; }

  setPitch(p) {
    this.pitch = THREE.MathUtils.clamp(p, -PITCH_RANGE, PITCH_RANGE);
    this.pitchKnob.position.z = PITCH_Z.center + (this.pitch / PITCH_RANGE) * PITCH_Z.travel;
  }

  press(name) {
    if (this.buttons[name]) this.pressed.set(name, 0.14);
  }

  toggleCover() { this.coverOpen = !this.coverOpen; }

  headshellPosition(target = new THREE.Vector3()) { return this.head.getWorldPosition(target); }

  pick(raycaster) {
    const targets = [
      ...this.armPickables, ...this.cuePickables, ...Object.values(this.buttons), this.pitchKnob,
      ...this.sleevePickables, ...(this.coverT > 0.02 && this.coverT < 0.98 ? [] : this.coverPanels),
    ];
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const o = hits[0].object;
    return o.userData.button || 'arm';
  }

  startDrag() { this.dragging = true; this.dragTheta = this.theta; }
  dragTo(point) {
    this.dragTheta = THREE.MathUtils.clamp(Math.atan2(point.z - PIVOT.z, point.x - PIVOT.x), REST_THETA, THETA_END + 0.02);
  }
  endDrag() {
    this.dragging = false;
    const r = radiusForTheta(this.dragTheta);
    if (r <= RECORD.leadIn + 0.6 && r >= RECORD.runOut - 0.3) this.#emit('drop', THREE.MathUtils.clamp(radiusToProgress(r), 0, 0.999));
    else this.#emit('rest');
  }
  // Pointer z on the slider plane → pitch, with a soft detent at 0.
  pitchFromPoint(point) {
    let p = ((point.z - PITCH_Z.center) / PITCH_Z.travel) * PITCH_RANGE;
    if (Math.abs(p) < 0.004) p = 0;
    return THREE.MathUtils.clamp(Math.round(p * 1000) / 1000, -PITCH_RANGE, PITCH_RANGE);
  }

  get armHeight() { return ARM_HEIGHT; }
  get coverClosed() { return this.coverT < 0.5; }

  /**
   * mode: 'rest' (arm parked), 'play' (needle on the record at `progress`), 'cue' (lifted in place)
   * spinning: whether the motor is on.
   */
  update(dt, { mode, progress, spinning }) {
    // Motor: quartz direct drive gets up to speed quickly and coasts down.
    const target = spinning ? (this.rpm * (1 + this.pitch) / 60) * Math.PI * 2 : 0;
    this.spin += (target - this.spin) * (1 - Math.exp(-(spinning ? 3.2 : 1.2) * dt));
    const dA = this.spin * dt;
    this.platter.rotation.y -= dA;
    this.recordSpin.rotation.y -= dA;

    // Strobe dots, as seen under the 100 Hz lamp: apparent drift = ω − k·ω_cal.
    for (const row of this.strobeRows) {
      const cal = row.userData.cal;
      const apparent = this.spin - Math.round(this.spin / cal) * cal;
      row.rotation.y -= apparent * dt;
    }

    // Lights
    const on33 = this.rpm < 40;
    // Small indicator lamps: lit, but soft, the way they look in a lit room rather than a dark one.
    this.led33.emissiveIntensity = on33 ? 2.6 : 0;
    this.led45.emissiveIntensity = on33 ? 0 : 2.6;
    this.ledPitch.emissiveIntensity = this.pitch === 0 ? 2.2 : 0;
    this.lampLens.emissiveIntensity = 2.4;
    this.lampLight.intensity = 30;

    // Button travel
    for (const [name, t] of this.pressed) {
      const left = t - dt;
      const b = this.buttons[name];
      b.position.y = b.userData.restY - (left > 0 ? 0.14 : 0);
      if (left <= 0) this.pressed.delete(name); else this.pressed.set(name, left);
    }

    // New pressing settles onto the platter.
    if (this.recordDrop > 0) {
      this.recordDrop = Math.max(0, this.recordDrop - dt * 1.4);
      this.recordGroup.position.y = this.recordDrop ** 2 * 7;
    }

    // Dust cover
    const goal = this.coverOpen ? 1 : 0;
    this.coverT += Math.sign(goal - this.coverT) * Math.min(Math.abs(goal - this.coverT), dt * 1.3);
    const e = this.coverT < 0.5 ? 2 * this.coverT ** 2 : 1 - (-2 * this.coverT + 2) ** 2 / 2;
    this.cover.rotation.x = -e * 1.32;

    // Tonearm
    let targetTheta = REST_THETA;
    if (mode === 'play') targetTheta = progressToTheta(progress);
    else if (mode === 'cue') targetTheta = this.theta < REST_THETA + 0.01 ? REST_THETA : this.theta;

    let wantLift;
    if (this.dragging) {
      this.theta += (this.dragTheta - this.theta) * (1 - Math.exp(-18 * dt));
      wantLift = 0.65;
    } else {
      const dist = targetTheta - this.theta;
      const tracking = mode === 'play' && this.lift < 0.05 && Math.abs(dist) < 0.03 && this.theta > THETA_LEAD - 0.03;
      if (tracking) {
        this.theta += dist * (1 - Math.exp(-6 * dt));
        wantLift = 0;
      } else if (Math.abs(dist) > 0.004) {
        wantLift = 1;
        if (this.lift > 0.85) this.theta += Math.sign(dist) * Math.min(Math.abs(dist), dt * (0.25 + Math.abs(dist) * 2.2));
      } else {
        this.theta = targetTheta;
        wantLift = mode === 'cue' && this.theta > REST_THETA + 0.01 ? 1 : 0;
      }
    }
    // Lifting is quick; lowering is viscous-damped, like a real cue.
    const rate = wantLift > this.lift ? 4 : 1.3;
    this.lift += Math.sign(wantLift - this.lift) * Math.min(Math.abs(wantLift - this.lift), dt * rate);

    this.armYaw.rotation.y = -this.theta;
    this.armLift.rotation.z = this.lift * 0.08;
    this.cuePlatform.position.y = this.cueBaseY + this.lift * this.cueTravel;
    this.cueLever.rotation.x = this.lift > 0.5 ? -0.55 : 0;

    const onRecord = this.theta > THETA_LEAD - 0.03;
    const landed = mode === 'play' && !this.dragging && this.lift < 0.02 && onRecord;
    if (landed !== this.landed) {
      this.landed = landed;
      this.#emit(landed ? 'landed' : 'lifted');
    }
  }
}

export { TABLE_Y };
