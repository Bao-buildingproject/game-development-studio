import { randomInt, randomUUID } from 'node:crypto';
import { Room } from '../colyseus';
import type { Client } from '../colyseus';
import {
  C2S, CHARACTERS, CharacterId, Difficulty, InputMsg, InteractMsg, LobbyPlayer, LobbySettingsMsg, LobbyState, MAX_PLAYERS, ReadyMsg,
  RECONNECT_SECONDS, S2C, SNAPSHOT_EVERY, SlotMsg, TICK_RATE,
} from '@itl/shared';
import { GameSimulation } from '../simulation/game';
import { sanitizeName } from '../security/sanitize';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function makeRoomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

const joinAttempts = new Map<string, { n: number; t: number }>();

/** One independent match per room – no globals shared between rooms (GDD §47). */
export class HuntRoom extends Room {
  maxClients = MAX_PLAYERS;
  private lobby = new Map<string, LobbyPlayer>();
  private order: string[] = [];
  private phase: LobbyState['phase'] = 'lobby';
  private difficulty: Difficulty = 'standard';
  private sim: GameSimulation | null = null;
  private resultSent = false;

  onCreate() {
    this.roomId = makeRoomCode();
    this.setPrivate(true); // never listed – join by code only
    this.onMessage(C2S.ready, (c, m: ReadyMsg) => this.onReady(c, m));
    this.onMessage(C2S.lobbySettings, (c, m: LobbySettingsMsg) => {
      if (!this.isHost(c) || this.phase !== 'lobby') return;
      if (m?.difficulty === 'standard' || m?.difficulty === 'hardcore') this.difficulty = m.difficulty;
      this.pushLobby();
    });
    this.onMessage(C2S.start, (c) => this.onStart(c));
    this.onMessage(C2S.input, (c, m: InputMsg) => this.sim?.queueInput(c.sessionId, m));
    this.onMessage(C2S.interact, (c, m: InteractMsg) => { if (this.sim) c.send(S2C.interactionResult, this.sim.handleInteract(c.sessionId, m)); });
    this.onMessage(C2S.useItem, (c, m: SlotMsg) => { if (this.sim) c.send(S2C.interactionResult, this.sim.handleUse(c.sessionId, m)); });
    this.onMessage(C2S.dropItem, (c, m: SlotMsg) => { if (this.sim) c.send(S2C.interactionResult, this.sim.handleDrop(c.sessionId, m)); });
    this.onMessage(C2S.returnToLobby, (c) => {
      if (!this.isHost(c) || this.phase !== 'ended') return;
      this.resetToLobby();
    });
    this.onMessage('*', () => { /* unknown messages ignored */ });
    this.setSimulationInterval(() => this.update(), 1000 / TICK_RATE);
  }

  onAuth(client: Client, _options: unknown, request?: { socket?: { remoteAddress?: string } }) {
    const ip = request?.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const a = joinAttempts.get(ip) ?? { n: 0, t: now };
    if (now - a.t > 60_000) { a.n = 0; a.t = now; }
    a.n++;
    joinAttempts.set(ip, a);
    if (a.n > 30) throw new Error('Too many join attempts – slow down');
    if (this.phase !== 'lobby') throw new Error('Match already in progress');
    void client;
    return true;
  }

  onJoin(client: Client, options: { name?: string; character?: CharacterId }) {
    const taken = new Set([...this.lobby.values()].map((p) => p.character));
    const wanted = CHARACTERS.find((c) => c.id === options?.character && !taken.has(c.id));
    const character = (wanted ?? CHARACTERS.find((c) => !taken.has(c.id)) ?? CHARACTERS[0]).id;
    this.lobby.set(client.sessionId, {
      id: client.sessionId, name: sanitizeName(options?.name) || `Responder ${this.lobby.size + 1}`, character,
      ready: false, host: this.lobby.size === 0, connected: true,
    });
    this.order.push(client.sessionId);
    client.send(S2C.welcome, { sessionId: client.sessionId, code: this.roomId });
    this.pushLobby();
  }

  async onLeave(client: Client, consented: boolean) {
    const lp = this.lobby.get(client.sessionId);
    if (!lp) return;
    if (this.phase === 'lobby' || this.phase === 'ended' || !this.sim) {
      this.removeFromLobby(client.sessionId);
      return;
    }
    // in match: keep the seat for a while (Bug 6). Identity = sessionId, not the socket.
    lp.connected = false;
    this.sim.setConnected(client.sessionId, false);
    this.pushLobby();
    if (consented) { this.sim.removePlayer(client.sessionId); this.removeFromLobby(client.sessionId); return; }
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
      lp.connected = true;
      this.sim?.setConnected(client.sessionId, true);
      client.send(S2C.welcome, { sessionId: client.sessionId, code: this.roomId, resumed: true });
      this.pushLobby();
      const snap = this.sim?.snapshotFor(client.sessionId);
      if (snap) client.send(S2C.snapshot, snap); // full state on reconnect
    } catch {
      this.sim?.removePlayer(client.sessionId);
      this.removeFromLobby(client.sessionId);
    }
  }

  onDispose() {
    this.sim = null; // listeners & interval are released by Colyseus with the room
  }

  private removeFromLobby(id: string) {
    const wasHost = this.lobby.get(id)?.host;
    this.lobby.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (wasHost && this.order.length) this.lobby.get(this.order[0])!.host = true; // host migration (Bug 7)
    this.pushLobby();
  }

  private isHost(c: Client) {
    return !!this.lobby.get(c.sessionId)?.host;
  }

  private onReady(c: Client, m: ReadyMsg) {
    const p = this.lobby.get(c.sessionId);
    if (!p || this.phase !== 'lobby') return;
    if (typeof m?.ready === 'boolean') p.ready = m.ready;
    if (m?.name !== undefined) p.name = sanitizeName(m.name) || p.name;
    if (m?.character && CHARACTERS.some((x) => x.id === m.character) && ![...this.lobby.values()].some((o) => o !== p && o.character === m.character)) p.character = m.character;
    this.pushLobby();
  }

  private onStart(c: Client) {
    if (!this.isHost(c) || this.phase !== 'lobby') return;
    const others = [...this.lobby.values()].filter((p) => !p.host);
    if (others.some((p) => !p.ready)) {
      c.send(S2C.event, { id: randomUUID(), kind: 'notice', text: 'Everyone else must be Ready before starting.' });
      return;
    }
    this.phase = 'playing';
    this.resultSent = false;
    this.lock();
    const seed = randomInt(1, 2 ** 31 - 1);
    this.sim = new GameSimulation({
      seed,
      difficulty: this.difficulty,
      players: this.order.map((id) => ({ id, name: this.lobby.get(id)!.name, character: this.lobby.get(id)!.character })),
    });
    console.log(`[room ${this.roomId}] match start seed=${this.sim.seed} players=${this.order.length}`);
    this.pushLobby();
  }

  private resetToLobby() {
    this.sim = null;
    this.phase = 'lobby';
    for (const p of this.lobby.values()) p.ready = false;
    this.unlock();
    this.pushLobby();
  }

  private update() {
    const sim = this.sim;
    if (!sim || this.phase !== 'playing') return;
    sim.step();
    for (const o of sim.drainOutbox()) {
      if (o.to === 'all') this.broadcast(S2C.event, o.msg);
      else this.clients.find((c) => c.sessionId === o.to)?.send(S2C.event, o.msg);
    }
    if (process.env.DEBUG_AI) for (const l of sim.telemetryLog.splice(0)) console.log(`[${this.roomId}] ${l}`);
    if (sim.tick % SNAPSHOT_EVERY === 0) {
      for (const c of this.clients) {
        const snap = sim.snapshotFor(c.sessionId);
        if (snap) c.send(S2C.snapshot, snap);
      }
    }
    if (sim.result && !this.resultSent) {
      this.resultSent = true;
      this.phase = 'ended';
      this.broadcast(S2C.result, sim.result);
      console.log(`[room ${this.roomId}] match end ${sim.result.outcome}`);
      this.pushLobby();
    }
  }

  private pushLobby() {
    const state: LobbyState = {
      code: this.roomId,
      phase: this.phase,
      players: this.order.map((id) => this.lobby.get(id)!).filter(Boolean),
      difficulty: this.difficulty,
      map: 'SYNAPSE Facility – B4',
      maxPlayers: MAX_PLAYERS,
    };
    this.broadcast(S2C.lobby, state);
  }
}
