// A pair of bookshelf speakers on the sideboard, toed in toward the listener. Cabinets share the
// deck's finish. The woofer cones and tweeter domes move with what's actually playing (see Levels).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const CAB = { w: 17, h: 28, d: 20 };

export class Speakers {
  constructor(scene, tableY, woodMaterial) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    const baffleMat = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.7 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.3 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.85 });
    const coneMat = new THREE.MeshPhysicalMaterial({ color: 0x2b2a28, roughness: 0.55, sheen: 0.4, sheenColor: 0x555555, side: THREE.DoubleSide });
    const satin = new THREE.MeshStandardMaterial({ color: 0xa9a59e, metalness: 1, roughness: 0.35 });
    const dome = new THREE.MeshPhysicalMaterial({ color: 0x1a1a1a, roughness: 0.9, sheen: 1, sheenColor: 0x444444 });

    this.drivers = [];
    for (const side of [-1, 1]) {
      const spk = new THREE.Group();
      spk.position.set(side * 42, tableY, -23.6);
      spk.rotation.y = -side * 0.22; // toed in
      this.group.add(spk);

      const cab = shadowy(new THREE.Mesh(new RoundedBoxGeometry(CAB.w, CAB.h, CAB.d, 4, 0.7), woodMaterial));
      cab.position.y = CAB.h / 2 + 0.4;
      spk.add(cab);
      for (const [x, z] of [[-6.5, -7.5], [6.5, -7.5], [-6.5, 7.5], [6.5, 7.5]]) {
        const foot = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.4, 16), rubber));
        foot.position.set(x, 0.2, z);
        spk.add(foot);
      }

      // Front baffle, slightly proud of the veneer.
      const front = new THREE.Group();
      front.position.set(0, CAB.h / 2 + 0.4, CAB.d / 2 + 0.02);
      spk.add(front);
      const baffle = shadowy(new THREE.Mesh(new RoundedBoxGeometry(CAB.w - 1.4, CAB.h - 1.4, 0.3, 3, 0.5), baffleMat));
      front.add(baffle);

      // Woofer: frame ring, rubber surround, cone and dust cap. The cone assembly is what moves.
      const woofer = new THREE.Group();
      woofer.position.set(0, -3.6, 0.15);
      front.add(woofer);
      const ring = shadowy(new THREE.Mesh(new THREE.TorusGeometry(6.1, 0.38, 12, 64), frameMat));
      woofer.add(ring);
      const surround = shadowy(new THREE.Mesh(new THREE.TorusGeometry(5.35, 0.5, 12, 64), rubber));
      surround.scale.z = 0.7;
      woofer.add(surround);
      const moving = new THREE.Group();
      woofer.add(moving);
      const coneProfile = [[4.9, 0], [4.2, -0.35], [3.0, -0.95], [1.9, -1.35], [1.75, -1.4]].map(([r, z]) => new THREE.Vector2(r, z));
      const cone = shadowy(new THREE.Mesh(new THREE.LatheGeometry(coneProfile, 64), coneMat));
      cone.rotation.x = Math.PI / 2; // lathe axis (y) → speaker axis (z); profile z ≤ 0 recesses it
      moving.add(cone);
      const cap = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1.9, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), coneMat));
      cap.rotation.x = Math.PI / 2;
      cap.scale.y = 0.45;
      cap.position.z = -1.3;
      moving.add(cap);

      // Soft-dome tweeter on a machined faceplate.
      const tweeter = new THREE.Group();
      tweeter.position.set(0, 8.4, 0.15);
      front.add(tweeter);
      const plate = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 48), satin));
      plate.rotation.x = Math.PI / 2;
      tweeter.add(plate);
      const domeMesh = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), dome));
      domeMesh.rotation.x = Math.PI / 2;
      domeMesh.position.z = 0.15;
      tweeter.add(domeMesh);

      // Bass reflex port.
      const port = shadowy(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.22, 10, 32), frameMat));
      port.position.set(0, -11.4, 0.18);
      front.add(port);
      const throat = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: 0x030303 }));
      throat.position.set(0, -11.4, 0.16);
      front.add(throat);

      this.drivers.push({ moving, dome: domeMesh });
    }
  }

  set visible(v) { this.group.visible = v; }

  // bass/mid in 0..1. A woofer's excursion is a few millimetres; exaggerated just enough to see.
  update(bass, mid) {
    for (const d of this.drivers) {
      d.moving.position.z = bass * 0.5;
      d.dome.scale.y = 0.45 * (1 + mid * 0.25);
    }
  }
}
