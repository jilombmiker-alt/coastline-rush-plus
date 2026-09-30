import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createLanServer } from '../server/index.ts';
import type { RaceState } from '../src/types.ts';

test('two LAN seats share an authoritative race and the host controls AI fill', async () => {
  const server = createLanServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, data: object) => {
    const response = await fetch(root + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() as Record<string, any> };
  };
  const snapshot = async (room: string, token: string): Promise<RaceState> => {
    const response = await fetch(`${root}/api/rooms/${room}/events?token=${token}`);
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    await reader.cancel();
    const match = new TextDecoder().decode(chunk.value).match(/data: (.*)\n\n/);
    assert.ok(match);
    return (JSON.parse(match[1]) as { state: RaceState }).state;
  };
  try {
    const created = await post('/api/rooms', { name: '房主', vehicle: 'pulse', track: 'storm', mode: 'party', difficulty: 'easy', fillAI: false });
    assert.equal(created.status, 200);
    const room = created.data.room.code as string;
    const hostToken = created.data.token as string;
    assert.equal((await post(`/api/rooms/${room}/start`, { token: hostToken })).status, 409);
    const joined = await post(`/api/rooms/${room}/join`, { name: '好友', vehicle: 'reef' });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.playerId, 1);
    const guestToken = joined.data.token as string;
    assert.equal((await post(`/api/rooms/${room}/start`, { token: guestToken })).status, 403);
    assert.equal((await post(`/api/rooms/${room}/settings`, { token: guestToken, fillAI: true })).status, 403);
    assert.equal((await post(`/api/rooms/${room}/settings`, { token: hostToken, fillAI: true })).data.room.fillAI, true);
    assert.equal((await post(`/api/rooms/${room}/settings`, { token: hostToken, fillAI: false })).data.room.fillAI, false);
    assert.equal((await post(`/api/rooms/${room}/start`, { token: hostToken })).status, 200);
    const initial = await snapshot(room, hostToken);
    assert.equal(initial.track, 'storm');
    assert.equal(initial.racers.filter(racer => racer.active !== false).length, 2);
    assert.equal(initial.racers[0].vehicle, 'pulse');
    assert.equal(initial.racers[1].vehicle, 'reef');
    await new Promise(resolve => setTimeout(resolve, 3150));
    for (let i = 0; i < 8; i++) {
      await Promise.all([
        post(`/api/rooms/${room}/input`, { token: hostToken, input: { throttle: true, steer: 1 } }),
        post(`/api/rooms/${room}/input`, { token: guestToken, input: { throttle: true, steer: -1 } }),
      ]);
      await new Promise(resolve => setTimeout(resolve, 45));
    }
    const hostView = await snapshot(room, hostToken);
    const guestView = await snapshot(room, guestToken);
    assert.ok(hostView.racers[0].distance > initial.racers[0].distance + 1);
    assert.ok(guestView.racers[1].distance > initial.racers[1].distance + 1);
    assert.ok(hostView.racers[0].lateral > 0, 'right steers right');
    assert.ok(guestView.racers[1].lateral < initial.racers[1].lateral, 'left steers left');
    assert.ok(Math.abs(hostView.racers[0].distance - guestView.racers[0].distance) < 2);

    const aiRoom = await post('/api/rooms', { name: '独自练习', vehicle: 'tide', track: 'bay', mode: 'speed', difficulty: 'easy', fillAI: true });
    assert.equal((await post(`/api/rooms/${aiRoom.data.room.code}/start`, { token: aiRoom.data.token })).status, 200);
    const aiState = await snapshot(aiRoom.data.room.code, aiRoom.data.token);
    assert.equal(aiState.racers.filter(racer => racer.active !== false).length, 6);
    assert.equal(aiState.pickups.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
