// A cat asleep on the sideboard, curled nose-to-tail. Entirely procedural (no model to license):
// soft shapes for body, head, paws and tail, covered in shell-rendered fur. Each furry part is ONE
// instanced draw: every instance is a shell pushed a little further out along the normals, and a
// strand texture decides which pixels of that shell are hair, so the fur thins toward the tips.
//
// Units are centimetres, like the rest of the sideboard. The cat breathes, twitches an ear, flicks
// the tip of its tail now and then, and purrs if you pet it.
import * as THREE from 'three';

const SHELLS = 22;

export const COATS = {
  ginger: { label: 'Ginger tabby', base: '#c8763c', stripe: '#8b4720', light: '#ecc79c', pattern: 'tabby' },
  grey: { label: 'Grey tabby', base: '#8d8984', stripe: '#4b4845', light: '#d6d1ca', pattern: 'tabby' },
  black: { label: 'Black', base: '#1d1b1a', stripe: '#141212', light: '#2c2826', pattern: 'solid' },
  calico: { label: 'Calico', base: '#efe7dc', stripe: '#1f1c1a', light: '#d0813f', pattern: 'calico' },
  cream: { label: 'Cream', base: '#e2c9a6', stripe: '#c39d71', light: '#f4e8d6', pattern: 'tabby' },
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Cheap smooth 3D noise from layered sines: plenty for coat patches and stripe wobble.
function noise3(x, y, z) {
  return (Math.sin(x * 1.7 + Math.sin(z * 1.3)) * Math.cos(y * 1.9 + Math.sin(x * 0.7))
    + Math.sin(z * 2.3 + y * 0.9) * 0.6 + Math.sin(x * 0.9 - z * 1.1 + 2.0) * 0.5) / 2.1;
}

// Strand map: one random height per texel. A shell keeps the texel only if the strand reaches it.
let strandImage;
function strandTexture(repeatU, repeatV) {
  if (!strandImage) {
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    const rand = rng(99);
    for (let i = 0; i < N * N; i++) {
      // Hair grows in clumps: a slow wave across the map sets how long each tuft runs.
      const x = i % N, y = Math.floor(i / N);
      const clump = 0.78 + 0.22 * Math.sin(x * 0.21 + Math.sin(y * 0.17) * 2) * Math.cos(y * 0.19 + Math.sin(x * 0.13) * 2);
      const h = Math.min(1, rand() ** 0.6 * 1.08 * clump);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = h * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    strandImage = c;
  }
  const t = new THREE.CanvasTexture(strandImage);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.repeat.set(repeatU, repeatV);
  return t;
}

function furMaterial(len, droop, repeat) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, alphaMap: strandTexture(...repeat) });
  mat.defines = { SHELLS };
  const uniforms = { furLen: { value: len }, furDroop: { value: droop } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `uniform float furLen;\nuniform vec3 furDroop;\nvarying float vShell;\n${sh.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float shell = float(gl_InstanceID) / float(SHELLS - 1);
      vShell = shell;
      transformed += objectNormal * furLen * shell + furDroop * furLen * shell * shell;`,
    );
    sh.fragmentShader = `varying float vShell;\n${sh.fragmentShader}`.replace(
      '#include <alphamap_fragment>',
      `float strand = texture2D( alphaMap, vAlphaMapUv ).g;
      if ( vShell > 0.0 && strand < vShell * 0.92 + 0.06 ) discard;
      diffuseColor.rgb *= mix( 0.42, 1.06, vShell ); // shadowed roots, lit tips`,
    );
  };
  return mat;
}

// One furry part: an instanced mesh, one instance per shell.
function furry(geometry, { len, droop = new THREE.Vector3(0, -0.4, 0), repeat = [6, 4] }) {
  const mesh = new THREE.InstancedMesh(geometry, furMaterial(len, droop, repeat), SHELLS);
  const id = new THREE.Matrix4();
  for (let i = 0; i < SHELLS; i++) mesh.setMatrixAt(i, id);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += len;
  mesh.computeBoundingSphere();
  return mesh;
}

// An ellipsoid, flattened where it would sink into the table.
function ellipsoid(rx, ry, rz, { w = 64, h = 40, floor = -Infinity } = {}) {
  const g = new THREE.SphereGeometry(1, w, h);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rx, Math.max(p.getY(i) * ry, floor), p.getZ(i) * rz);
  g.computeVertexNormals();
  return g;
}

// Tube that tapers from r0 to r1; with `roundEnd` the last stretch closes into a rounded tip.
function taperedTube(curve, r0, r1, segments = 64, roundEnd = false) {
  const g = new THREE.TubeGeometry(curve, segments, 1, 20, false);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const c = curve.getPointAt(t);
    let r = r0 + (r1 - r0) * t ** 1.3;
    if (roundEnd && t > 0.86) r *= Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2));
    for (let j = 0; j <= 20; j++) {
      const k = i * 21 + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Paint the coat into vertex colours, from position (so patterns flow across UV seams).
function paint(geometry, coat, matrix, { face = false } = {}) {
  const base = new THREE.Color(coat.base), stripe = new THREE.Color(coat.stripe), light = new THREE.Color(coat.light);
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), nv = new THREE.Vector3(), c = new THREE.Color();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(matrix);
    nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    c.copy(base);
    if (coat.pattern === 'tabby') {
      // Stripes run across the back, wobbling; strongest on top, fading down the flanks.
      // Mackerel tabby: narrow, broken stripes running round the curl (radially from its centre),
      // a darker line down the spine, and ticked fur in between.
      const ang = Math.atan2(v.z - 13, v.x);
      const wob = noise3(v.x * 0.22, v.y * 0.3, v.z * 0.22) * 1.6;
      const s = face ? Math.sin(v.y * 1.9 + v.x * 0.3 + wob) : Math.sin(ang * 22 + wob + v.y * 0.25);
      const broken = THREE.MathUtils.smoothstep(noise3(v.x * 0.5 + 7, v.y * 0.5, v.z * 0.5), -0.5, 0.1);
      const top = THREE.MathUtils.smoothstep(nv.y, -0.3, 0.7);
      c.lerp(stripe, THREE.MathUtils.smoothstep(s, 0.35, 0.9) * broken * (0.25 + 0.55 * top) * (face ? 0.55 : 1));
      if (!face) c.lerp(stripe, THREE.MathUtils.smoothstep(nv.y, 0.8, 0.97) * 0.35);
    } else if (coat.pattern === 'calico') {
      const k = noise3(v.x * 0.11 + 3, v.y * 0.13, v.z * 0.11 - 1);
      const k2 = noise3(v.x * 0.09 - 5, v.y * 0.1 + 2, v.z * 0.12);
      // White underneath; orange and black patches mostly over the back and head.
      const back = THREE.MathUtils.smoothstep(nv.y, -0.4, 0.5);
      if (k > 0.12 - back * 0.15) c.lerp(light, THREE.MathUtils.smoothstep(k, 0.12 - back * 0.15, 0.24 - back * 0.15)); // orange
      if (k2 > 0.2 - back * 0.12) c.lerp(stripe, THREE.MathUtils.smoothstep(k2, 0.2 - back * 0.12, 0.3 - back * 0.12)); // black
    }
    // Paler belly and chest where the cat curls in on itself and on the underside.
    const under = THREE.MathUtils.smoothstep(-nv.y, 0.2, 0.9);
    if (coat.pattern !== 'solid' && coat.pattern !== 'calico') c.lerp(light, under * 0.45);
    // A little per-vertex variation so the coat doesn't look printed.
    const jitter = 1 + (noise3(v.x * 2.1, v.y * 2.3, v.z * 1.9) * 0.06);
    colors[i * 3] = c.r * jitter; colors[i * 3 + 1] = c.g * jitter; colors[i * 3 + 2] = c.b * jitter;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export class Cat {
  t = 0;
  #since = 1;
  #purr = 0;
  #twitch = { ear: 0, t: 0, next: 5 };
  #flick = { t: 0, next: 9 };

  constructor(scene, tableY) {
    this.group = new THREE.Group();
    this.group.position.y = tableY;
    // On the sideboard, right of the deck, in front of the right-hand speaker.
    this.group.scale.setScalar(0.8);
    this.setSpot(false);
    scene.add(this.group);
    this.rand = rng(5);
    this.parts = [];
  }

  // Right of the deck; when the video stand is out it takes that spot, so the cat sleeps further forward.
  setSpot(standOut) {
    if (this.standOut === standOut) return;
    this.standOut = standOut;
    this.group.position.set(standOut ? 46 : 41.5, this.group.position.y, standOut ? 17 : 8);
    this.group.rotation.y = standOut ? -0.5 : -0.35;
  }

  setCoat(name) {
    const coat = COATS[name] || COATS.ginger;
    if (this.coat === coat) return;
    this.coat = coat;
    for (const m of this.parts) { m.geometry.dispose(); m.material.alphaMap?.dispose(); m.material.dispose(); }
    this.group.clear();
    this.parts = [];
    this.#build(coat);
  }

  #add(mesh, parent = this.group) {
    parent.add(mesh);
    this.parts.push(mesh);
    return mesh;
  }

  #build(coat) {
    const local = (obj) => { obj.updateMatrix(); return obj.matrix; };

    // Body: an ellipsoid bent into a crescent, hips bigger than shoulders, curling toward the front.
    const R = 14.5;
    const g = ellipsoid(14.5, 7.6, 11.0, { w: 96, h: 56, floor: -6.6 });
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const hip = THREE.MathUtils.smoothstep(x, -14, 14); // 0 shoulders, 1 hips
      const s = 0.84 + hip * 0.24;
      y = (y + 6.6) * s - 6.6;
      z *= s;
      const th = x / R;
      p.setXYZ(i, Math.sin(th) * (R - z), y, R - Math.cos(th) * (R - z));
    }
    g.computeVertexNormals();
    this.body = new THREE.Group();
    this.body.position.y = 6.6;
    this.group.add(this.body);
    paint(g, coat, local(this.body));
    this.#add(furry(g, { len: 1.5, droop: new THREE.Vector3(0.35, -0.5, 0), repeat: [14, 7] }), this.body);

    // Head, tucked in at the shoulder end, resting on the paws, face turned toward the tail.
    this.head = new THREE.Group();
    this.head.position.set(-10.5, 5.0, 12.6);
    this.head.rotation.set(-0.3, 0.45, 0.3, 'YXZ');
    this.group.add(this.head);
    const skull = ellipsoid(6.3, 4.9, 5.3, { w: 64, h: 48 }); // wide cheeks, flatter brow
    const headMatrix = local(this.head);
    paint(skull, coat, headMatrix, { face: true });
    this.#add(furry(skull, { len: 0.8, droop: new THREE.Vector3(0, -0.2, -0.3), repeat: [10, 6] }), this.head);
    // Muzzle and chin.
    const muzzle = ellipsoid(2.7, 1.9, 2.1, { w: 32, h: 24 });
    muzzle.translate(0, -1.7, 4.7);
    const pale = { ...coat, base: coat.pattern === 'tabby' ? coat.light : coat.base, pattern: 'solid' }; // muzzle and paws
    paint(muzzle, pale, headMatrix, { face: true });
    this.#add(furry(muzzle, { len: 0.5, repeat: [6, 4] }), this.head);
    // Nose leather.
    const noseMat = new THREE.MeshStandardMaterial({ color: coat.pattern === 'solid' ? 0x2a2221 : 0xc98886, roughness: 0.55 });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), noseMat);
    nose.scale.set(1.2, 0.75, 0.6);
    nose.position.set(0, -0.75, 6.85);
    this.head.add(nose);
    this.parts.push(nose);
    // Closed eyes: two soft dark arcs, lying in the fur.
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x1c1513, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(side * 1.2, 0.55, 6.15), new THREE.Vector3(side * 2.1, 0.05, 6.05), new THREE.Vector3(side * 3.0, 0.5, 5.55));
      const lid = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.11, 6), lidMat);
      this.head.add(lid);
      this.parts.push(lid);
    }
    // Whiskers: fine pale strands, drooping.
    const whiskerMat = new THREE.LineBasicMaterial({ color: 0xf2ede4, transparent: true, opacity: 0.45 });
    const pts = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const o = new THREE.Vector3(side * 1.4, -1.5 - k * 0.32, 6.0);
        pts.push(o, o.clone().add(new THREE.Vector3(side * (3.6 + k * 0.25), -0.5 - k * 0.55, -1.4 + k * 0.3)));
      }
    }
    const whiskers = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), whiskerMat);
    this.head.add(whiskers);
    this.parts.push(whiskers);
    // Ears: relaxed, tipped out a little, with pink insides.
    const pink = new THREE.MeshStandardMaterial({ color: 0xd9a59c, roughness: 0.8 });
    this.ears = [];
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * 3.3, 4.0, 0.6);
      ear.rotation.set(-0.15, side * 0.25, -side * 0.42);
      this.head.add(ear);
      const outer = new THREE.ConeGeometry(2.3, 4.0, 24, 1, false);
      outer.translate(0, 2.0, 0);
      outer.scale(1, 1, 0.55);
      paint(outer, coat, new THREE.Matrix4().multiplyMatrices(headMatrix, local(ear)));
      this.#add(furry(outer, { len: 0.35, droop: new THREE.Vector3(0, 0, 0), repeat: [6, 3] }), ear);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(1.75, 3.2, 20, 1, true, -Math.PI / 2.4, Math.PI / 1.2), pink);
      inner.geometry.translate(0, 1.7, 0);
      inner.scale.set(1, 1, 0.5);
      inner.position.z = 0.32;
      inner.material.side = THREE.DoubleSide;
      ear.add(inner);
      this.parts.push(inner);
      this.ears.push(ear);
    }

    // Front paws, tucked under the chin.
    for (const [x, z, ry] of [[-6.4, 16.2, 1.1], [-3.6, 16.6, 0.8]]) {
      const paw = ellipsoid(2.0, 1.4, 3.3, { w: 32, h: 20, floor: -1.3 });
      const holder = new THREE.Group();
      holder.position.set(x, 1.35, z);
      holder.rotation.y = ry;
      this.group.add(holder);
      paint(paw, pale, local(holder));
      this.#add(furry(paw, { len: 0.7, repeat: [5, 3] }), holder);
    }

    // Tail: from the hips, wrapped around the front, the tip resting near the paws.
    const tailPts = [
      new THREE.Vector3(12.5, 3.4, 6.5), new THREE.Vector3(12.6, 2.6, 13.0), new THREE.Vector3(8.0, 2.3, 17.2),
      new THREE.Vector3(2.0, 2.1, 18.6), new THREE.Vector3(-2.6, 2.0, 18.4),
    ];
    const tail = new THREE.CatmullRomCurve3(tailPts.slice(0, 4), false, 'centripetal');
    const tailGeo = taperedTube(tail, 2.2, 1.7);
    paint(tailGeo, coat, new THREE.Matrix4());
    this.#add(furry(tailGeo, { len: 1.6, droop: new THREE.Vector3(0, -0.3, 0), repeat: [16, 5] }));
    // The tip is its own piece, so it can flick.
    this.tailTip = new THREE.Group();
    this.tailTip.position.copy(tailPts[3]);
    this.group.add(this.tailTip);
    const tipCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.5, 0.05, -0.35), new THREE.Vector3(0, 0, 0), tailPts[4].clone().sub(tailPts[3]),
      tailPts[4].clone().sub(tailPts[3]).add(new THREE.Vector3(-2.2, 0, -1.6)),
    ], false, 'centripetal');
    const tipGeo = taperedTube(tipCurve, 1.75, 1.1, 40, true);
    paint(tipGeo, coat, local(this.tailTip));
    this.#add(furry(tipGeo, { len: 1.5, droop: new THREE.Vector3(0, -0.3, 0), repeat: [8, 4] }), this.tailTip);

    // An invisible, simple shape for hovering and clicking (the furry meshes are too heavy to raycast).
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    proxy.scale.set(17, 9, 13);
    proxy.position.set(0, 6, 8);
    proxy.renderOrder = -1;
    this.group.add(proxy);
    this.parts.push(proxy);
    this.pickables = [proxy];
  }

  pet() {
    this.#purr = 4.5;
    this.#twitch.next = 0;
  }

  get purring() { return this.#purr > 0; }

  /** Animate; returns true when the pose changed enough to redraw (~15 fps, like the weather). */
  update(dt) {
    if (!this.group.visible || !this.body) return false;
    this.t += dt;
    this.#since += dt;
    if (this.#since < 1 / 15) return false;
    const step = this.#since;
    this.#since = 0;
    const t = this.t;
    this.#purr = Math.max(0, this.#purr - step);
    const purr = Math.min(1, this.#purr);

    // Breathing: slow, deep sleep; a touch quicker while purring.
    const rate = purr > 0 ? 0.42 : 0.27;
    const b = Math.sin(t * Math.PI * 2 * rate) * 0.5 + 0.5;
    this.body.scale.set(1 + b * 0.012, 1 + b * 0.035, 1 + b * 0.02);
    this.head.position.y = 5.2 + b * 0.18 + purr * 0.35;
    this.head.rotation.x = -0.3 - purr * 0.08; // nuzzles up into the hand a little

    // An ear twitches every so often (and when petted).
    const tw = this.#twitch;
    tw.next -= step;
    if (tw.next <= 0) { tw.t = 0.45; tw.ear = this.rand() > 0.5 ? 1 : 0; tw.next = 6 + this.rand() * 12; }
    tw.t = Math.max(0, tw.t - step);
    this.ears.forEach((ear, i) => {
      const k = i === tw.ear && tw.t > 0 ? Math.sin((0.45 - tw.t) * Math.PI * 4.4) * 0.3 : 0;
      ear.rotation.x = -0.15 + k;
    });

    // The tail tip lifts and settles now and then.
    const fl = this.#flick;
    fl.next -= step;
    if (fl.next <= 0) { fl.t = 1.2; fl.next = 8 + this.rand() * 16; }
    fl.t = Math.max(0, fl.t - step);
    const f = fl.t > 0 ? Math.sin((1.2 - fl.t) / 1.2 * Math.PI) : 0;
    this.tailTip.rotation.set(0, f * 0.45, f * 0.25);
    return true;
  }
}
