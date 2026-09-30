export type ItemType = 'rocket' | 'mine' | 'shield' | 'nitro' | 'oil' | 'emp' | 'magnet';
export type GamePhase = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';
export type Difficulty = 'easy' | 'hard' | 'hell';
export type VehicleId = 'tide' | 'reef' | 'gale' | 'pulse' | 'bulwark';
export type RaceMode = 'classic' | 'speed' | 'party';
import type { TrackId } from './track';

export interface InputState {
  throttle: boolean;
  brake: boolean;
  steer: number;
  drift: boolean;
  boost: boolean;
  useItem: boolean;
  reset: boolean;
}

export interface Racer {
  id: number;
  name: string;
  color: number;
  isPlayer: boolean;
  human: boolean;
  active?: boolean;
  vehicle: VehicleId;
  distance: number;
  lateral: number;
  heading: number;
  speed: number;
  lap: number;
  rank: number;
  item: ItemType | null;
  charge: number;
  energy: number;
  shield: number;
  boostTime: number;
  hitTime: number;
  slickTime: number;
  jamTime: number;
  collisionTime: number;
  invulnerable: number;
  driftTime: number;
  driftScore: number;
  driftReady: number;
  hits: number;
  drifts: number;
  bestLap: number;
  lastLapTime: number;
  finished: boolean;
  finishTime: number;
}

export interface Pickup {
  id: number;
  distance: number;
  lateral: number;
  type: ItemType;
  cooldown: number;
}

export interface Projectile {
  id: number;
  type: 'rocket' | 'mine' | 'oil';
  owner: number;
  distance: number;
  lateral: number;
  lifetime: number;
  powered: boolean;
  target: number | null;
}

export interface GameEvent {
  type: 'pickup' | 'fire' | 'hit' | 'collision' | 'shield' | 'boost' | 'drift' | 'lap' | 'finish' | 'reset' | 'countdown';
  racer: number;
  item?: ItemType;
  text?: string;
  collisionKind?: 'car' | 'barrier' | 'rock' | 'structure';
  strength?: number;
  contact?: { x: number; y: number; z: number };
  other?: number;
}

export interface RaceState {
  phase: GamePhase;
  difficulty: Difficulty;
  vehicle: VehicleId;
  track: TrackId;
  mode: RaceMode;
  racers: Racer[];
  pickups: Pickup[];
  projectiles: Projectile[];
  events: GameEvent[];
  time: number;
  countdown: number;
  totalLaps: number;
  bestLap: number;
  lastLapTime: number;
  hits: number;
  drifts: number;
}

export const EMPTY_INPUT: InputState = {
  throttle: false, brake: false, steer: 0, drift: false,
  boost: false, useItem: false, reset: false,
};
