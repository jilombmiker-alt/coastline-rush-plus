import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DIFFICULTY, DIFFICULTY_ORDER } from '../src/difficulty';
import { DEFAULT_VEHICLE, VEHICLE_ORDER } from '../src/vehicles';
import {
  readBestTime, readSelectedDifficulty, readSelectedVehicle,
  saveBestTime, saveSelectedDifficulty, saveSelectedVehicle, type ProgressStorage,
} from '../src/progress';
import type { Difficulty, VehicleId } from '../src/types';

const difficultyKey = 'coastline-rush-difficulty-v1';
const vehicleKey = 'coastline-rush-vehicle-v1';
const bestKey = (difficulty: string, vehicle = 'tide') => `coastline-rush-best-${difficulty}-${vehicle}`;

class MemoryStorage implements ProgressStorage {
  readonly data: Map<string, string>;
  readonly reads: string[] = [];
  readonly writes: { key: string; value: string }[] = [];

  constructor(initial: Record<string, string> = {}) {
    this.data = new Map(Object.entries(initial));
  }

  getItem(key: string) {
    this.reads.push(key);
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes.push({ key, value });
    this.data.set(key, value);
  }
}

test('missing or invalid preferences fall back without writing user data', () => {
  assert.equal(readSelectedDifficulty(new MemoryStorage()), DEFAULT_DIFFICULTY);
  assert.equal(readSelectedVehicle(new MemoryStorage()), DEFAULT_VEHICLE);
  for (const value of ['', ' ', 'normal', 'HARD', ' hard ', ' tide ', 'TIDE', 'undefined', '__proto__']) {
    const storage = new MemoryStorage({ [difficultyKey]: value, [vehicleKey]: value });
    assert.equal(readSelectedDifficulty(storage), DEFAULT_DIFFICULTY);
    assert.equal(readSelectedVehicle(storage), DEFAULT_VEHICLE);
    assert.equal(storage.data.get(difficultyKey), value);
    assert.equal(storage.data.get(vehicleKey), value);
    assert.equal(storage.writes.length, 0);
  }
});

test('all difficulty and vehicle preferences are saved under independent game keys', () => {
  const storage = new MemoryStorage({ unrelated: 'untouched' });
  for (const difficulty of DIFFICULTY_ORDER) {
    assert.equal(saveSelectedDifficulty(storage, difficulty), true);
    assert.equal(readSelectedDifficulty(storage), difficulty);
    assert.deepEqual(storage.writes.at(-1), { key: difficultyKey, value: difficulty });
  }
  for (const vehicle of VEHICLE_ORDER) {
    assert.equal(saveSelectedVehicle(storage, vehicle), true);
    assert.equal(readSelectedVehicle(storage), vehicle);
    assert.deepEqual(storage.writes.at(-1), { key: vehicleKey, value: vehicle });
  }
  assert.equal(storage.data.get('unrelated'), 'untouched');
});

test('invalid runtime difficulties and vehicles cannot create or overwrite storage keys', () => {
  const storage = new MemoryStorage({ [difficultyKey]: 'hard', [vehicleKey]: 'reef', [bestKey('easy')]: '91' });
  for (const invalid of ['normal', '', '__proto__', 'easy/../../hard', null, 0]) {
    const difficulty = invalid as unknown as Difficulty;
    const vehicle = invalid as unknown as VehicleId;
    assert.equal(saveSelectedDifficulty(storage, difficulty), false);
    assert.equal(saveSelectedVehicle(storage, vehicle), false);
    assert.equal(saveBestTime(storage, difficulty, 60), false);
    assert.equal(saveBestTime(storage, 'easy', 60, vehicle), false);
    assert.equal(readBestTime(storage, difficulty), 91);
    assert.equal(readBestTime(storage, 'easy', vehicle), 91);
  }
  assert.equal(storage.data.get(difficultyKey), 'hard');
  assert.equal(storage.data.get(vehicleKey), 'reef');
  assert.equal(storage.data.size, 3);
  assert.equal(storage.writes.length, 0);
});

test('all difficulty and vehicle pairs save and read independent best records', () => {
  const storage = new MemoryStorage();
  let time = 100;
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const vehicle of VEHICLE_ORDER) {
      assert.equal(saveBestTime(storage, difficulty, time++, vehicle), true);
    }
  }
  time = 100;
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const vehicle of VEHICLE_ORDER) {
      assert.equal(readBestTime(storage, difficulty, vehicle), time++);
    }
  }
  assert.equal(storage.data.size, DIFFICULTY_ORDER.length * VEHICLE_ORDER.length);
});

test('omitting the vehicle remains compatible and uses only the default tide record', () => {
  const storage = new MemoryStorage({ [bestKey('hard', 'reef')]: '70' });
  assert.equal(readBestTime(storage, 'hard'), Infinity);
  assert.equal(saveBestTime(storage, 'hard', 95.5), true);
  assert.equal(readBestTime(storage, 'hard'), 95.5);
  assert.equal(readBestTime(storage, 'hard', 'tide'), 95.5);
  assert.equal(readBestTime(storage, 'hard', 'reef'), 70);
  assert.equal(readBestTime(storage, 'hard', 'gale'), Infinity);
});

test('source-game preferences and both old best formats are never read, migrated or changed', () => {
  const sourceData = {
    'other-game-difficulty-v1': 'hell', 'other-game-vehicle-v1': 'gale',
    'other-game-best-v1': '60', 'other-game-best-v2-easy': '62',
    'other-game-best-v2-hard': '63', 'other-game-best-v2-hell': '64',
    unrelated: 'keep',
  };
  const storage = new MemoryStorage(sourceData);
  assert.equal(readSelectedDifficulty(storage), DEFAULT_DIFFICULTY);
  assert.equal(readSelectedVehicle(storage), DEFAULT_VEHICLE);
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const vehicle of VEHICLE_ORDER) {
      assert.equal(readBestTime(storage, difficulty, vehicle), Infinity);
      assert.equal(saveBestTime(storage, difficulty, 120, vehicle), true);
    }
  }
  assert.equal(saveSelectedDifficulty(storage, 'hard'), true);
  assert.equal(saveSelectedVehicle(storage, 'reef'), true);
  for (const [key, value] of Object.entries(sourceData)) assert.equal(storage.data.get(key), value);
  assert.ok(storage.reads.every(key => key.startsWith('coastline-rush-')));
  assert.ok(storage.writes.every(({ key }) => key.startsWith('coastline-rush-')));
});

test('empty, corrupt, infinite and nonpositive records are treated as absent', () => {
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const vehicle of VEHICLE_ORDER) {
      assert.equal(readBestTime(new MemoryStorage(), difficulty, vehicle), Infinity);
      for (const value of ['', ' ', '\n\t', 'garbage', 'NaN', 'Infinity', '-Infinity', '1e999',
        '0', '-0', '-15.5', 'null', '{}', 'true', '[100]']) {
        const key = bestKey(difficulty, vehicle);
        const storage = new MemoryStorage({ [key]: value });
        assert.equal(readBestTime(storage, difficulty, vehicle), Infinity, `${key}: ${JSON.stringify(value)}`);
        assert.equal(storage.writes.length, 0);
        assert.equal(storage.data.get(key), value);
      }
    }
  }
});

test('finite positive fractional and scientific-notation times retain their precision', () => {
  for (const [raw, expected] of [['89.123456789', 89.123456789], [' 102.5 ', 102.5], ['1.2e2', 120], ['1e-6', 1e-6]] as const) {
    assert.equal(readBestTime(new MemoryStorage({ [bestKey('hell', 'gale')]: raw }), 'hell', 'gale'), expected);
  }
});

test('invalid new times never write over an existing record', () => {
  const storage = new MemoryStorage({ [bestKey('hard', 'reef')]: '95.5' });
  for (const time of [Infinity, -Infinity, NaN, 0, -0, -1, -100]) {
    assert.equal(saveBestTime(storage, 'hard', time, 'reef'), false);
  }
  assert.equal(storage.data.get(bestKey('hard', 'reef')), '95.5');
  assert.equal(storage.writes.length, 0);
});

test('a best record is written only for a strict improvement, never a tie or worse result', () => {
  const storage = new MemoryStorage();
  assert.equal(saveBestTime(storage, 'hard', 90.5, 'reef'), true);
  assert.equal(saveBestTime(storage, 'hard', 91, 'reef'), false);
  assert.equal(saveBestTime(storage, 'hard', 90.5, 'reef'), false);
  assert.equal(storage.writes.length, 1);
  assert.equal(saveBestTime(storage, 'hard', 89.125, 'reef'), true);
  assert.equal(storage.data.get(bestKey('hard', 'reef')), '89.125');
  assert.equal(readBestTime(storage, 'hard', 'reef'), 89.125);
  assert.equal(storage.writes.length, 2);
});

test('a first valid result replaces a corrupt local record without importing a source-game best', () => {
  const storage = new MemoryStorage({ [bestKey('easy')]: 'broken', 'other-game-best-v1': '60' });
  assert.equal(saveBestTime(storage, 'easy', 110), true);
  assert.equal(readBestTime(storage, 'easy'), 110);
  assert.equal(storage.data.get('other-game-best-v1'), '60');
  assert.deepEqual(storage.writes, [{ key: bestKey('easy'), value: '110' }]);
});

test('throwing storage is contained and public operations return safe results', () => {
  const storage: ProgressStorage = {
    getItem() { throw new Error('storage access denied'); },
    setItem() { throw new Error('quota exceeded'); },
  };
  assert.equal(readSelectedDifficulty(storage), DEFAULT_DIFFICULTY);
  assert.equal(saveSelectedDifficulty(storage, 'hell'), false);
  assert.equal(readSelectedVehicle(storage), DEFAULT_VEHICLE);
  assert.equal(saveSelectedVehicle(storage, 'gale'), false);
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const vehicle of VEHICLE_ORDER) {
      assert.equal(readBestTime(storage, difficulty, vehicle), Infinity);
      assert.equal(saveBestTime(storage, difficulty, 90, vehicle), false);
    }
  }
});

test('a failed record read refuses to write because the existing best is unknown', () => {
  const data = new MemoryStorage({ [bestKey('hard', 'reef')]: '70' });
  const storage: ProgressStorage = {
    getItem() { throw new Error('read unavailable'); },
    setItem(key, value) { data.setItem(key, value); },
  };
  assert.equal(saveBestTime(storage, 'hard', 100, 'reef'), false);
  assert.equal(data.data.get(bestKey('hard', 'reef')), '70');
  assert.equal(data.writes.length, 0);
});

test('write failures report false and preserve previous preferences and records', () => {
  const data = new MemoryStorage({ [difficultyKey]: 'hard', [vehicleKey]: 'reef', [bestKey('hell', 'gale')]: '120' });
  const storage: ProgressStorage = {
    getItem(key) { return data.getItem(key); },
    setItem() { throw new Error('quota exceeded'); },
  };
  assert.equal(saveSelectedDifficulty(storage, 'easy'), false);
  assert.equal(saveSelectedVehicle(storage, 'tide'), false);
  assert.equal(saveBestTime(storage, 'hell', 90, 'gale'), false);
  assert.equal(readSelectedDifficulty(storage), 'hard');
  assert.equal(readSelectedVehicle(storage), 'reef');
  assert.equal(readBestTime(storage, 'hell', 'gale'), 120);
  assert.equal(data.writes.length, 0);
});

test('reading preferences and records has no write side effects', () => {
  const storage = new MemoryStorage({ [difficultyKey]: 'hell', [vehicleKey]: 'reef', [bestKey('hard')]: '110' });
  const before = [...storage.data.entries()];
  for (let i = 0; i < 3; i++) {
    assert.equal(readSelectedDifficulty(storage), 'hell');
    assert.equal(readSelectedVehicle(storage), 'reef');
    for (const difficulty of DIFFICULTY_ORDER) {
      for (const vehicle of VEHICLE_ORDER) readBestTime(storage, difficulty, vehicle);
    }
  }
  assert.deepEqual([...storage.data.entries()], before);
  assert.equal(storage.writes.length, 0);
});
