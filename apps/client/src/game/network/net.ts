import { Client, Room } from 'colyseus.js';
import {
  C2S, CharacterId, Difficulty, GameEvent, InputMsg, InteractionResult, LobbyState, MatchResult, RECONNECT_SECONDS, S2C, Snapshot,
} from '@itl/shared';
import { useUI } from '../../state';

type Listener<T> = (v: T) => void;

/** Thin client-side network layer. The client only sends intents; the server decides outcomes (GDD §21). */
class Net {
  private client: Client | null = null;
  room: Room | null = null;
  snapshots: { at: number; s: Snapshot }[] = [];
  latest: Snapshot | null = null;
  private eventListeners = new Set<Listener<GameEvent>>();
  private snapListeners = new Set<Listener<Snapshot>>();
  private pending = new Map<string, (r: InteractionResult) => void>();
  private seenEvents = new Set<string>();
  private reqSeq = 0;
  private wantLeave = false;

  private endpoint() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  }

  private bind(room: Room) {
    this.room = room;
    this.wantLeave = false;
    try { sessionStorage.setItem('itlearns.reconnect', room.reconnectionToken); } catch { /* ignore */ }
    const ui = useUI.getState();
    ui.set({ conn: 'connected', sessionId: room.sessionId, error: null });
    room.onMessage(S2C.welcome, (m: { sessionId: string }) => useUI.getState().set({ sessionId: m.sessionId }));
    room.onMessage(S2C.lobby, (l: LobbyState) => {
      const st = useUI.getState();
      st.set({ lobby: l });
      if (l.phase === 'playing' && st.screen !== 'game') { this.snapshots = []; this.latest = null; st.set({ result: null }); st.go('game'); }
      if (l.phase === 'lobby' && (st.screen === 'game' || st.screen === 'results')) st.go('lobby');
    });
    room.onMessage(S2C.snapshot, (s: Snapshot) => {
      this.latest = s;
      this.snapshots.push({ at: performance.now(), s });
      if (this.snapshots.length > 40) this.snapshots.shift();
      for (const l of this.snapListeners) l(s);
    });
    room.onMessage(S2C.event, (e: GameEvent) => {
      if (this.seenEvents.has(e.id)) return; // events have unique ids – never process twice
      this.seenEvents.add(e.id);
      if (this.seenEvents.size > 500) this.seenEvents.delete(this.seenEvents.values().next().value!);
      for (const l of this.eventListeners) l(e);
    });
    room.onMessage(S2C.interactionResult, (r: InteractionResult) => {
      const cb = this.pending.get(r.requestId);
      this.pending.delete(r.requestId);
      cb?.(r);
    });
    room.onMessage(S2C.result, (r: MatchResult) => {
      const st = useUI.getState();
      st.set({ result: r, paused: false });
      document.exitPointerLock?.();
      st.go('results');
    });
    room.onLeave((code) => {
      console.warn('[net] left room, code', code);
      this.room = null;
      if (this.wantLeave || code === 1000) { useUI.getState().set({ conn: 'offline' }); return; }
      this.tryReconnect();
    });
    room.onError((code, msg) => useUI.getState().set({ error: `Network error ${code}: ${msg ?? ''}` }));
  }

  /** Reconnection (GDD §26): reuse the session token for up to 60 s. */
  async tryReconnect() {
    const ui = useUI.getState();
    let token: string | null = null;
    try { token = sessionStorage.getItem('itlearns.reconnect'); } catch { /* ignore */ }
    if (!token) { ui.set({ conn: 'lost' }); return; }
    ui.set({ conn: 'reconnecting' });
    const started = performance.now();
    while (performance.now() - started < RECONNECT_SECONDS * 1000) {
      try {
        this.client ??= new Client(this.endpoint());
        const room = await this.client.reconnect(token);
        this.bind(room);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    try { sessionStorage.removeItem('itlearns.reconnect'); } catch { /* ignore */ }
    useUI.getState().set({ conn: 'lost' });
    return false;
  }

  async create(name: string, character?: CharacterId) {
    useUI.getState().set({ conn: 'connecting', error: null });
    try {
      this.client = new Client(this.endpoint());
      this.bind(await this.client.create('hunt', { name, character }));
      return true;
    } catch (e) {
      useUI.getState().set({ conn: 'offline', error: humanError(e) });
      return false;
    }
  }

  async join(code: string, name: string) {
    useUI.getState().set({ conn: 'connecting', error: null });
    try {
      this.client = new Client(this.endpoint());
      this.bind(await this.client.joinById(code.trim().toUpperCase(), { name }));
      return true;
    } catch (e) {
      useUI.getState().set({ conn: 'offline', error: humanError(e) });
      return false;
    }
  }

  leave() {
    this.wantLeave = true;
    try { sessionStorage.removeItem('itlearns.reconnect'); } catch { /* ignore */ }
    this.room?.leave(true);
    this.room = null;
    const ui = useUI.getState();
    ui.set({ lobby: null, conn: 'offline', result: null, hud: null });
  }

  sendInput(i: InputMsg) { this.room?.send(C2S.input, i); }
  ready(ready: boolean, character?: CharacterId, name?: string) { this.room?.send(C2S.ready, { ready, character, name }); }
  settings(difficulty: Difficulty) { this.room?.send(C2S.lobbySettings, { difficulty }); }
  start() { this.room?.send(C2S.start, {}); }
  returnToLobby() { this.room?.send(C2S.returnToLobby, {}); }

  private request(type: string, body: Record<string, unknown>): Promise<InteractionResult> {
    const requestId = `req-${Date.now().toString(36)}-${++this.reqSeq}`;
    return new Promise((resolve) => {
      if (!this.room) return resolve({ requestId, ok: false, reason: 'Not connected' });
      this.pending.set(requestId, resolve);
      this.room.send(type, { requestId, ...body });
      setTimeout(() => { if (this.pending.delete(requestId)) resolve({ requestId, ok: false, reason: 'No response (network)' }); }, 4000);
    });
  }
  interact(entityId: string, action: string, payload?: { code?: string }) { return this.request(C2S.interact, { entityId, action, payload }); }
  useItem(slot: number) { return this.request(C2S.useItem, { slot }); }
  dropItem(slot: number) { return this.request(C2S.dropItem, { slot }); }

  onEvent(l: Listener<GameEvent>) { this.eventListeners.add(l); return () => this.eventListeners.delete(l); }
  onSnapshot(l: Listener<Snapshot>) { this.snapListeners.add(l); return () => this.snapListeners.delete(l); }
}

function humanError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/not found|invalid/i.test(m)) return 'Room not found. Check the code.';
  if (/locked|full/i.test(m)) return 'That room is full or its match has already started.';
  if (/progress/i.test(m)) return 'Match already in progress – you cannot join mid-match.';
  return m || 'Could not connect to the server.';
}

export const net = new Net();
