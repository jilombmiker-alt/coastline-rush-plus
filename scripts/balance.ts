import { RaceSimulation } from '../src/simulation';
import { VEHICLES, VEHICLE_ORDER } from '../src/vehicles';
import { TRACK_ORDER, TRACKS, sampleTrack } from '../src/track';
import { EMPTY_INPUT } from '../src/types';

const enableDrift = process.env.DRIFT !== '0';

// Deterministic clean-road comparison, not a prediction of human or item-race results.
for (const track of TRACK_ORDER) {
  for (const vehicle of VEHICLE_ORDER) {
    const sim = new RaceSimulation(42, 'easy', vehicle);
    sim.setTrack(track);
    sim.setMode('speed');
    sim.start();
    sim.update(3, EMPTY_INPUT);
    sim.state.racers.slice(1).forEach(racer => { racer.finished = true; });
    let resets = 0;
    let maxLateral = 0;
    let releaseFrames = 0;
    for (let frame = 0; frame < 60 * 180 && !sim.state.lastLapTime; frame++) {
      const player = sim.state.racers[0];
      const curve = sampleTrack(player.distance + 8).curvature;
      const steer = Math.max(-1, Math.min(1,
        -curve * player.speed * 0.88 / VEHICLES[vehicle].steering
        - player.lateral * 0.075 + player.heading * 1.3));
      if (player.driftTime > 1.3) releaseFrames = 8;
      const drift = enableDrift && releaseFrames === 0 && Math.abs(curve) > 0.008 && player.speed > 28 &&
        Math.abs(player.lateral) < 5 && Math.abs(steer) > 0.1;
      sim.update(1 / 60, { ...EMPTY_INPUT, throttle: player.speed < (track === 'storm' ? vehicle === 'gale' ? 40 : 42 : 60), brake: player.speed > (track === 'storm' ? vehicle === 'gale' ? 42 : 44 : 62), steer, drift });
      if (releaseFrames > 0) releaseFrames--;
      resets += sim.state.events.filter(event => event.type === 'reset').length;
      maxLateral = Math.max(maxLateral, Math.abs(player.lateral));
    }
    console.log(`${track},${TRACKS[track].name},${vehicle},${VEHICLES[vehicle].name},${sim.state.lastLapTime.toFixed(2)},${sim.state.drifts},${resets},${maxLateral.toFixed(2)}`);
  }
}
