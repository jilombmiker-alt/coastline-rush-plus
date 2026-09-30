import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { activeTrack, TRACK_LENGTH, TRACK_WIDTH, distanceToTrack, sampleTrack, trackPosition } from './track';
import { createBoxVolume, type CollisionVolume, type StaticCollider } from './collision';
import { VEHICLES } from './vehicles';
import type { VehicleId } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

function randomSource(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function material(color: number, roughness = 0.85, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  if (typeof document === 'undefined') {
    // Dedicated LAN race servers need the same world colliders, but never render textures.
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) paint(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A strip follows the same arc-length samples as the driving simulation. */
function roadBand(left: number, right: number, lift: number, start = 0, end = TRACK_LENGTH, step = 2.4) {
  const count = Math.max(1, Math.ceil((end - start) / step));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= count; i++) {
    const distance = start + (end - start) * i / count;
    const p = sampleTrack(distance);
    for (const offset of [left, right]) {
      positions.push(p.x + p.nx * offset, p.y + lift, p.z + p.nz * offset);
      uvs.push(offset / TRACK_WIDTH * 3, distance / 24);
    }
    if (i < count) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Layered limestone island outcrops, with a pale sunlit cap. */
function mesaGeometry(radius: number, height: number, seed: number, stretch = 1) {
  const rng = randomSource(seed);
  const corners = 11;
  const outline = Array.from({ length: corners }, () => 0.86 + rng() * 0.25);
  const ys = [0, 0.1, 0.15, 0.32, 0.36, 0.57, 0.61, 0.8, 0.84, 1];
  const radii = [1.12, 1.03, 0.97, 0.91, 0.96, 0.78, 0.82, 0.67, 0.71, 0.64];
  const palette = [0x789391, 0x90a49a, 0xa6b4a2, 0xbac8b0, 0x9aa98f, 0xb7c5a5, 0xd2d7b8, 0xbacba5, 0x87ad82];
  const positions: number[] = [];
  const colors: number[] = [];
  const ring = (layer: number, corner: number) => {
    const angle = corner % corners / corners * TAU;
    const radial = outline[corner % corners] * radii[layer] * radius;
    return new THREE.Vector3(
      Math.cos(angle) * radial + Math.sin(layer * 1.8) * radius * 0.045,
      ys[layer] * height,
      Math.sin(angle) * radial * stretch + Math.cos(layer) * radius * 0.035,
    );
  };
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: THREE.Color) => {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    for (let k = 0; k < 3; k++) colors.push(tint.r, tint.g, tint.b);
  };
  for (let layer = 0; layer < ys.length - 1; layer++) {
    for (let j = 0; j < corners; j++) {
      const tint = new THREE.Color(palette[layer]).multiplyScalar(0.94 + rng() * 0.11);
      const a = ring(layer, j), b = ring(layer, j + 1);
      const c = ring(layer + 1, j), d = ring(layer + 1, j + 1);
      triangle(a, c, b, tint);
      triangle(b, c, d, tint);
    }
  }
  const cap = new THREE.Color(0x91b977);
  for (let j = 0; j < corners; j++) {
    triangle(new THREE.Vector3(0, height, 0), ring(ys.length - 1, j + 1), ring(ys.length - 1, j), cap);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Project each individual solid, never an entire scenery batch or its empty AABB. */
function extractCollisionVolume(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): CollisionVolume {
  const positions = geometry.getAttribute('position');
  const vertex = new THREE.Vector3();
  const points: { x: number; z: number }[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    if (matrix) vertex.applyMatrix4(matrix);
    points.push({ x: vertex.x, z: vertex.z });
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
  }
  points.sort((a, b) => a.x - b.x || a.z - b.z);
  const unique = points.filter((p, i) => i === 0
    || Math.abs(p.x - points[i - 1].x) > 1e-7 || Math.abs(p.z - points[i - 1].z) > 1e-7);
  const cross = (a: typeof points[number], b: typeof points[number], c: typeof points[number]) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const halfHull = (vertices: typeof points) => {
    const result: typeof points = [];
    for (const p of vertices) {
      while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], p) <= 1e-8) result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  return { points: [...halfHull(unique), ...halfHull([...unique].reverse())], minY, maxY };
}

export function createWorld(scene: THREE.Scene): { colliders: StaticCollider[]; update(time: number): void; dispose(): void } {
  const root = new THREE.Group();
  root.name = 'Coastline Rush / turquoise island circuit';
  scene.add(root);
  const rng = randomSource(7107);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const colliders: StaticCollider[] = [];
  const recordSolid = (kind: StaticCollider['kind'], id: string, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) => {
    colliders.push({ id, kind, ...extractCollisionVolume(geometry, matrix) });
  };
  const boats: THREE.Group[] = [];
  const flags: THREE.Mesh[] = [];
  const temporaryGeometries = new Set<THREE.BufferGeometry>();
  const dummy = new THREE.Object3D();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  temporaryGeometries.add(box);
  temporaryGeometries.add(cylinder);
  const add = (geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number,
    sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    const transformed = geometry.clone().applyMatrix4(dummy.matrix);
    const pieces = batches.get(mat) ?? [];
    pieces.push(transformed);
    batches.set(mat, pieces);
    return transformed;
  };
  const solid = (geometry: THREE.BufferGeometry, mat: THREE.Material, castShadow = false) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = castShadow;
    root.add(mesh);
    return mesh;
  };
  const beam = (a: THREE.Vector3, b: THREE.Vector3, thickness: number, mat: THREE.Material) => {
    const direction = b.clone().sub(a);
    dummy.position.copy(a).add(b).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
    dummy.scale.set(thickness, direction.length(), thickness);
    dummy.updateMatrix();
    const geometry = box.clone().applyMatrix4(dummy.matrix);
    const pieces = batches.get(mat) ?? [];
    pieces.push(geometry);
    batches.set(mat, pieces);
  };

  const theme = activeTrack === 'ridge' ? {
    sandA: 0xc9cbb6, sandB: 0xa6b99d, dune: 0x789d87,
    coral: 0x4a917a, edge: 0xb4c9b2, asphalt: 0x8eaaa7,
    lagoon: 0x6c9ba1, deep: 0x426f83, fog: 0xc8dbd4,
  } : activeTrack === 'coral' ? {
    sandA: 0xf7d8b0, sandB: 0xebc39e, dune: 0xa6c7a0,
    coral: 0xf57f87, edge: 0xf2d4bb, asphalt: 0xb4cfcb,
    lagoon: 0x37adc0, deep: 0x157798, fog: 0xc7ecea,
  } : activeTrack === 'aurora' ? {
    sandA: 0xa2a3bd, sandB: 0x858dae, dune: 0x6b7a99,
    coral: 0x79e2c5, edge: 0x9ba9c5, asphalt: 0x818da5,
    lagoon: 0x365e88, deep: 0x1b3265, fog: 0x6a83ad,
  } : activeTrack === 'neon' ? {
    sandA: 0x4d496c, sandB: 0x374866, dune: 0x53627d,
    coral: 0xe466d0, edge: 0x68577f, asphalt: 0x707b9c,
    lagoon: 0x224b79, deep: 0x161f52, fog: 0x2d315f,
  } : activeTrack === 'storm' ? {
    sandA: 0xf0bb96, sandB: 0xcc998e, dune: 0xb99c87,
    coral: 0xdf6e72, edge: 0xb98187, asphalt: 0xa19ca7,
    lagoon: 0x9b5c77, deep: 0x5c3f70, fog: 0xf1b397,
  } : {
    sandA: 0xf6e8bb, sandB: 0xe1d7ad, dune: 0xafc594,
    coral: 0x16a596, edge: 0xe1dcc0, asphalt: 0xc1d1cf,
    lagoon: 0x1399ab, deep: 0x0b6191, fog: 0xbbe3e2,
  };
  const cream = material(0xfaffed);
  const coral = material(theme.coral);
  const edgeMat = material(theme.edge);
  const steel = material(0x8daeb2, 0.58, 0.38);
  const darkSteel = material(0x21434b, 0.62, 0.5);
  const lightSteel = material(0xf3f8ec, 0.7, 0.23);
  const teal = material(0x53bec1, 0.68, 0.18);
  const green = material(0x399578);
  const trunkMat = material(0xac9875);
  const leafLight = material(0x7fbc75);
  const grass = material(0x94b681);
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });

  // Tiny procedural aggregate gives the road a little texture without external assets.
  const asphaltTexture = canvasTexture(256, 256, ctx => {
    ctx.fillStyle = '#667d80';
    ctx.fillRect(0, 0, 256, 256);
    const noise = randomSource(106);
    for (let i = 0; i < 10500; i++) {
      const value = 64 + Math.floor(noise() * 66);
      ctx.fillStyle = `rgba(${value},${value + 3},${value + 4},0.2)`;
      ctx.fillRect(noise() * 256, noise() * 256, noise() * 2 + 0.5, 1);
    }
  });
  asphaltTexture.wrapS = asphaltTexture.wrapT = THREE.RepeatWrapping;
  const asphalt = new THREE.MeshStandardMaterial({ color: theme.asphalt, map: asphaltTexture, roughness: 0.96 });

  // The circuit sits on a narrow sandy island around a shallow inner lagoon.
  // Lowering the distant ground lets the sea remain a continuous, inexpensive surface.
  const islandHeight = (x: number, z: number, distance = distanceToTrack(x, z)) => {
    const noise = Math.sin(x * 0.043) * Math.cos(z * 0.035) * 4 + Math.sin(z * 0.08) * 2;
    const shore = 33 + noise;
    const shoreHeight = 0.13 - THREE.MathUtils.smoothstep(distance, shore - 9, shore + 13) * 5;
    const lighthouseIsland = 1 - Math.hypot((x - 78) / 31, (z - 218) / 27);
    return Math.max(shoreHeight, THREE.MathUtils.smoothstep(lighthouseIsland, -0.25, 0.5) * 6 - 4.5);
  };
  const terrain = new THREE.PlaneGeometry(1650, 1650, 180, 180);
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(100, 0, 10);
  const position = terrain.getAttribute('position');
  const groundColors: number[] = [];
  const sandA = new THREE.Color(theme.sandA);
  const sandB = new THREE.Color(theme.sandB);
  const duneGreen = new THREE.Color(theme.dune);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const distance = distanceToTrack(x, z);
    const wave = Math.sin(x * 0.027 + Math.sin(z * 0.035)) * Math.cos(z * 0.021) * 0.5 + 0.5;
    position.setY(i, islandHeight(x, z, distance));
    const tint = sandA.clone().lerp(sandB, wave * 0.58);
    if (distance < 24 && distance > 16) tint.lerp(duneGreen, wave * 0.48);
    groundColors.push(tint.r, tint.g, tint.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3));
  terrain.computeVertexNormals();
  solid(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));

  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, fogColor: { value: new THREE.Color(theme.fog) },
      lagoon: { value: new THREE.Color(theme.lagoon) }, deep: { value: new THREE.Color(theme.deep) } },
    vertexShader: `varying vec3 vWorld;
      void main() { vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; uniform vec3 fogColor; uniform vec3 lagoon; uniform vec3 deep; varying vec3 vWorld;
      void main() {
        float wave = sin(vWorld.x * .075 + time * .48 + sin(vWorld.z * .06))
          * sin(vWorld.z * .115 - time * .35 + sin(vWorld.x * .037));
        float distanceFromIsland = smoothstep(180., 800., length(vWorld.xz - vec2(100., 20.)));
        vec3 color = mix(lagoon, deep, distanceFromIsland);
        color += wave * vec3(.018, .036, .037);
        float sparkle = pow(max(0., sin(vWorld.x * .48 + time) * sin(vWorld.z * .72 - time * .8)), 28.);
        color += sparkle * vec3(.08, .11, .1);
        float fog = smoothstep(250., 1180., distance(vWorld, cameraPosition));
        gl_FragColor = vec4(mix(color, fogColor, fog * .75), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2900, 2900), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(100, -1.15, 10);
  root.add(ocean);

  solid(roadBand(-TRACK_WIDTH / 2, TRACK_WIDTH / 2, 0), asphalt);
  solid(roadBand(-TRACK_WIDTH / 2 - 1.1, TRACK_WIDTH / 2 + 1.1, -0.11), edgeMat);

  // Pale limestone embankments support the elevated coastal bends.
  const bankPositions: number[] = [];
  const bankIndices: number[] = [];
  const bankSegments = 640;
  for (const side of [-1, 1]) {
    const initial = bankPositions.length / 3;
    for (let i = 0; i <= bankSegments; i++) {
      const p = sampleTrack(i / bankSegments * TRACK_LENGTH);
      const top = side * (TRACK_WIDTH / 2 + 1.06);
      const bottom = side * (TRACK_WIDTH / 2 + 2.5 + p.y * 0.28);
      bankPositions.push(p.x + p.nx * top, p.y - 0.12, p.z + p.nz * top);
      bankPositions.push(p.x + p.nx * bottom, -0.55, p.z + p.nz * bottom);
      if (i < bankSegments) {
        const a = initial + i * 2;
        if (side === -1) bankIndices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
        else bankIndices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  }
  const embankment = new THREE.BufferGeometry();
  embankment.setAttribute('position', new THREE.Float32BufferAttribute(bankPositions, 3));
  embankment.setIndex(bankIndices);
  embankment.computeVertexNormals();
  solid(embankment, material(0xc3c7ac));

  for (let d = 0; d < TRACK_LENGTH; d += 4.4) {
    const curbMat = Math.floor(d / 4.4) % 2 ? cream : coral;
    for (const side of [-1, 1]) {
      const left = side === 1 ? TRACK_WIDTH / 2 - 0.15 : -TRACK_WIDTH / 2 - 0.75;
      const band = roadBand(left, left + 0.9, 0.036, d, Math.min(d + 4.4, TRACK_LENGTH));
      const pieces = batches.get(curbMat) ?? [];
      pieces.push(band);
      batches.set(curbMat, pieces);
    }
  }
  // Narrow continuous boundary lines are readable at speed; the middle line is dashed.
  for (const side of [-1, 1]) solid(roadBand(side * 8.65 - 0.06, side * 8.65 + 0.06, 0.025), cream);
  for (let d = 10; d < TRACK_LENGTH; d += 17) {
    const band = roadBand(-0.085, 0.085, 0.028, d, Math.min(d + 6, TRACK_LENGTH));
    const pieces = batches.get(cream) ?? [];
    pieces.push(band);
    batches.set(cream, pieces);
  }

  // Safety rails are placed around the elevated outer turns, leaving open sea views.
  for (let d = 0; d < TRACK_LENGTH; d += 7) {
    const p = sampleTrack(d);
    const railSection = p.y > 3.7 || Math.abs(p.curvature) > 0.012;
    if (!railSection) continue;
    for (const side of [-1, 1]) {
      const lateral = side * (TRACK_WIDTH / 2 + 1.25);
      const here = trackPosition(d, lateral, 0.74);
      const next = trackPosition(d + 7.1, lateral, 0.74);
      beam(here, next, 0.2, lightSteel);
      const railLength = Math.hypot(next.x - here.x, next.z - here.z);
      const rail = createBoxVolume((here.x + next.x) / 2, (here.y + next.y) / 2 + 0.06,
        (here.z + next.z) / 2, 0.1, 0.5, railLength / 2, Math.atan2(next.x - here.x, next.z - here.z));
      // Cover both visible rail bars, following only the rendered segments.
      rail.minY = Math.min(here.y, next.y) - 0.44;
      rail.maxY = Math.max(here.y, next.y) + 0.56;
      colliders.push({ id: `rail-${d}-${side}`, kind: 'barrier', ...rail });
      const upperA = here.clone(); upperA.y += 0.39;
      const upperB = next.clone(); upperB.y += 0.39;
      beam(upperA, upperB, 0.12, steel);
      const foot = trackPosition(d, lateral, 0.53);
      recordSolid('barrier', `rail-post-${d}-${side}`,
        add(box, steel, foot.x, foot.y, foot.z, 0.15, 1.12, 0.17, 0, p.heading));
      if (Math.floor(d / 7) % 3 === 0) {
        const reflector = trackPosition(d, lateral, 1.15);
        add(box, coral, reflector.x, reflector.y, reflector.z, 0.27, 0.2, 0.14, 0, p.heading);
      }
    }
  }

  // Finishing stripe follows the exact road height, so it never flickers or floats.
  const startP = sampleTrack(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 18; col++) {
      const lateral = -9 + (col + 0.5);
      const p = trackPosition(row * 0.85 + 0.3, lateral, 0.032);
      add(box, (row + col) % 2 === 0 ? cream : darkSteel, p.x, p.y, p.z,
        0.99, 0.016, 0.84, 0, startP.heading);
    }
  }

  const gate = new THREE.Group();
  gate.position.copy(trackPosition(1.2));
  gate.rotation.y = sampleTrack(1.2).heading;
  root.add(gate);
  const gatePart = (w: number, h: number, depth: number, mat: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    gate.add(mesh);
    return mesh;
  };
  for (const x of [-11.7, 11.7]) {
    const pillar = gatePart(1.5, 10.8, 1.7, coral, x, 5.4);
    const base = gatePart(2.35, 1.3, 2.6, darkSteel, x, 0.65);
    for (const [name, mesh] of [['pillar', pillar], ['base', base]] as const) {
      mesh.updateWorldMatrix(true, false);
      recordSolid('structure', `start-gate-${name}-${x}`, mesh.geometry, mesh.matrixWorld);
    }
    gatePart(0.15, 8.8, 0.18, cream, x + Math.sign(x) * 0.63, 5.3, -0.88);
    gatePart(1.7, 0.6, 1.9, cream, x, 8.3);
  }
  gatePart(25, 3, 1.65, coral, 0, 10.65);
  gatePart(25.6, 0.22, 1.9, cream, 0, 12.2);
  gatePart(21.4, 0.23, 0.15, darkSteel, 0, 8.72, -0.96);
  const gateTexture = canvasTexture(2048, 256, ctx => {
    ctx.fillStyle = '#149a8e'; ctx.fillRect(0, 0, 2048, 256);
    ctx.strokeStyle = '#d5f9e8'; ctx.lineWidth = 3; ctx.strokeRect(22, 19, 2004, 218);
    ctx.fillStyle = '#f7fff3';
    ctx.font = '900 118px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('COASTLINE RUSH', 1024, 115);
    ctx.font = '700 26px Arial, sans-serif';
    ctx.fillText('I S L A N D  C I R C U I T  /  S T A R T', 1024, 210);
    ctx.font = '900 92px Arial, sans-serif';
    ctx.fillText('≈', 130, 127); ctx.fillText('≈', 1918, 127);
    for (const side of [68, 1830]) for (let j = 0; j < 3; j++) {
      ctx.fillRect(side + j * 18, 202, 10, 9);
    }
  });
  const gateSignMat = new THREE.MeshStandardMaterial({ map: gateTexture, roughness: 0.85 });
  for (const side of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(24.6, 2.76), gateSignMat);
    plane.position.set(0, 10.67, side * 0.84);
    if (side === -1) plane.rotation.y = Math.PI;
    gate.add(plane);
  }
  const signalMat = new THREE.MeshStandardMaterial({ color: 0xa7ecba, emissive: 0x62b17a, emissiveIntensity: 0.8 });
  for (let i = 0; i < 5; i++) gatePart(0.42, 0.36, 0.22, signalMat, (i - 2) * 0.95, 8.58, -1.04);

  const flagTexture = canvasTexture(128, 512, ctx => {
    ctx.fillStyle = '#21ad9a'; ctx.fillRect(0, 0, 128, 512);
    ctx.fillStyle = '#eefff3'; ctx.fillRect(0, 0, 128, 11); ctx.fillRect(0, 500, 128, 12);
    ctx.save(); ctx.translate(63, 249); ctx.rotate(-Math.PI / 2);
    ctx.font = '900 41px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('COASTLINE', 0, 17); ctx.restore();
    ctx.font = '700 24px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('C / R', 64, 462);
  });
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture, side: THREE.DoubleSide, roughness: 0.9 });
  for (let d = 35; d < TRACK_LENGTH; d += 108) {
    for (const side of [-1, 1]) {
      const p = sampleTrack(d);
      const loc = trackPosition(d, side * 13, 0);
      recordSolid('structure', `flag-post-${d}-${side}`,
        add(cylinder, lightSteel, loc.x, loc.y + 3.7, loc.z, 0.075, 7.4, 0.075));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 5.2, 4, 12), flagMat);
      flag.position.set(loc.x, loc.y + 4.45, loc.z);
      flag.rotation.y = p.heading + 0.13;
      flag.userData.baseRotation = flag.rotation.y;
      flag.userData.phase = rng() * TAU;
      root.add(flag);
      flags.push(flag);
    }
  }

  // Small directional chevrons mark corner entries.
  const chevronTexture = canvasTexture(512, 128, ctx => {
    ctx.fillStyle = '#19656a'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#def9ed'; ctx.lineWidth = 4; ctx.strokeRect(3, 3, 506, 122);
    ctx.fillStyle = '#f4fff5';
    for (let i = 0; i < 4; i++) {
      const x = 28 + i * 124;
      ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x + 40, 20); ctx.lineTo(x + 79, 64);
      ctx.lineTo(x + 40, 108); ctx.lineTo(x, 108); ctx.lineTo(x + 39, 64); ctx.closePath(); ctx.fill();
    }
  });
  const chevronMat = new THREE.MeshStandardMaterial({ map: chevronTexture, side: THREE.DoubleSide, roughness: 0.85 });
  for (const frac of [0.19, 0.3, 0.48, 0.65, 0.79, 0.9]) {
    const d = frac * TRACK_LENGTH, p = sampleTrack(d);
    const side = p.curvature > 0 ? -1 : 1;
    const location = trackPosition(d, side * 13, 1.8);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), chevronMat);
    sign.position.copy(location);
    sign.rotation.y = p.heading + Math.PI;
    root.add(sign);
    for (const dx of [-2.4, 2.4]) {
      recordSolid('structure', `chevron-post-${frac}-${dx}`,
        add(box, steel, location.x + Math.cos(p.heading) * dx, location.y - 0.95,
          location.z - Math.sin(p.heading) * dx, 0.11, 2.2, 0.11));
    }
  }

  const addMesa = (x: number, z: number, radius: number, height: number, seed: number, stretch = 1) => {
    if (distanceToTrack(x, z) < radius * 1.25 * Math.max(1, stretch) + 18) return;
    const rock = mesaGeometry(radius, height * 0.37, seed, stretch);
    recordSolid('rock', `mesa-${seed}`, add(rock, rockMat, x, -0.5, z, 1, 1, 1, 0, seed * 0.53));
    rock.dispose();
  };
  // Low limestone headlands keep the horizon open above the lagoon.
  addMesa(82, -97, 40, 72, 91, 1.04);
  addMesa(74, 90, 24, 28, 10, 1.2);
  addMesa(103, 192, 14, 19, 122, 1.1);
  addMesa(-102, 53, 34, 60, 11, 1.08);
  addMesa(-121, -133, 42, 93, 31, 1.0);
  addMesa(294, -125, 27, 67, 93, 1.0);
  addMesa(267, -293, 49, 95, 28, 1.2);
  addMesa(368, 82, 52, 109, 80, 1.15);
  addMesa(-113, 269, 48, 81, 52, 1.1);
  addMesa(161, 399, 52, 68, 200, 1.2);
  // Small sea stacks frame the more distant sections of the circuit.
  addMesa(-91, -57, 11, 45, 8);
  addMesa(283, 91, 12, 41, 29);
  addMesa(45, -302, 16, 78, 164);
  addMesa(315, 267, 17, 62, 108);
  for (let i = 0; i < 11; i++) {
    const angle = i / 11 * TAU;
    const radius = 590 + rng() * 130;
    addMesa(80 + Math.cos(angle) * radius, 30 + Math.sin(angle) * radius,
      63 + rng() * 53, 90 + rng() * 96, 230 + i, 0.9 + rng() * 0.5);
  }

  // Rounded beach rocks, batched into a single mesh.
  const boulder = new THREE.DodecahedronGeometry(1, 0);
  const boulderMat = material(0xb5c5b6);
  temporaryGeometries.add(boulder);
  for (let i = 0; i < 400; i++) {
    const x = -195 + rng() * 650, z = -365 + rng() * 815;
    const size = 0.4 + rng() * 2.2;
    if (distanceToTrack(x, z) < 18 + size) continue;
    const rock = add(boulder, boulderMat, x, size * 0.34 - 0.2, z, size, size * 0.7, size * 0.8,
      rng(), rng() * TAU, rng() * 0.5);
    const volume = extractCollisionVolume(rock);
    // Pebbles remain traversable; visibly substantial fragments are solid.
    if (volume.maxY >= 0.65) colliders.push({ id: `boulder-${i}`, kind: 'rock', ...volume });
  }

  // Low polygon palm fronds use a curved ribbon, so every crown has a clear silhouette.
  const palmLeaf = new THREE.BufferGeometry();
  const leafPositions: number[] = [], leafIndices: number[] = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const width = Math.sin(t * Math.PI) * 0.43 + 0.016;
    const y = Math.sin(t * Math.PI) * 0.65 - t * t * 0.64;
    leafPositions.push(-width, y, t * 3.7, width, y + 0.06, t * 3.7);
    if (i < 7) { const a = i * 2; leafIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  palmLeaf.setAttribute('position', new THREE.Float32BufferAttribute(leafPositions, 3));
  palmLeaf.setIndex(leafIndices); palmLeaf.computeVertexNormals();
  temporaryGeometries.add(palmLeaf);
  green.side = leafLight.side = THREE.DoubleSide;
  const palm = (x: number, z: number, height: number, id: string) => {
    const base = Math.max(-0.1, islandHeight(x, z));
    const trunk = 0.20 + height * 0.018;
    recordSolid('structure', id,
      add(cylinder, trunkMat, x, base + height * 0.5, z, trunk, height, trunk));
    const turn = rng() * TAU;
    for (let j = 0; j < 9; j++) {
      const scale = 0.85 + rng() * 0.32;
      add(palmLeaf, j % 3 ? green : leafLight, x, base + height, z,
        scale, scale, scale, -0.10 + rng() * 0.16, turn + j * TAU / 9);
    }
    for (let j = 0; j < 3; j++) {
      const angle = j * TAU / 3;
      add(boulder, trunkMat, x + Math.cos(angle) * 0.25, base + height - 0.25,
        z + Math.sin(angle) * 0.25, 0.24, 0.31, 0.24);
    }
  };
  for (let i = 0; i < 245; i++) {
    const x = -120 + rng() * 485, z = -320 + rng() * 715;
    const distance = distanceToTrack(x, z);
    if (distance < 20 || distance > 32 || islandHeight(x, z, distance) < -0.5) continue;
    palm(x, z, 5.7 + rng() * 3.8, `palm-${i}`);
  }
  // The start straight has a recognisable avenue of palms on its beach side.
  for (const d of [3, 24, 50, 74, 105]) {
    const location = trackPosition(d, -23);
    palm(location.x, location.z, 7.3 + rng() * 1.6, `promenade-palm-${d}`);
  }
  const grassBlade = new THREE.PlaneGeometry(0.15, 1);
  temporaryGeometries.add(grassBlade);
  grass.side = THREE.DoubleSide;
  for (let i = 0; i < 520; i++) {
    const x = -110 + rng() * 470, z = -320 + rng() * 680;
    const distance = distanceToTrack(x, z);
    if (distance < 15 || distance > 28 || islandHeight(x, z, distance) < -0.35) continue;
    const height = 0.35 + rng() * 0.8;
    for (let j = 0; j < 4; j++) {
      add(grassBlade, grass, x, height * 0.4, z, 1, height, 1,
        (rng() - 0.5) * 0.9, j * 1.27, (rng() - 0.5) * 0.65);
    }
  }

  // A striped lighthouse anchors the bay. Its island is part of the terrain above.
  const towerX = 78, towerZ = 218;
  const lighthouseBase = Math.max(0, islandHeight(towerX, towerZ));
  const lighthouseRed = material(0xf48a69);
  add(cylinder, cream, towerX, lighthouseBase + 1, towerZ, 6.2, 2, 6.2);
  for (let tier = 0; tier < 5; tier++) {
    const radius = 3.0 - tier * 0.17;
    const part = add(cylinder, tier % 2 ? lighthouseRed : cream, towerX,
      lighthouseBase + 3.2 + tier * 3.6, towerZ, radius, 3.6, radius);
    recordSolid('structure', `lighthouse-${tier}`, part);
  }
  add(cylinder, darkSteel, towerX, lighthouseBase + 20.1, towerZ, 3.8, 0.5, 3.8);
  add(cylinder, teal, towerX, lighthouseBase + 21.5, towerZ, 2.25, 2.6, 2.25);
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffedb0, emissive: 0xffd583, emissiveIntensity: 1.2 });
  add(cylinder, beaconMat, towerX, lighthouseBase + 21.5, towerZ, 1.25, 1.75, 1.25);
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    add(cylinder, cream, towerX + Math.cos(a) * 2.28, lighthouseBase + 21.5,
      towerZ + Math.sin(a) * 2.28, 0.09, 2.7, 0.09);
  }
  const roof = new THREE.ConeGeometry(3.7, 2.5, 12);
  add(roof, lighthouseRed, towerX, lighthouseBase + 24, towerZ);
  roof.dispose();
  for (const [x, z] of [[62, 216], [87, 232], [91, 207]]) palm(x, z, 6.5 + rng() * 2, `lighthouse-palm-${x}`);

  const sailGeometry = new THREE.BufferGeometry();
  sailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 12, 0, 0, 0, 6.8], 3));
  sailGeometry.computeVertexNormals();
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xfaffef, roughness: 0.8, side: THREE.DoubleSide });
  const sailAccent = new THREE.MeshStandardMaterial({ color: 0xffaf7e, roughness: 0.8, side: THREE.DoubleSide });
  for (const [x, z, size, heading] of [[48, 212, 0.72, 0.5], [112, 129, 1.15, -0.7], [-111, 94, 1.4, 0.4], [307, 332, 1.8, -0.4]]) {
    const boat = new THREE.Group();
    boat.position.set(x, -0.85, z); boat.rotation.y = heading; boat.scale.setScalar(size);
    const hull = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.1, 9.5, 2, 0.4), cream);
    hull.position.y = 0.2; boat.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 7), teal);
    deck.position.y = 0.8; boat.add(deck);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 14, 6), lightSteel);
    mast.position.set(0, 7.6, -0.5); boat.add(mast);
    const sail = new THREE.Mesh(sailGeometry, sailMat);
    sail.position.set(0, 1.5, -0.3); boat.add(sail);
    const jib = new THREE.Mesh(sailGeometry, sailAccent);
    jib.scale.set(1, 0.66, -0.6); jib.position.set(0, 1.5, -0.8); boat.add(jib);
    boat.userData.heading = heading;
    root.add(boat); boats.push(boat);
  }

  // Merge repeated static elements by material: the scenery stays inexpensive to draw.
  for (const [mat, geometries] of batches) {
    // Some procedural surfaces are indexed while primitives differ; standardize before merging.
    const prepared = geometries.map(geometry => {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (!g.getAttribute('uv')) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      }
      return g;
    });
    const merged = mergeGeometries(prepared, false);
    if (merged) solid(merged, mat, mat !== grass && mat !== cream && mat !== coral);
    for (const geometry of new Set([...geometries, ...prepared])) geometry.dispose();
  }
  temporaryGeometries.forEach(geometry => geometry.dispose());

  return {
    colliders,
    update(time: number) {
      for (const flag of flags) {
        flag.rotation.y = flag.userData.baseRotation + Math.sin(time * 1.9 + flag.userData.phase) * 0.1;
        const positions = flag.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), y = positions.getY(i);
          positions.setZ(i, Math.sin(y * 1.9 + time * 3.7 + flag.userData.phase) * 0.09 * (x + 0.73));
        }
        positions.needsUpdate = true;
      }
      oceanMaterial.uniforms.time.value = time;
      for (let i = 0; i < boats.length; i++) {
        const boat = boats[i];
        boat.position.y = -0.85 + Math.sin(time * 0.72 + i * 2) * 0.12;
        boat.rotation.z = Math.sin(time * 0.63 + i) * 0.025;
        boat.rotation.y = boat.userData.heading + Math.sin(time * 0.13 + i) * 0.03;
      }
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(mat);
          for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(mat => mat.dispose());
      textures.forEach(texture => texture.dispose());
      scene.remove(root);
    },
  };
}

/** Local +Z is forward. Wheel groups rotate around X; all contact patches sit at Y=0. */
export function createCar(color: number, isPlayer = false, vehicleId: VehicleId = 'tide'): THREE.Group {
  const car = new THREE.Group();
  car.rotation.order = 'YXZ';
  const edition = isPlayer
    ? [VEHICLES[vehicleId].name.match(/\d+/)?.[0] ?? '07', VEHICLES[vehicleId].subtitle.toUpperCase()]
    : ['07', 'ISLAND RIVAL'];
  car.name = isPlayer ? `${edition[0]} / ${edition[1]}` : 'Island rival';
  car.userData.color = color;
  const body = material(color, 0.27, 0.3);
  const darkBody = material(new THREE.Color(color).multiplyScalar(0.55).getHex(), 0.5, 0.22);
  const ivory = material(0xf4fff2, 0.4, 0.18);
  const chassis = material(0x18363f, 0.56, 0.42);
  const metal = material(0x9aa29e, 0.35, 0.65);
  const darkMetal = material(0x31535a, 0.4, 0.66);
  const rubber = material(0x242727, 0.95);
  const glass = new THREE.MeshStandardMaterial({ color: 0x174f66, roughness: 0.15, metalness: 0.62 });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xe9ffff, emissive: 0xb1f1ff, emissiveIntensity: 1.5, roughness: 0.2 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0xfc6146, emissive: 0xf23a22, emissiveIntensity: 1.1 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0xa4ffff, emissive: 0x21c9ff, emissiveIntensity: 1.5 });
  const mesh = (geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = car) => {
    const part = new THREE.Mesh(geometry, mat);
    part.position.set(x, y, z);
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  };
  const block = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, bevel = 0) =>
    mesh(bevel > 0 ? new RoundedBoxGeometry(w, h, d, 2, bevel) : new THREE.BoxGeometry(w, h, d), mat, x, y, z);

  block(2.03, 0.32, 4.35, chassis, 0, 0.66, 0, 0.09);
  block(2.13, 0.44, 4.10, body, 0, 0.94, 0.1, 0.17);
  block(1.92, 0.2, 1.65, body, 0, 1.19, 1.13, 0.05).rotation.x = 0.1;
  block(0.27, 0.016, 1.72, ivory, -0.22, 1.3, 1.12).rotation.x = 0.1;
  block(0.1, 0.017, 1.72, ivory, 0.06, 1.3, 1.12).rotation.x = 0.1;
  block(1.66, 0.55, 1.57, glass, 0, 1.4, -0.18, 0.19);
  block(1.74, 0.14, 1.19, body, 0, 1.72, -0.33, 0.08);
  block(0.27, 0.016, 1.08, ivory, -0.22, 1.803, -0.31);
  block(0.1, 0.016, 1.08, ivory, 0.06, 1.803, -0.31);
  // Windshield frame and A pillars keep the vehicle readable from the chase camera.
  for (const side of [-1, 1]) {
    block(0.1, 0.59, 0.12, body, side * 0.75, 1.46, 0.47).rotation.x = -0.23;
    block(0.1, 0.57, 0.12, body, side * 0.75, 1.46, -0.89).rotation.x = 0.15;
    block(0.08, 0.46, 0.11, chassis, side * 0.838, 1.44, -0.29);
    block(0.35, 0.17, 0.32, body, side * 1.03, 1.37, 0.34, 0.04);
    block(0.18, 0.14, 2.65, darkBody, side * 1.10, 0.68, -0.14, 0.035);
    block(0.02, 0.035, 2.2, ivory, side * 1.205, 0.74, -0.14);
    // Wide street-racing fenders sit over the physical wheel contact footprint.
    for (const z of [-1.53, 1.5]) block(0.40, 0.17, 1.2, body, side * 1.06, 1.12, z, 0.08);
  }
  block(1.58, 0.2, 0.74, darkMetal, 0, 1.23, -1.32, 0.04);
  for (let i = 0; i < 6; i++) block(1.36, 0.085, 0.038, metal, 0, 1.38, -1.62 + i * 0.11);
  // A slim touring wing gives the rear a distinct street-racing silhouette.
  for (const side of [-1, 1]) {
    block(0.10, 0.44, 0.17, darkMetal, side * 0.76, 1.42, -1.86).rotation.x = 0.16;
    block(0.10, 0.22, 0.62, darkBody, side * 1.14, 1.69, -1.95, 0.025);
  }
  block(2.37, 0.10, 0.62, body, 0, 1.68, -1.95, 0.035).rotation.x = -0.06;
  block(0.31, 0.012, 0.56, ivory, -0.2, 1.74, -1.95).rotation.x = -0.06;
  if (isPlayer && vehicleId === 'pulse') {
    const glow = new THREE.MeshStandardMaterial({ color: 0xcdb5ff, emissive: 0x8d52ff, emissiveIntensity: 2 });
    for (const side of [-1, 1]) {
      block(0.07, 0.045, 2.8, glow, side * 1.19, 0.81, 0.05);
      block(0.11, 0.07, 1.2, glow, side * 0.62, 1.79, -0.25);
    }
  } else if (isPlayer && vehicleId === 'bulwark') {
    for (const side of [-1, 1]) {
      block(0.27, 0.28, 2.9, darkMetal, side * 1.29, 0.77, -0.12, 0.06);
      block(0.3, 0.26, 0.84, body, side * 1.23, 1.17, 1.25, 0.06);
    }
    block(1.62, 0.14, 0.64, darkMetal, 0, 1.84, -0.16, 0.04);
  } else if (isPlayer && vehicleId === 'gale') {
    block(2.84, 0.08, 0.59, ivory, 0, 1.89, -1.95, 0.02);
    for (const side of [-1, 1]) block(0.13, 0.34, 0.42, body, side * 1.26, 1.72, -1.95);
  } else if (isPlayer && vehicleId === 'reef') {
    for (const side of [-1, 1]) block(0.36, 0.09, 1.5, ivory, side * 1.22, 0.91, 0.88, 0.02);
  }

  const wheels: THREE.Object3D[] = [];
  const tireGeometry = new THREE.CylinderGeometry(0.54, 0.54, 0.38, 24, 1);
  tireGeometry.rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.407, 10);
  hubGeometry.rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.TorusGeometry(0.405, 0.023, 4, 16);
  rimGeometry.rotateY(Math.PI / 2);
  const tireTreadGeometry = new THREE.BoxGeometry(0.39, 0.012, 0.14);
  const boltGeometry = new THREE.CylinderGeometry(0.033, 0.033, 0.035, 5);
  boltGeometry.rotateZ(Math.PI / 2);
  for (const x of [-1.15, 1.15]) for (const z of [-1.49, 1.51]) {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0.54, z);
    car.add(wheel);
    mesh(tireGeometry, rubber, 0, 0, 0, wheel);
    mesh(hubGeometry, darkMetal, 0, 0, 0, wheel);
    mesh(rimGeometry, ivory, Math.sign(x) * 0.197, 0, 0, wheel);
    const axle = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 8), body, 0, 0, 0, wheel);
    axle.rotation.z = Math.PI / 2;
    // Merge tread blocks and hub bolts per wheel instead of drawing every groove.
    const treadPieces: THREE.BufferGeometry[] = [];
    const boltPieces: THREE.BufferGeometry[] = [];
    const transform = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * TAU;
      transform.makeRotationX(angle);
      transform.setPosition(0, Math.cos(angle) * 0.541, Math.sin(angle) * 0.541);
      treadPieces.push(tireTreadGeometry.clone().applyMatrix4(transform));
    }
    for (let i = 0; i < 5; i++) {
      const angle = i / 5 * TAU;
      transform.makeTranslation(Math.sign(x) * 0.222, Math.cos(angle) * 0.212, Math.sin(angle) * 0.212);
      boltPieces.push(boltGeometry.clone().applyMatrix4(transform));
    }
    const tread = mergeGeometries(treadPieces);
    const bolts = mergeGeometries(boltPieces);
    if (tread) mesh(tread, rubber, 0, 0, 0, wheel);
    if (bolts) mesh(bolts, metal, 0, 0, 0, wheel);
    treadPieces.forEach(g => g.dispose());
    boltPieces.forEach(g => g.dispose());
    wheels.push(wheel);
  }
  tireTreadGeometry.dispose(); boltGeometry.dispose();

  // Keep rubber and metal separate, but bake all five wheel-detail colors into one mesh.
  // This makes a fully detailed wheel two draw calls instead of six.
  const wheelMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.47, metalness: 0.55 });
  const oldWheelGeometries = new Set<THREE.BufferGeometry>();
  for (const wheel of wheels) {
    const rubberParts: THREE.BufferGeometry[] = [];
    const metalParts: THREE.BufferGeometry[] = [];
    for (const child of [...wheel.children]) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.updateMatrix();
      oldWheelGeometries.add(child.geometry);
      let g = child.geometry.clone().applyMatrix4(child.matrix);
      if (g.index) {
        const indexed = g;
        g = indexed.toNonIndexed();
        indexed.dispose();
      }
      if (child.material === rubber) rubberParts.push(g);
      else {
        const tint = (child.material as THREE.MeshStandardMaterial).color;
        const values = new Float32Array(g.getAttribute('position').count * 3);
        for (let i = 0; i < values.length; i += 3) {
          values[i] = tint.r; values[i + 1] = tint.g; values[i + 2] = tint.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(values, 3));
        metalParts.push(g);
      }
      wheel.remove(child);
    }
    const rubberGeometry = mergeGeometries(rubberParts, false);
    const metalGeometry = mergeGeometries(metalParts, false);
    if (rubberGeometry) mesh(rubberGeometry, rubber, 0, 0, 0, wheel);
    if (metalGeometry) mesh(metalGeometry, wheelMetal, 0, 0, 0, wheel);
    [...rubberParts, ...metalParts].forEach(g => g.dispose());
  }
  oldWheelGeometries.forEach(g => g.dispose());

  block(2.18, 0.22, 0.25, darkMetal, 0, 0.72, 2.28, 0.035);
  block(2.1, 0.22, 0.22, darkMetal, 0, 0.72, -2.24, 0.035);
  block(0.89, 0.12, 0.08, chassis, 0, 1.02, 2.147);
  for (let i = 0; i < 2; i++) block(0.72, 0.018, 0.024, metal, 0, 0.995 + i * 0.055, 2.2);
  for (const side of [-1, 1]) {
    block(0.62, 0.10, 0.12, headlight, side * 0.69, 1.07, 2.17, 0.035);
    block(0.08, 0.19, 0.1, headlight, side * 0.95, 1.005, 2.17, 0.025);
    block(0.48, 0.13, 0.09, taillight, side * 0.73, 1.01, -2.11, 0.02);
    block(0.39, 0.055, 0.035, ivory, side * 0.73, 0.94, -2.17);
  }
  const flames: THREE.Object3D[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x54e5ff, transparent: true, opacity: 0.8, depthWrite: false });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xdbffff, transparent: true, opacity: 0.9, depthWrite: false });
  for (const side of [-1, 1]) {
    const nozzle = mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.38, 10, 1, true), metal, side * 0.59, 0.62, -2.25);
    nozzle.rotation.x = Math.PI / 2;
    const core = mesh(new THREE.CircleGeometry(0.15, 10), cyan, side * 0.59, 0.62, -2.455);
    core.rotation.y = Math.PI;
    const flame = new THREE.Group();
    flame.position.set(side * 0.59, 0.62, -2.39);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.45, 7, 1, true), flameMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.z = -0.68;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1, 7, 1, true), flameCoreMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.z = -0.45;
    flame.add(outer, inner);
    flame.visible = false;
    car.add(flame);
    flames.push(flame);
  }

  const decalTexture = canvasTexture(256, 256, ctx => {
    ctx.fillStyle = '#f2fff3';
    ctx.beginPath(); ctx.roundRect(7, 7, 242, 242, 34); ctx.fill();
    ctx.strokeStyle = '#21565d'; ctx.lineWidth = 8; ctx.strokeRect(21, 21, 214, 214);
    ctx.fillStyle = '#21565d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 137px "Arial Black", Arial, sans-serif';
    ctx.fillText(isPlayer ? edition[0] : String((color % 83) + 10), 128, 119);
    ctx.font = '800 22px Arial, sans-serif'; ctx.fillText(isPlayer ? edition[1] : 'COASTLINE', 128, 214);
  });
  const decalMat = new THREE.MeshStandardMaterial({ map: decalTexture, roughness: 0.66, transparent: true });
  for (const side of [-1, 1]) {
    const number = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.62), decalMat);
    number.position.set(side * 1.074, 0.995, -0.14);
    number.rotation.y = side * Math.PI / 2;
    car.add(number);
  }
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x72eddf, transparent: true, opacity: 0.16,
      wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  shield.position.y = 1;
  shield.scale.set(1.72, 1.48, 2.85);
  shield.visible = false;
  car.add(shield);

  // Static car pieces share a handful of draw calls; wheels and effects remain articulated.
  const bodyBatches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const mergedChildren: THREE.Object3D[] = [];
  car.updateMatrixWorld(true);
  for (const child of car.children) {
    if (!(child instanceof THREE.Mesh) || child === shield || child.material === decalMat) continue;
    if (Array.isArray(child.material)) continue;
    const g = child.geometry.clone().applyMatrix4(child.matrix);
    const pieces = bodyBatches.get(child.material) ?? [];
    pieces.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
    bodyBatches.set(child.material, pieces);
    mergedChildren.push(child);
  }
  for (const child of mergedChildren) {
    car.remove(child);
    (child as THREE.Mesh).geometry.dispose();
  }
  for (const [mat, pieces] of bodyBatches) {
    const geometry = mergeGeometries(pieces, false);
    if (geometry) mesh(geometry, mat, 0, 0, 0);
    pieces.forEach(g => g.dispose());
  }
  car.userData.wheels = wheels;
  car.userData.flames = flames;
  car.userData.shield = shield;
  return car;
}
