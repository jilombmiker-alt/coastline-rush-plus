import { DEFAULT_DIFFICULTY, isDifficulty } from './difficulty';
import { DEFAULT_VEHICLE, isVehicle } from './vehicles';
import type { Difficulty, VehicleId } from './types';
import { isTrackId, type TrackId } from './track';
import type { RaceMode } from './types';

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DIFFICULTY_KEY = 'coastline-rush-difficulty-v1';
const VEHICLE_KEY = 'coastline-rush-vehicle-v1';
const BEST_KEY_PREFIX = 'coastline-rush-best-';

function bestKey(difficulty: Difficulty, vehicle: VehicleId, track: TrackId, mode: RaceMode): string {
  const base = `${BEST_KEY_PREFIX}${difficulty}-${vehicle}`;
  return track === 'bay' && mode === 'party' ? base : `${base}-${track}-${mode}`;
}

function parseTime(raw: string | null): number {
  if (typeof raw !== 'string' || raw.trim() === '') return Infinity;
  const time = Number(raw);
  return Number.isFinite(time) && time > 0 ? time : Infinity;
}

/** Keep read failure distinct from an absent record: never overwrite an unknown best. */
function storedBest(storage: ProgressStorage, difficulty: Difficulty, vehicle: VehicleId,
  track: TrackId, mode: RaceMode): { time: number; readable: boolean } {
  try {
    return { time: parseTime(storage.getItem(bestKey(difficulty, vehicle, track, mode))), readable: true };
  } catch {
    return { time: Infinity, readable: false };
  }
}

export function readSelectedDifficulty(storage: ProgressStorage): Difficulty {
  try {
    const selected = storage.getItem(DIFFICULTY_KEY);
    return isDifficulty(selected) ? selected : DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

export function saveSelectedDifficulty(storage: ProgressStorage, difficulty: Difficulty): boolean {
  if (!isDifficulty(difficulty)) return false;
  try {
    storage.setItem(DIFFICULTY_KEY, difficulty);
    return true;
  } catch {
    return false;
  }
}

export function readSelectedVehicle(storage: ProgressStorage): VehicleId {
  try {
    const selected = storage.getItem(VEHICLE_KEY);
    return isVehicle(selected) ? selected : DEFAULT_VEHICLE;
  } catch {
    return DEFAULT_VEHICLE;
  }
}

export function saveSelectedVehicle(storage: ProgressStorage, vehicle: VehicleId): boolean {
  if (!isVehicle(vehicle)) return false;
  try {
    storage.setItem(VEHICLE_KEY, vehicle);
    return true;
  } catch {
    return false;
  }
}

/** Records belong to this game and one difficulty/vehicle pair; source-game saves stay untouched. */
export function readBestTime(storage: ProgressStorage, difficulty: Difficulty, vehicle: VehicleId = DEFAULT_VEHICLE,
  track: TrackId = 'bay', mode: RaceMode = 'party'): number {
  return storedBest(storage, isDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY,
    isVehicle(vehicle) ? vehicle : DEFAULT_VEHICLE,
    isTrackId(track) ? track : 'bay', mode === 'speed' || mode === 'party' ? mode : 'party').time;
}

/** Return true only when an actual, strictly better record was successfully saved. */
export function saveBestTime(storage: ProgressStorage, difficulty: Difficulty, time: number,
  vehicle: VehicleId = DEFAULT_VEHICLE, track: TrackId = 'bay', mode: RaceMode = 'party'): boolean {
  if (!isDifficulty(difficulty) || !isVehicle(vehicle) || !isTrackId(track) ||
    (mode !== 'speed' && mode !== 'party') || !Number.isFinite(time) || time <= 0) return false;
  const previous = storedBest(storage, difficulty, vehicle, track, mode);
  if (!previous.readable || time >= previous.time) return false;
  try {
    storage.setItem(bestKey(difficulty, vehicle, track, mode), String(time));
    return true;
  } catch {
    return false;
  }
}
