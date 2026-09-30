import { RaceSimulation } from '../src/simulation';
import { TRACK_ORDER, TRACK_LENGTH } from '../src/track';
import { EMPTY_INPUT } from '../src/types';

for (const track of TRACK_ORDER) {
  const sim = new RaceSimulation(42);
  sim.setTrack(track);
  sim.setMode('speed');
  sim.start(); sim.update(3, EMPTY_INPUT);
  sim.state.racers.slice(1).forEach(racer => { racer.finished = true; });
  let resets = 0, maxLateral = 0, roadTime = 0;
  for (let frame = 0; frame < 60 * 120 && !sim.state.lastLapTime; frame++) {
    sim.update(1 / 60, { ...EMPTY_INPUT, throttle: true });
    const player = sim.state.racers[0];
    resets += sim.state.events.filter(event => event.type === 'reset').length;
    maxLateral = Math.max(maxLateral, Math.abs(player.lateral));
    if (Math.abs(player.lateral) < 9.5) roadTime++;
  }
  const player = sim.state.racers[0];
  console.log(track, { length: TRACK_LENGTH.toFixed(0), lapTime: sim.state.lastLapTime.toFixed(2),
    progress: player.distance.toFixed(0), resets, maxLateral: maxLateral.toFixed(2),
    roadFraction: (roadTime / (sim.state.time * 60)).toFixed(2) });
}
