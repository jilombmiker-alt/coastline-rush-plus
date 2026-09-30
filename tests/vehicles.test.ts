import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoxVolume, intersectVolumes, racerVolume, type StaticCollider } from '../src/collision';
import { DIFFICULTY_ORDER } from '../src/difficulty';
import { RaceSimulation } from '../src/simulation';
import { sampleTrack } from '../src/track';
import { EMPTY_INPUT, type Difficulty, type InputState, type VehicleId } from '../src/types';
import { DEFAULT_VEHICLE, VEHICLES, VEHICLE_ORDER, isVehicle } from '../src/vehicles';

const controls = (changes: Partial<InputState> = {}): InputState => ({ ...EMPTY_INPUT, ...changes });
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function running(vehicle: VehicleId, difficulty: Difficulty = 'easy', isolated = true) {
  const simulation = new RaceSimulation(42, difficulty, vehicle);
  simulation.start();
  simulation.update(3, EMPTY_INPUT);
  if (isolated) {
    for (const racer of simulation.state.racers.slice(1)) racer.finished = true;
    for (const pickup of simulation.state.pickups) pickup.cooldown = 1000;
    simulation.state.racers[0].distance = 25;
  }
  return simulation;
}

/** Repeat the same empty road segment so these measurements isolate the actual motor. */
function straight(simulation: RaceSimulation, seconds: number, input: InputState) {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    Object.assign(simulation.state.racers[0], { distance: 25, lateral: 0, heading: 0 });
    simulation.update(1 / 60, input);
  }
}

test('five immutable vehicle profiles validate external values and retain the baseline balanced tune', () => {
  assert.equal(DEFAULT_VEHICLE, 'tide');
  assert.deepEqual(VEHICLE_ORDER, ['tide', 'reef', 'gale', 'pulse', 'bulwark']);
  assert.deepEqual(VEHICLE_ORDER.map(id => VEHICLES[id].name), ['浪潮07', '珊瑚12', '海风21', '脉冲33', '礁盾45']);
  assert.ok(Object.isFrozen(VEHICLES));
  for (const vehicle of VEHICLE_ORDER) {
    assert.ok(isVehicle(vehicle));
    assert.ok(Object.isFrozen(VEHICLES[vehicle]));
  }
  for (const invalid of [undefined, null, '', 'TIDE', '__proto__', 0, {}, []]) {
    assert.equal(isVehicle(invalid), false);
    assert.equal(new RaceSimulation(42, 'hard', invalid as VehicleId).getVehicle(), 'tide');
  }
  const balanced = VEHICLES.tide;
  assert.deepEqual([balanced.baseSpeed, balanced.acceleration, balanced.boostAcceleration,
    balanced.steering, balanced.driftSteering, balanced.grip, balanced.driftGrip,
    balanced.boostSpeedGain, balanced.boostEnergyCost], [52, 22, 38, 1.45, 1.35, 3.7, 1.9, 20, 30]);
});

test('selecting a vehicle changes the player and survives difficulty changes, restart and menu return', () => {
  const simulation = new RaceSimulation(42, 'hard');
  const original = simulation.state;
  assert.equal(simulation.setVehicle('__proto__' as VehicleId), false);
  assert.equal(simulation.state, original);
  for (const vehicle of VEHICLE_ORDER) {
    assert.equal(simulation.setVehicle(vehicle), true);
    assert.equal(simulation.getVehicle(), vehicle);
    assert.equal(simulation.state.vehicle, vehicle);
    assert.equal(simulation.state.racers[0].name, VEHICLES[vehicle].name);
    assert.equal(simulation.state.racers[0].color, VEHICLES[vehicle].color);
    simulation.setDifficulty('hell');
    assert.equal(simulation.state.vehicle, vehicle);
    simulation.start();
    simulation.update(3.5, controls({ throttle: true }));
    simulation.pause();
    simulation.start();
    assert.equal(simulation.state.vehicle, vehicle);
    assert.equal(simulation.state.time, 0);
    assert.equal(simulation.state.racers[0].distance, 0);
    simulation.returnToMenu();
    assert.equal(simulation.state.vehicle, vehicle);
    assert.equal(simulation.state.difficulty, 'hell');
  }
});

test('vehicle changes are rejected without replacing state during every active or completed phase', () => {
  const simulation = new RaceSimulation(42, 'easy', 'reef');
  simulation.start();
  for (const phase of ['countdown', 'racing', 'paused', 'finished'] as const) {
    simulation.state.phase = phase;
    const state = simulation.state;
    assert.equal(simulation.setVehicle('gale'), false);
    assert.equal(simulation.state, state);
    assert.equal(simulation.getVehicle(), 'reef');
    assert.equal(simulation.state.vehicle, 'reef');
  }
});

test('the motor produces distinct acceleration and sustained speed, with a shared safety cap', () => {
  const measurements = VEHICLE_ORDER.map(vehicle => {
    const simulation = running(vehicle);
    const player = simulation.state.racers[0];
    straight(simulation, 1, controls({ throttle: true }));
    const launch = player.speed;
    straight(simulation, 5, controls({ throttle: true }));
    const cruise = player.speed;
    player.energy = 100;
    straight(simulation, 2, controls({ throttle: true, boost: true }));
    const boosted = player.speed;
    assert.ok(boosted > cruise + 15);
    assert.ok(player.speed <= 84);
    player.speed = 100;
    simulation.update(1 / 90, controls({ throttle: true }));
    assert.equal(player.speed, 84);
    return { launch, cruise, boosted };
  });
  const [tide, reef, gale] = measurements;
  assert.ok(reef.launch > tide.launch + 1.9);
  assert.ok(tide.launch > gale.launch + 2.9);
  assert.ok(tide.cruise > reef.cruise + 2);
  assert.ok(gale.cruise > tide.cruise + 3);
  assert.ok(tide.boosted > reef.boosted + 3);
  assert.ok(gale.boosted > tide.boosted + 2);
  assert.ok(tide.cruise > 57 && tide.cruise < 58);
});

test('reef turns most sharply and gale turns least sharply under the same normal and drift inputs', () => {
  for (const drift of [false, true]) {
    const lateral = VEHICLE_ORDER.map(vehicle => {
      const simulation = running(vehicle);
      simulation.state.racers[0].speed = 35;
      for (let frame = 0; frame < 18; frame++) {
        simulation.update(1 / 60, controls({ steer: 0.7, drift }));
      }
      return simulation.state.racers[0].lateral;
    });
    assert.ok(lateral[1] > lateral[0] + 0.07);
    assert.ok(lateral[0] > lateral[2] + 0.04);
  }
});

test('nitro efficiency changes real fuel use, still exhausts, and holding an empty tank cannot restart boost', () => {
  for (const vehicle of VEHICLE_ORDER) {
    const simulation = running(vehicle);
    const player = simulation.state.racers[0];
    player.speed = 30;
    player.energy = 70;
    straight(simulation, 0.5, controls({ throttle: true, boost: true }));
    near(player.energy, 70 - VEHICLES[vehicle].boostEnergyCost * 0.5);
    straight(simulation, 4, controls({ throttle: true, boost: true }));
    assert.equal(player.boostTime, 0);
    straight(simulation, 1, controls({ throttle: true, boost: true }));
    assert.equal(player.boostTime, 0, 'held input must stay locked even after passive recharge');
    simulation.update(1 / 60, controls({ throttle: true }));
    simulation.update(1 / 60, controls({ throttle: true, boost: true }));
    assert.ok(player.boostTime > 0, 'releasing and pressing again can spend recovered energy');
    assert.ok(player.energy >= 0 && player.energy <= 100);
  }
});

test('vehicle selection preserves the visible collision world and no vehicle can tunnel through a thin wall', () => {
  const track = sampleTrack(45);
  const wall: StaticCollider = { id: 'vehicle-wall', kind: 'barrier',
    ...createBoxVolume(track.x, track.y + 1.5, track.z, 20, 1.5, 0.08, track.heading) };
  const simulation = new RaceSimulation(42);
  simulation.setStaticColliders([wall]);
  for (const vehicle of VEHICLE_ORDER) {
    simulation.returnToMenu();
    simulation.setVehicle(vehicle);
    simulation.start();
    simulation.update(3, EMPTY_INPUT);
    for (const racer of simulation.state.racers.slice(1)) racer.finished = true;
    for (const pickup of simulation.state.pickups) pickup.cooldown = 100;
    const player = simulation.state.racers[0];
    Object.assign(player, { distance: 25, speed: 84, energy: 100 });
    simulation.update(0.5, controls({ throttle: true, boost: true }));
    assert.ok(player.distance > 25 && player.distance < 43);
    assert.ok((intersectVolumes(racerVolume(player), wall)?.depth ?? 0) < 0.04);
    assert.ok(simulation.state.events.some(event => event.type === 'collision'));
  }
});

test('all vehicles can complete three laps on every difficulty with finite state and ordinary road following', () => {
  for (const vehicle of VEHICLE_ORDER) {
    for (const difficulty of DIFFICULTY_ORDER) {
      const simulation = running(vehicle, difficulty, false);
      let resets = 0;
      for (let frame = 0; frame < 60 * 135 && simulation.state.phase === 'racing'; frame++) {
        const player = simulation.state.racers[0];
        const curve = sampleTrack(player.distance + 3).curvature;
        const steer = Math.max(-1, Math.min(1, -curve * player.speed * 0.88 / VEHICLES[vehicle].steering
          - player.lateral * 0.075 + player.heading * 1.3));
        simulation.update(1 / 60, controls({ throttle: true, steer }));
        resets += simulation.state.events.filter(event => event.type === 'reset' && event.racer === 0).length;
        for (const racer of simulation.state.racers) {
          assert.ok([racer.distance, racer.lateral, racer.heading, racer.speed, racer.energy].every(Number.isFinite));
          assert.ok(racer.speed >= -8 && racer.speed <= 84);
          assert.ok(racer.energy >= 0 && racer.energy <= 100);
        }
      }
      assert.equal(simulation.state.phase, 'finished', `${vehicle}/${difficulty} must finish`);
      assert.equal(simulation.state.racers[0].lap, 3);
      assert.equal(resets, 0, `${vehicle}/${difficulty} must remain controllable`);
      assert.equal(new Set(simulation.state.racers.map(racer => racer.rank)).size, 6);
    }
  }
});
