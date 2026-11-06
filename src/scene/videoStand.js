// A tablet leaning in a walnut stand beside the deck. The live YouTube player is a DOM iframe
// positioned exactly on the tablet's glass with CSS3DRenderer, so it moves with the camera.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { FINISHES, makeWoodTexture } from './textures.js';

const SCREEN = { w: 20.8, h: 11.7 };          // 16:9 glass
const BODY = { w: 22.2, h: 13.1, d: 0.7 };     // aluminium unibody
const PX = { w: 640, h: 360 };                 // iframe size in CSS pixels

export class VideoStand {
  constructor(scene, screenEl, tableY) {
    this.screenEl = screenEl;
    this.t = 0;
    this.baseY = tableY;

    this.group = new THREE.Group();
    this.group.position.set(33, tableY, -2);
    this.group.rotation.y = -0.7; // turned toward the listener
    this.group.visible = false;
    scene.add(this.group);

    const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    const walnut = new THREE.MeshPhysicalMaterial({ map: makeWoodTexture(FINISHES.walnut), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xbdbab4, metalness: 1, roughness: 0.35 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
    const felt = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });

    // Walnut block with a slot; felt pad underneath.
    const base = shadowy(new THREE.Mesh(new RoundedBoxGeometry(13, 1.6, 7.5, 3, 0.45), walnut));
    base.position.y = 0.8 + 0.15;
    this.group.add(base);
    const pad = shadowy(new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.15, 6.9), felt));
    pad.position.y = 0.075;
    this.group.add(pad);

    // Tablet, leaning back ~15° in the slot.
    this.tilt = new THREE.Group();
    this.tilt.position.set(0, 1.35, -0.4);
    this.tilt.rotation.x = -0.26;
    this.group.add(this.tilt);
    const body = shadowy(new THREE.Mesh(new RoundedBoxGeometry(BODY.w, BODY.h, BODY.d, 4, 0.55), alu));
    body.position.y = BODY.h / 2;
    this.tilt.add(body);
    const front = new THREE.Mesh(new RoundedBoxGeometry(BODY.w - 0.25, BODY.h - 0.25, 0.05, 4, 0.5), glass);
    front.position.set(0, BODY.h / 2, BODY.d / 2 + 0.01);
    this.tilt.add(front);

    // Front lip of the slot, in front of the tablet's bottom edge.
    const lip = shadowy(new THREE.Mesh(new RoundedBoxGeometry(13, 1.1, 0.6, 2, 0.2), walnut));
    lip.position.set(0, 1.6 + 0.5, 0.55);
    this.group.add(lip);

    // Where the canvas is cut away to reveal the player behind it. Writes (0,0,0,0) straight into
    // the framebuffer; only drawn in the hole pass, never in the normal render.
    this.hole = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN.w, SCREEN.h),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending }),
    );
    this.hole.position.set(0, BODY.h / 2, BODY.d / 2 + 0.06);
    this.hole.visible = false;
    this.tilt.add(this.hole);

    // The live player.
    this.css = new CSS3DObject(screenEl);
    this.css.scale.setScalar(SCREEN.w / PX.w);
    this.css.position.set(0, BODY.h / 2, BODY.d / 2 + 0.05);
    this.tilt.add(this.css);
  }

  // Rises a touch and fades the picture in when shown; drops away when hidden.
  update(dt, show) {
    const goal = show ? 1 : 0;
    this.t += Math.sign(goal - this.t) * Math.min(Math.abs(goal - this.t), dt * 2.5);
    this.group.visible = this.t > 0.001;
    const e = 1 - (1 - this.t) ** 3;
    this.group.position.y = this.baseY - (1 - e) * 3;
    this.group.scale.setScalar(0.92 + e * 0.08);
    this.screenEl.classList.toggle('on', show && this.t > 0.6);
  }
}
