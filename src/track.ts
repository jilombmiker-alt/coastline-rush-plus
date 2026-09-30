import * as THREE from 'three';

export const TRACK_WIDTH = 19;
export type TrackId = 'bay' | 'storm' | 'neon' | 'ridge' | 'coral' | 'aurora';
export const TRACKS = {
  bay: { name: '晴湾环岛', subtitle: '均衡环线 · 海岸中速弯', character: '均衡', points: [
  [0, 1.1, 180],
  [0, 1.1, 55],
  [-42, 2.2, -54],
  [-28, 5.5, -165],
  [74, 8.0, -245],
  [192, 7.0, -213],
  [229, 3.2, -105],
  [151, 1.1, -20],
  [179, 1.1, 100],
  [249, 3.2, 200],
  [201, 5.6, 280],
  [80, 2.8, 294],
  ] },
  storm: { name: '赤霞风暴', subtitle: '密集弯道 · 漂移节奏', character: '多弯', points: [
    [0, 1.1, 180], [-10, 1.1, 70], [-70, 2, -10], [-20, 3, -80],
    [-75, 4, -155], [-20, 5, -240], [55, 6, -210], [110, 5, -275],
    [210, 4, -210], [175, 2, -135], [255, 3, -45], [190, 1.1, 20],
    [255, 2, 105], [245, 4, 190], [175, 5, 270], [90, 3, 220], [40, 2, 305],
  ] },
  neon: { name: '霓虹夜港', subtitle: '长直道 · 高速入弯', character: '高速', points: [
    [0, 1.1, 180], [0, 1.1, 45], [-15, 2, -100], [20, 3, -240],
    [130, 5, -265], [260, 4, -205], [280, 3, -75], [260, 2, 65],
    [300, 2, 180], [235, 3, 300], [115, 2, 310],
  ] },
  ridge: { name: '云岭盘山', subtitle: '高低起伏 · 连续回头弯', character: '山路', points: [
    [0, 1.1, 180], [0, 3, 65], [-65, 7, -20], [-105, 14, -110],
    [-72, 22, -205], [15, 29, -295], [120, 25, -258], [177, 18, -173],
    [143, 13, -83], [228, 9, 5], [265, 7, 115], [192, 4, 225], [84, 2, 287],
  ] },
  coral: { name: '珊瑚群岛', subtitle: '宽阔海岸 · 中高速连续弯', character: '巡航', points: [
    [0, 1.1, 180], [-12, 1.1, 65], [-78, 1.4, -62], [-49, 2, -198],
    [25, 2, -273], [110, 2.5, -218], [167, 2, -120], [240, 1.7, -76],
    [305, 1.3, 5], [286, 1.4, 145], [204, 1.5, 239], [92, 1.1, 298],
  ] },
  aurora: { name: '极光长湾', subtitle: '高速环线 · 两处急弯', character: '冲刺', points: [
    [0, 1.1, 180], [-8, 1.1, 30], [-38, 2, -145], [-10, 2, -280],
    [122, 3, -329], [250, 3, -269], [318, 2.5, -146], [261, 2, -20],
    [333, 2, 112], [267, 2, 270], [153, 1.4, 330], [68, 1.1, 295],
  ] },
} as const;
export const TRACK_ORDER: readonly TrackId[] = ['bay', 'storm', 'neon', 'ridge', 'coral', 'aurora'];
export const isTrackId = (value: unknown): value is TrackId =>
  value === 'bay' || value === 'storm' || value === 'neon' ||
  value === 'ridge' || value === 'coral' || value === 'aurora';
export let activeTrack: TrackId = 'bay';
export let TRACK_POINTS: readonly (readonly number[])[];
export let TRACK_CURVE: THREE.CatmullRomCurve3;
export let TRACK_LENGTH: number;

export interface TrackSample {
  x: number; y: number; z: number;
  tx: number; tz: number;
  nx: number; nz: number;
  heading: number; curvature: number;
}
const SAMPLES = 3000;
let cached: Omit<TrackSample, 'curvature'>[] = [];
export function setActiveTrack(id: TrackId): void {
  activeTrack = id;
  TRACK_POINTS = TRACKS[id].points;
  TRACK_CURVE = new THREE.CatmullRomCurve3(
    TRACK_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', 0.42);
  TRACK_CURVE.arcLengthDivisions = SAMPLES;
  TRACK_CURVE.updateArcLengths();
  TRACK_LENGTH = TRACK_CURVE.getLength();
  cached = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i % SAMPLES) / SAMPLES;
    const p = TRACK_CURVE.getPointAt(t);
    const v = TRACK_CURVE.getTangentAt(t);
    const mag = Math.hypot(v.x, v.z);
    const tx = v.x / mag, tz = v.z / mag;
    cached.push({ x: p.x, y: p.y, z: p.z, tx, tz, nx: -tz, nz: tx, heading: Math.atan2(tx, tz) });
  }
}
setActiveTrack('bay');
export const wrapDistance = (distance: number) => ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
export const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function sampleTrack(distance: number): TrackSample {
  const u = wrapDistance(distance) / TRACK_LENGTH * SAMPLES;
  const index = Math.floor(u);
  const f = u - index;
  const a = cached[index];
  const b = cached[index + 1];
  const heading = a.heading + angleDifference(b.heading, a.heading) * f;
  const tx = Math.sin(heading);
  const tz = Math.cos(heading);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    tx, tz, nx: -tz, nz: tx, heading,
    curvature: angleDifference(b.heading, a.heading) / (TRACK_LENGTH / SAMPLES),
  };
}

export function trackPosition(distance: number, lateral = 0, height = 0): THREE.Vector3 {
  const p = sampleTrack(distance);
  return new THREE.Vector3(p.x + p.nx * lateral, p.y + height, p.z + p.nz * lateral);
}

export function distanceToTrack(x: number, z: number): number {
  let result = Infinity;
  for (let i = 0; i < SAMPLES; i += 12) {
    const p = cached[i];
    result = Math.min(result, Math.hypot(p.x - x, p.z - z));
  }
  return result;
}

export function minimapPath(width: number, height: number, padding = 12): string {
  const { minX, maxX, minZ, maxZ } = trackBounds();
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxZ - minZ));
  const dx = (width - (maxX - minX) * scale) / 2;
  const dz = (height - (maxZ - minZ) * scale) / 2;
  const parts: string[] = [];
  for (let i = 0; i < 180; i++) {
    const p = sampleTrack(i / 180 * TRACK_LENGTH);
    parts.push(`${i ? 'L' : 'M'}${(dx + (p.x - minX) * scale).toFixed(1)},${(dz + (p.z - minZ) * scale).toFixed(1)}`);
  }
  return parts.join(' ') + 'Z';
}

export function minimapPoint(distance: number, width: number, height: number, padding = 12) {
  const p = sampleTrack(distance);
  const { minX, maxX, minZ, maxZ } = trackBounds();
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxZ - minZ));
  return {
    x: (width - (maxX - minX) * scale) / 2 + (p.x - minX) * scale,
    y: (height - (maxZ - minZ) * scale) / 2 + (p.z - minZ) * scale,
  };
}

function trackBounds() {
  const xs = TRACK_POINTS.map(p => p[0]), zs = TRACK_POINTS.map(p => p[2]);
  return { minX: Math.min(...xs) - 15, maxX: Math.max(...xs) + 15,
    minZ: Math.min(...zs) - 15, maxZ: Math.max(...zs) + 15 };
}
