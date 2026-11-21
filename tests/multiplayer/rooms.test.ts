import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Room } from 'colyseus.js';
import colyseus from 'colyseus';
import { C2S, LobbyState, S2C, Snapshot, InteractionResult } from '@itl/shared';
import { createGameServer } from '../../apps/server/src/server';
import type { GameSimulation } from '../../apps/server/src/simulation/game';

const PORT = 25670 + Math.floor(Math.random() * 500);
const url = `ws://localhost:${PORT}`;
let server: Awaited<ReturnType<typeof createGameServer>>;

beforeAll(async () => { server = await createGameServer(PORT, 'none'); });
afterAll(async () => { await server.gracefullyShutdown(false).catch(() => undefined); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(25); }
  throw new Error('timeout');
}
function track(room: Room) {
  const st: { lobby: LobbyState | null; snap: Snapshot | null; results: InteractionResult[] } = { lobby: null, snap: null, results: [] };
  room.onMessage(S2C.lobby, (l: LobbyState) => (st.lobby = l));
  room.onMessage(S2C.snapshot, (s: Snapshot) => (st.snap = s));
  room.onMessage(S2C.interactionResult, (r: InteractionResult) => st.results.push(r));
  room.onMessage('*', () => undefined);
  return st;
}
const simOf = (roomId: string) => (colyseus.matchMaker.getRoomById(roomId) as unknown as { sim: GameSimulation }).sim;

describe('lobby, 4-player room and authority over the network', () => {
  it('create → join by code → full room → host-only start → synchronized snapshots → pickup race', async () => {
    const host = await new Client(url).create('hunt', { name: 'Host' });
    const hs = track(host);
    const code = host.roomId;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const others = await Promise.all([1, 2, 3].map((i) => new Client(url).joinById(code, { name: `P${i}` })));
    const os = others.map(track);
    await until(() => hs.lobby?.players.length === 4);
    expect(hs.lobby!.players.filter((p) => p.host)).toHaveLength(1);
    expect(new Set(hs.lobby!.players.map((p) => p.character)).size).toBe(4);
    await expect(new Client(url).joinById(code, { name: 'Fifth' })).rejects.toBeTruthy(); // room full

    others[0].send(C2S.start, {}); // non-host cannot start
    host.send(C2S.start, {}); // not everyone ready yet
    await wait(200);
    expect(hs.lobby!.phase).toBe('lobby');
    others.forEach((r) => r.send(C2S.ready, { ready: true }));
    await until(() => hs.lobby?.players.every((p) => p.host || p.ready));
    host.send(C2S.start, {});
    await until(() => hs.lobby?.phase === 'playing');
    await until(() => os.every((s) => s.snap) && hs.snap);
    expect(hs.snap!.players).toHaveLength(4);
    await expect(new Client(url).joinById(code, { name: 'Late' })).rejects.toBeTruthy(); // no mid-match join

    // Scenario D over the network: two players press E on the same keycard
    const sim = simOf(code);
    const key = [...sim.items.values()].find((i) => i.kind === 'keycard')!;
    for (const r of [host, others[0]]) { const p = sim.players.get(r.sessionId)!; p.x = key.x; p.z = key.z; }
    host.send(C2S.interact, { requestId: 'a', entityId: key.id, action: 'pickup' });
    others[0].send(C2S.interact, { requestId: 'b', entityId: key.id, action: 'pickup' });
    await until(() => hs.results.length && os[0].results.length);
    const oks = [hs.results[0].ok, os[0].results[0].ok];
    expect(oks.filter(Boolean)).toHaveLength(1);
    await until(() => os.every((s) => !s.snap!.items.some((i) => i.id === key.id)));

    // client cannot set its own state: unknown / forged messages are ignored
    host.send('set_health', { hp: 9999 });
    host.send(C2S.input, { seq: 1e9, mx: 100, mz: 100, yaw: 0, pitch: 0, run: true, crouch: false, interactHeld: false, flashlight: false });
    await wait(100);
    expect(sim.players.get(host.sessionId)!.hp).toBeLessThanOrEqual(100);

    await Promise.all([host, ...others].map((r) => r.leave()));
  });

  it('host migration in lobby and room independence', async () => {
    const a = await new Client(url).create('hunt', { name: 'A' });
    const b = await new Client(url).joinById(a.roomId, { name: 'B' });
    const bs = track(b);
    const c = await new Client(url).create('hunt', { name: 'C' }); // separate room
    expect(c.roomId).not.toBe(a.roomId);
    await until(() => bs.lobby?.players.length === 2);
    await a.leave();
    await until(() => bs.lobby?.players.length === 1 && bs.lobby.players[0].host);
    await Promise.all([b.leave(), c.leave()]);
  });

  it('reconnects within 60 s and keeps the same character state (Bug 6)', async () => {
    const client = new Client(url);
    const host = await client.create('hunt', { name: 'Solo' });
    const hs = track(host);
    const mate = await new Client(url).joinById(host.roomId, { name: 'Mate' });
    track(mate);
    mate.send(C2S.ready, { ready: true });
    await until(() => hs.lobby?.players.find((p) => !p.host)?.ready);
    host.send(C2S.start, {});
    await until(() => hs.snap);
    const sim = simOf(host.roomId);
    sim.players.get(host.sessionId)!.inventory[0] = 'fuse';
    const token = host.reconnectionToken;
    const sid = host.sessionId;
    (host.connection as unknown as { transport: { ws: { close: (c?: number) => void } } }).transport.ws.close(4001); // abnormal drop
    await until(() => !sim.players.get(sid)!.connected);
    const again = await new Client(url).reconnect(token);
    const as = track(again);
    expect(again.sessionId).toBe(sid);
    await until(() => as.snap);
    expect(as.snap!.self.inventory[0]).toBe('fuse');
    expect(sim.players.get(sid)!.connected).toBe(true);
    await Promise.all([again.leave(), mate.leave()]);
  });

  it('match end → return to lobby → new match without restarting the server', async () => {
    const host = await new Client(url).create('hunt', { name: 'Solo' });
    const hs = track(host);
    let result = false;
    host.onMessage(S2C.result, () => (result = true));
    host.send(C2S.start, {});
    await until(() => hs.snap);
    const sim1 = simOf(host.roomId);
    sim1.exitOpen = true; sim1.finalHunt = true; sim1.finalLeft = 0.05; sim1.protocolDone = true;
    await until(() => result, 3000);
    await until(() => hs.lobby?.phase === 'ended');
    host.send(C2S.returnToLobby, {});
    await until(() => hs.lobby?.phase === 'lobby');
    host.send(C2S.start, {});
    await until(() => hs.lobby?.phase === 'playing');
    const sim2 = simOf(host.roomId);
    expect(sim2).not.toBe(sim1);
    expect(sim2.result).toBeNull();
    await host.leave();
  });
});
