import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RaceSimulation } from '../src/simulation.ts';
import { isTrackId, setActiveTrack, type TrackId } from '../src/track.ts';
import { isVehicle } from '../src/vehicles.ts';
import { isDifficulty } from '../src/difficulty.ts';
import { EMPTY_INPUT, type InputState, type RaceMode, type RaceState, type VehicleId } from '../src/types.ts';
import * as THREE from 'three';
import { createWorld } from '../src/world.ts';
import type { StaticCollider } from '../src/collision.ts';

type Driver = { id: number; name: string; vehicle: VehicleId; token: string; lastSeen: number };
type Room = {
  code: string; hostToken: string; track: TrackId; mode: RaceMode; difficulty: 'easy' | 'hard' | 'hell';
  fillAI: boolean; drivers: Driver[]; simulation: RaceSimulation; started: boolean;
  inputs: Record<number, InputState>; clients: Map<string, ServerResponse>; lastTick: number; updated: number;
};
const rooms = new Map<string, Room>();
const colliderCache = new Map<TrackId, readonly StaticCollider[]>();
function collidersFor(track: TrackId): readonly StaticCollider[] {
  let colliders = colliderCache.get(track);
  if (!colliders) {
    setActiveTrack(track);
    const world = createWorld(new THREE.Scene());
    colliders = world.colliders;
    colliderCache.set(track, colliders);
    world.dispose();
  }
  return colliders;
}
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const code = () => randomBytes(3).toString('hex').toUpperCase();
const token = () => randomBytes(24).toString('hex');
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const cleanName = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 16) : '';
const validMode = (value: unknown): value is RaceMode => value === 'party' || value === 'speed';
const view = (room: Room) => ({
  code: room.code, track: room.track, mode: room.mode, difficulty: room.difficulty,
  fillAI: room.fillAI, started: room.started, drivers: room.drivers.map(({ id, name, vehicle }) => ({ id, name, vehicle })),
});
const send = (res: ServerResponse, data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
function publish(room: Room) {
  const summary = view(room);
  const state = room.started ? room.simulation.state : null;
  for (const [key, res] of room.clients) {
    if (res.destroyed) { room.clients.delete(key); continue; }
    send(res, { type: 'state', room: summary, state });
  }
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('请求内容过长');
  }
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求格式有误');
  return parsed as Record<string, unknown>;
}
function roomBy(codeValue: string) { return rooms.get(codeValue.toUpperCase()); }
function driverBy(room: Room, data: Record<string, unknown>) { return room.drivers.find(d => d.token === data.token); }
function sanitizedInput(value: unknown): InputState {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    throttle: raw.throttle === true, brake: raw.brake === true,
    steer: Math.max(-1, Math.min(1, Number.isFinite(raw.steer) ? Number(raw.steer) : 0)),
    drift: raw.drift === true, boost: raw.boost === true,
    useItem: raw.useItem === true, reset: raw.reset === true,
  };
}
function tick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - Math.max(...room.drivers.map(driver => driver.lastSeen)) > 2 * 60 * 60 * 1000) { rooms.delete(room.code); continue; }
    if (!room.started) continue;
    setActiveTrack(room.track);
    for (const driver of room.drivers) if (now - driver.lastSeen > 750) room.inputs[driver.id] = EMPTY_INPUT;
    const dt = Math.min((now - room.lastTick) / 1000, 0.05);
    room.lastTick = now;
    room.simulation.updateWithInputs(dt, room.inputs);
    // Simulation events are transient, so every tick is broadcast to every seat.
    publish(room);
  }
}

export function createLanServer() {
  const timer = setInterval(tick, 33);
  timer.unref();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/api/health') {
        const port = (server.address() && typeof server.address() === 'object') ? (server.address() as { port: number }).port : 4182;
        const lanUrls = Object.values(networkInterfaces()).flatMap(group => group ?? [])
          .filter(address => address.family === 'IPv4' && !address.internal)
          .map(address => `http://${address.address}:${port}/`);
        return json(res, 200, { ok: true, rooms: rooms.size, lanUrls });
      }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const data = await body(req);
        const name = cleanName(data.name);
        if (!name || !isVehicle(data.vehicle) || !isTrackId(data.track) ||
          !validMode(data.mode) || !isDifficulty(data.difficulty)) return json(res, 400, { error: '房间配置无效' });
        let roomCode = code();
        while (rooms.has(roomCode)) roomCode = code();
        const hostToken = token();
        setActiveTrack(data.track);
        const simulation = new RaceSimulation(undefined, data.difficulty, data.vehicle);
        simulation.setTrack(data.track);
        simulation.setMode(data.mode);
        simulation.setStaticColliders(collidersFor(data.track));
        const room: Room = {
          code: roomCode, hostToken, track: data.track, mode: data.mode,
          difficulty: data.difficulty, fillAI: data.fillAI === true,
          drivers: [{ id: 0, name, vehicle: data.vehicle, token: hostToken, lastSeen: Date.now() }],
          simulation, started: false, inputs: {}, clients: new Map(), lastTick: Date.now(), updated: Date.now(),
        };
        rooms.set(roomCode, room);
        return json(res, 200, { room: view(room), token: hostToken, playerId: 0 });
      }
      if (parts[0] === 'api' && parts[1] === 'rooms' && parts[2]) {
        const room = roomBy(parts[2]);
        if (!room) return json(res, 404, { error: '找不到房间' });
        if (req.method === 'GET' && parts[3] === 'events') {
          const driver = room.drivers.find(d => d.token === url.searchParams.get('token'));
          if (!driver) return json(res, 403, { error: '没有加入此房间' });
          driver.lastSeen = Date.now();
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          const key = driver.token;
          room.clients.get(key)?.end();
          room.clients.set(key, res);
          send(res, { type: 'state', room: view(room), state: room.started ? room.simulation.state : null });
          req.on('close', () => { if (room.clients.get(key) === res) room.clients.delete(key); });
          return;
        }
        if (req.method !== 'POST') return json(res, 405, { error: '不支持此操作' });
        const data = await body(req);
        if (parts[3] === 'join') {
          if (room.started) return json(res, 409, { error: '比赛已开始' });
          const name = cleanName(data.name);
          if (!name || !isVehicle(data.vehicle)) return json(res, 400, { error: '请选择名字和车型' });
          const seat = Array.from({ length: 6 }, (_, id) => id).find(id => !room.drivers.some(d => d.id === id));
          if (seat === undefined) return json(res, 409, { error: '房间已满' });
          const player = { id: seat, name, vehicle: data.vehicle, token: token(), lastSeen: Date.now() };
          room.drivers.push(player); room.updated = Date.now(); publish(room);
          return json(res, 200, { room: view(room), token: player.token, playerId: seat });
        }
        const driver = driverBy(room, data);
        if (!driver) return json(res, 403, { error: '没有加入此房间' });
        driver.lastSeen = Date.now();
        if (parts[3] === 'input') {
          if (room.started) room.inputs[driver.id] = sanitizedInput(data.input);
          return json(res, 200, { ok: true });
        }
        if (parts[3] === 'settings') {
          if (driver.token !== room.hostToken) return json(res, 403, { error: '只有房主可以设置房间' });
          if (room.started || typeof data.fillAI !== 'boolean') return json(res, 409, { error: '比赛开始后无法更改 AI 补位' });
          room.fillAI = data.fillAI;
          publish(room);
          return json(res, 200, { room: view(room) });
        }
        if (parts[3] === 'start') {
          if (driver.token !== room.hostToken) return json(res, 403, { error: '只有房主可以开赛' });
          if (room.started) return json(res, 409, { error: '比赛已经开始' });
          if (room.drivers.length < 2 && !room.fillAI) return json(res, 409, { error: '需要至少两名玩家，或开启 AI 补位' });
          setActiveTrack(room.track);
          room.simulation.setHumanDrivers(room.drivers);
          room.simulation.start();
          if (!room.fillAI) for (const racer of room.simulation.state.racers) {
            if (racer.human) continue;
            racer.finished = true; racer.active = false; racer.finishTime = Infinity;
          }
          room.started = true; room.updated = Date.now(); room.lastTick = Date.now(); publish(room);
          return json(res, 200, { room: view(room) });
        }
        if (parts[3] === 'leave') {
          if (!room.started) {
            room.drivers = room.drivers.filter(d => d.token !== driver.token);
            room.clients.get(driver.token)?.end(); room.clients.delete(driver.token);
            if (driver.token === room.hostToken || room.drivers.length === 0) rooms.delete(room.code);
            else publish(room);
          } else {
            room.inputs[driver.id] = EMPTY_INPUT;
            room.simulation.state.racers[driver.id].human = false;
            publish(room);
          }
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: '未知房间操作' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '不支持此操作' });
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: '路径无效' }); }
      const candidate = resolve(dist, `.${pathname}`);
      if (candidate !== dist && !candidate.startsWith(dist + sep)) return json(res, 403, { error: '路径无效' });
      let file = candidate;
      try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
      catch { file = join(dist, 'index.html'); }
      const bytes = await readFile(file);
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : '请求失败' });
    }
  });
  server.on('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4182);
  createLanServer().listen(port, '0.0.0.0', () => {
    console.log(`Coastline Rush LAN server: http://0.0.0.0:${port}`);
  });
}
