import assert from 'node:assert/strict';
import test from 'node:test';
import { RaceSimulation } from '../src/simulation';
import { readBestTime, saveBestTime } from '../src/progress';
import { TRACK_LENGTH, TRACK_ORDER, sampleTrack, type TrackId } from '../src/track';
import { EMPTY_INPUT, type InputState } from '../src/types';
import { VEHICLES } from '../src/vehicles';

const controls = (changes: Partial<InputState> = {}): InputState => ({ ...EMPTY_INPUT, ...changes });
const running = (track: TrackId = 'bay') => {
  const sim = new RaceSimulation(42);
  assert.equal(sim.setTrack(track), true);
  sim.start();
  sim.update(3, EMPTY_INPUT);
  sim.state.racers.slice(1).forEach(racer => { racer.finished = true; });
  sim.state.pickups.forEach(pickup => { pickup.cooldown = 1000; });
  return sim;
};

test('all six routes have distinct lengths; right moves right and left moves left', () => {
  const lengths: number[] = [];
  for (const track of TRACK_ORDER) {
    const right = running(track);
    lengths.push(TRACK_LENGTH);
    Object.assign(right.state.racers[0], { distance: 25, lateral: 0, heading: 0, speed: 35 });
    right.update(0.3, controls({ throttle: true, steer: 1 }));
    assert.ok(right.state.racers[0].lateral > 0.2, `${track} right`);
    const left = running(track);
    Object.assign(left.state.racers[0], { distance: 25, lateral: 0, heading: 0, speed: 35 });
    left.update(0.3, controls({ throttle: true, steer: -1 }));
    assert.ok(left.state.racers[0].lateral < -0.2, `${track} left`);
  }
  assert.equal(new Set(lengths.map(Math.round)).size, 6);
});

test('holding only throttle cannot auto-correct through a full lap on any route', () => {
  for (const track of TRACK_ORDER) {
    const sim = running(track);
    let resets = 0;
    for (let frame = 0; frame < 60 * 120; frame++) {
      sim.update(1 / 60, controls({ throttle: true }));
      resets += sim.state.events.filter(event => event.type === 'reset').length;
    }
    assert.equal(sim.state.lastLapTime, 0, `${track}: no lap from straight driving`);
    assert.ok(sim.state.racers[0].distance < TRACK_LENGTH, `${track}: stuck before finish`);
    assert.ok(resets > 0, `${track}: missing the turn requires recovery`);
  }
});

test('speed mode has no pickups or held nitro; party gives trailing racers catch-up supplies', () => {
  const speed = new RaceSimulation(10);
  speed.setMode('speed'); speed.start(); speed.update(3, EMPTY_INPUT);
  assert.equal(speed.state.pickups.length, 0);
  const speedPlayer = speed.state.racers[0];
  speedPlayer.speed = 35; speedPlayer.energy = 30;
  speed.update(0.2, controls({ throttle: true, boost: true }));
  assert.equal(speedPlayer.boostTime, 0);
  assert.ok(speedPlayer.energy >= 30);

  const party = new RaceSimulation(10);
  party.setMode('party'); party.start(); party.update(3, EMPTY_INPUT);
  party.state.racers.slice(1).forEach(racer => { racer.finished = true; });
  const player = party.state.racers[0];
  const pickup = party.state.pickups.find(p => p.type === 'mine')!;
  Object.assign(player, { rank: 6, distance: pickup.distance, lateral: pickup.lateral, speed: 0, energy: 20 });
  party.update(1 / 90, EMPTY_INPUT);
  assert.ok(['rocket', 'magnet', 'emp', 'nitro'].includes(player.item ?? ''));
  assert.ok(player.energy >= 32);
});

test('oil, EMP and magnet produce different race effects while a shield blocks interference', () => {
  const sim = running();
  const [player, target] = sim.state.racers;
  target.finished = false;
  Object.assign(player, { distance: 100, lateral: 0, speed: 0, item: 'oil' });
  Object.assign(target, { distance: 95, lateral: 0, speed: 25, invulnerable: 0, shield: 0 });
  sim.update(1 / 90, controls({ useItem: true }));
  assert.ok(target.slickTime > 2, 'oil reduces grip');
  assert.equal(target.hitTime, 0, 'oil does not behave like a rocket');
  sim.update(1 / 90, controls());

  Object.assign(player, { distance: 100, item: 'emp' });
  Object.assign(target, { distance: 120, lateral: 0, energy: 90, invulnerable: 0, boostTime: 1 });
  sim.update(1 / 90, controls({ useItem: true }));
  assert.ok(target.jamTime > 1, 'EMP disables held nitro');
  assert.ok(target.energy < 65, 'EMP drains energy');
  sim.update(1 / 90, controls());

  Object.assign(player, { distance: 100, item: 'magnet', boostTime: 0 });
  Object.assign(target, { distance: 120, invulnerable: 0, shield: 0, speed: 25 });
  sim.update(1 / 90, controls({ useItem: true }));
  assert.ok(player.boostTime > 1, 'magnet gives a draft boost');
  assert.ok(target.speed < 25, 'magnet tugs the leading car');
  sim.update(1 / 90, controls());

  Object.assign(player, { item: 'emp' });
  Object.assign(target, { distance: 120, shield: 2, invulnerable: 0, jamTime: 0, energy: 90 });
  sim.update(1 / 90, controls({ useItem: true }));
  assert.equal(target.shield, 0);
  assert.equal(target.jamTime, 0);
  assert.ok(target.energy > 99, 'balanced car recovers energy when its shield blocks an item');
});

test('releasing a controlled drift gives a mini boost, then a fresh throttle tap gives a second spray', () => {
  const sim = running();
  const player = sim.state.racers[0];
  Object.assign(player, { distance: 25, lateral: 0, heading: 0, speed: 35 });
  for (let i = 0; i < 48; i++) {
    const curve = sampleTrack(player.distance + 10).curvature;
    sim.update(1 / 60, controls({ throttle: true, steer: -Math.sign(curve) * 0.25, drift: true }));
  }
  sim.update(1 / 60, controls({ throttle: true }));
  assert.ok(player.boostTime > 0);
  assert.equal(sim.state.drifts, 1);
  sim.update(1 / 60, controls());
  sim.update(1 / 60, controls({ throttle: true }));
  assert.ok(sim.state.events.some(event => event.type === 'drift' && event.text === 'DOUBLE SPRAY!'));
});

test('track and mode have separate records; the original bay party key stays readable', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.equal(saveBestTime(storage, 'easy', 90, 'tide'), true);
  assert.equal(saveBestTime(storage, 'easy', 100, 'tide', 'storm', 'speed'), true);
  assert.equal(readBestTime(storage, 'easy', 'tide', 'storm', 'speed'), 100);
  assert.equal(readBestTime(storage, 'easy', 'tide', 'bay', 'party'), 90);
  assert.equal(readBestTime(storage, 'easy', 'tide', 'storm', 'party'), Infinity);
});

test('bulwark preserves more speed than the balanced car in an equivalent car contact', () => {
  const impactSpeed = (vehicle: 'tide' | 'bulwark') => {
    const sim = new RaceSimulation(17, 'easy', vehicle);
    sim.start(); sim.update(3, EMPTY_INPUT);
    const [player, rival] = sim.state.racers;
    sim.state.racers.slice(2).forEach(racer => { racer.finished = true; });
    Object.assign(player, { distance: 35, lateral: 0, heading: 0, speed: 34 });
    Object.assign(rival, { distance: 38.4, lateral: 0, heading: 0, speed: 0 });
    sim.update(1 / 90, controls({ throttle: true }));
    return player.speed;
  };
  assert.ok(impactSpeed('bulwark') > impactSpeed('tide') + 0.5);
});

test('five vehicles can drive each full route under one identical clean-road controller', () => {
  const times = new Map<string, number>();
  for (const track of TRACK_ORDER) for (const vehicle of ['tide', 'reef', 'gale', 'pulse', 'bulwark'] as const) {
    const sim = new RaceSimulation(42, 'easy', vehicle);
    sim.setTrack(track); sim.setMode('speed'); sim.start(); sim.update(3, EMPTY_INPUT);
    sim.state.racers.slice(1).forEach(racer => { racer.finished = true; });
    let resets = 0;
    let releaseFrames = 0;
    for (let frame = 0; frame < 60 * 180 && !sim.state.lastLapTime; frame++) {
      const player = sim.state.racers[0];
      const curve = sampleTrack(player.distance + 8).curvature;
      const steer = Math.max(-1, Math.min(1,
        -curve * player.speed * 0.88 / VEHICLES[vehicle].steering
        - player.lateral * 0.075 + player.heading * 1.3));
      if (player.driftTime > 1.3) releaseFrames = 8;
      const drift = releaseFrames === 0 && Math.abs(curve) > 0.008 && player.speed > 28 &&
        Math.abs(player.lateral) < 5 && Math.abs(steer) > 0.1;
      sim.update(1 / 60, controls({ throttle: player.speed < (track === 'storm' ? vehicle === 'gale' ? 40 : 42 : 60), brake: player.speed > (track === 'storm' ? vehicle === 'gale' ? 42 : 44 : 62), steer, drift }));
      if (releaseFrames > 0) releaseFrames--;
      resets += sim.state.events.filter(event => event.type === 'reset').length;
    }
    assert.ok(sim.state.lastLapTime > 0, `${track}/${vehicle} lap`);
    assert.equal(resets, 0, `${track}/${vehicle} reset`);
    times.set(`${track}/${vehicle}`, sim.state.lastLapTime);
  }
  assert.ok(times.get('storm/reef')! < times.get('storm/gale')!);
  assert.ok(times.get('neon/gale')! < times.get('neon/pulse')!);
  for (const track of TRACK_ORDER) {
    const values = ['tide', 'reef', 'gale', 'pulse', 'bulwark'].map(vehicle => times.get(`${track}/${vehicle}`)!);
    assert.ok(Math.max(...values) / Math.min(...values) < 1.1, `${track} clean lap spread`);
  }
});
