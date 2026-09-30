import type { Difficulty, InputState, RaceMode, RaceState, VehicleId } from './types';
import type { TrackId } from './track';

export interface RoomView {
  code: string; track: TrackId; mode: RaceMode; difficulty: Difficulty; fillAI: boolean;
  started: boolean; drivers: { id: number; name: string; vehicle: VehicleId }[];
}
type JoinResponse = { room: RoomView; token: string; playerId: number };
type ServerMessage = { type: 'state'; room: RoomView; state: RaceState | null };

export class LanClient {
  room: RoomView | null = null;
  state: RaceState | null = null;
  playerId = 0;
  onChange: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private token = '';
  private stream: EventSource | null = null;
  private input: InputState = { throttle: false, brake: false, steer: 0, drift: false, boost: false, useItem: false, reset: false };
  private inputTimer = 0;
  private sending = false;
  private eventSerial = 0;

  get connected() { return !!this.room && !!this.token; }
  get host() { return this.connected && this.playerId === 0; }
  get code() { return this.room?.code ?? ''; }
  get events() { return this.state?.events ?? []; }
  get serial() { return this.eventSerial; }

  private async post<T>(path: string, data: object): Promise<T> {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || `网络错误 ${response.status}`);
    return result;
  }

  async create(config: { name: string; vehicle: VehicleId; track: TrackId; mode: RaceMode; difficulty: Difficulty; fillAI: boolean }) {
    this.attach(await this.post<JoinResponse>('/api/rooms', config));
  }
  async join(roomCode: string, name: string, vehicle: VehicleId) {
    this.attach(await this.post<JoinResponse>(`/api/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/join`, { name, vehicle }));
  }
  async start() {
    if (!this.room || !this.host) return;
    await this.post(`/api/rooms/${this.room.code}/start`, { token: this.token });
  }
  async setFillAI(fillAI: boolean) {
    if (!this.room || !this.host) return;
    await this.post(`/api/rooms/${this.room.code}/settings`, { token: this.token, fillAI });
  }
  private attach(joined: JoinResponse) {
    this.close(false);
    this.room = joined.room; this.playerId = joined.playerId; this.token = joined.token;
    sessionStorage.setItem(`coastline-room-${joined.room.code}`, JSON.stringify({ token: joined.token, playerId: joined.playerId }));
    this.stream = new EventSource(`/api/rooms/${joined.room.code}/events?token=${encodeURIComponent(joined.token)}`);
    this.stream.onmessage = event => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type !== 'state') return;
      this.room = message.room;
      this.state = message.state;
      this.eventSerial++;
      if (this.state) {
        const racer = this.state.racers[this.playerId];
        for (const entry of this.state.racers) entry.isPlayer = entry.id === this.playerId;
        this.state.vehicle = racer?.vehicle ?? this.state.vehicle;
        this.state.hits = racer?.hits ?? 0;
        this.state.drifts = racer?.drifts ?? 0;
        this.state.bestLap = racer?.bestLap ?? 0;
        this.state.lastLapTime = racer?.lastLapTime ?? 0;
      }
      this.onChange?.();
    };
    this.stream.onerror = () => this.onError?.('联机连接中断，正在重连…');
    this.inputTimer = window.setInterval(() => { void this.flushInput(); }, 50);
    this.onChange?.();
  }
  restore(roomCode: string): boolean {
    const raw = sessionStorage.getItem(`coastline-room-${roomCode}`);
    if (!raw) return false;
    try {
      const saved = JSON.parse(raw) as { token: string; playerId: number };
      if (!saved.token || !Number.isInteger(saved.playerId)) return false;
      this.attach({ room: { code: roomCode, track: 'bay', mode: 'party', difficulty: 'easy', fillAI: false, started: false, drivers: [] }, token: saved.token, playerId: saved.playerId });
      return true;
    } catch { return false; }
  }
  setInput(input: InputState) {
    this.input = { ...input, useItem: this.input.useItem || input.useItem, reset: this.input.reset || input.reset };
  }
  private async flushInput() {
    if (!this.room || this.sending || !this.room.started) return;
    const input = this.input;
    this.input = { ...input, useItem: false, reset: false };
    this.sending = true;
    try { await this.post(`/api/rooms/${this.room.code}/input`, { token: this.token, input }); }
    catch (error) {
      this.input.useItem ||= input.useItem; this.input.reset ||= input.reset;
      this.onError?.(error instanceof Error ? error.message : '发送驾驶操作失败');
    } finally { this.sending = false; }
  }
  async leave() {
    const room = this.room; const token = this.token;
    this.close(true);
    if (room && token) try { await this.post(`/api/rooms/${room.code}/leave`, { token }); } catch { /* local exit still succeeds */ }
  }
  close(removeStorage = false) {
    if (removeStorage && this.room) sessionStorage.removeItem(`coastline-room-${this.room.code}`);
    this.stream?.close(); this.stream = null;
    window.clearInterval(this.inputTimer);
    this.room = null; this.state = null; this.token = '';
    this.onChange?.();
  }
}
