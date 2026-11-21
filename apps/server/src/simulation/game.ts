import {
  CharacterId, DOORS, DOWNED, DT, Difficulty, FIXTURES, FLASHLIGHT, GameEvent, HEALTH_MAX, INTERACT_RANGE, INVENTORY_SLOTS, InputMsg,
  InteractMsg, InteractionResult, ItemKind, LOCKERS, MAX_INPUT_BUFFER, MISSION, MONSTER, MONSTER_SPAWN, MatchResult, NOISE, ObjectiveView,
  PLAYER_SPAWNS, PlayerStatus, Snapshot, SlotMsg, STAMINA, Tile, ZoneId, createRng, lineOfSight, stepMovement, tileAt, toTile, toWorld, zoneAt, Rng,
} from '@itl/shared';
import { Director } from '../ai/director';
import { MonsterBrain, MonsterWorld } from '../ai/monster';
import { Body, NoiseEvent } from '../ai/perception';
import { LORE_DOCUMENTS, MatchLayout, generateLayout } from './spawn';
import { RateLimiter } from '../security/rateLimit';

export interface SimPlayer {
  id: string;
  name: string;
  character: CharacterId;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: string;
  status: PlayerStatus;
  hp: number;
  stamina: number;
  staminaDelay: number;
  battery: number;
  flashlight: boolean;
  inventory: (ItemKind | null)[];
  downs: number;
  downedLeft: number;
  selfRevives: number;
  lockerId: string | null;
  enteringUntil: number;
  hold: { kind: 'revive' | 'self_revive' | 'exit_open'; targetId: string; progress: number; duration: number; txId: string } | null;
  inputs: InputMsg[];
  lastQueuedSeq: number;
  lastSeq: number;
  interactHeld: boolean;
  connected: boolean;
  left: boolean;
  knownCode: string | null;
  zonesVisited: Set<ZoneId>;
  noiseTimer: number;
  recentRequests: Map<string, InteractionResult>;
  limiter: RateLimiter;
  inputLimiter: RateLimiter;
}

interface WorldItem { id: string; kind: ItemKind; x: number; z: number; state: 'world' | 'owned' | 'consumed'; docIndex?: number }
interface Device { id: string; x: number; z: number; pulses: number; nextPulse: number }
type Outbound = { to: string | 'all'; type: 'event'; msg: GameEvent };

export interface SimOptions {
  seed: number;
  difficulty: Difficulty;
  players: { id: string; name: string; character: CharacterId }[];
  aiHearsVoice?: boolean;
}

let eventCounter = 0;

export class GameSimulation implements MonsterWorld {
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly layout: MatchLayout;
  rng: Rng;
  time = 0;
  tick = 0;
  players = new Map<string, SimPlayer>();
  items = new Map<string, WorldItem>();
  devices = new Map<string, Device>();
  doors: Record<string, boolean> = {};
  labUnlocked = false;
  fuseInserted = false;
  generator = { started: false, progress: 0, done: false, nextPulse: 0 };
  terminal = { codeAccepted: false, progress: 0, done: false, nextPulse: 0 };
  switches: { a: number | null; b: number | null } = { a: null, b: null };
  protocolDone = false;
  exitOpen = false;
  finalHunt = false;
  finalLeft: number = MISSION.finalHuntTime;
  documentsFound = new Set<number>();
  monster: MonsterBrain;
  director = new Director();
  result: MatchResult | null = null;
  telemetryLog: string[] = [];
  private noisesNow: NoiseEvent[] = [];
  private outbox: Outbound[] = [];
  private deviceSeq = 0;
  private txSeq = 0;
  private dropSeq = 0;

  constructor(opts: SimOptions) {
    this.difficulty = opts.difficulty;
    this.layout = generateLayout(opts.seed, opts.players.length);
    this.seed = this.layout.seed;
    this.rng = createRng(this.seed ^ 0x9e3779b9);
    for (const d of DOORS) this.doors[d.id] = this.layout.doorsOpen[d.id];
    for (const it of this.layout.items) {
      const p = toWorld(it.tx, it.ty);
      this.items.set(it.id, { id: it.id, kind: it.kind, x: p.x, z: p.z, state: 'world', docIndex: it.docIndex });
    }
    opts.players.forEach((pl, i) => {
      const [tx, ty] = PLAYER_SPAWNS[i % PLAYER_SPAWNS.length];
      const p = toWorld(tx, ty);
      this.players.set(pl.id, this.newPlayer(pl.id, pl.name, pl.character, p.x, p.z, opts.players.length));
    });
    const ms = toWorld(...MONSTER_SPAWN);
    this.monster = new MonsterBrain(ms.x, ms.z, this.director);
    this.telemetry(`[MATCH] seed ${this.seed} (layout attempts ${this.layout.attempts}), ${opts.players.length} player(s), ${opts.difficulty}`);
  }

  private newPlayer(id: string, name: string, character: CharacterId, x: number, z: number, count: number): SimPlayer {
    return {
      id, name, character, x, z, yaw: 0, pitch: 0, mode: 'idle', status: 'alive', hp: HEALTH_MAX, stamina: STAMINA.max, staminaDelay: 0,
      battery: 100, flashlight: false, inventory: Array(INVENTORY_SLOTS).fill(null), downs: 0, downedLeft: 0, selfRevives: count === 1 ? 2 : 0,
      lockerId: null, enteringUntil: 0, hold: null, inputs: [], lastQueuedSeq: -1, lastSeq: -1, interactHeld: false, connected: true, left: false,
      knownCode: null, zonesVisited: new Set(['reception']), noiseTimer: 0, recentRequests: new Map(),
      limiter: new RateLimiter(12, 1), inputLimiter: new RateLimiter(45, 1),
    };
  }

  // ───────────────────────── MonsterWorld implementation (narrow) ─────────────────────────
  doorOpen = (id: string) => !!this.doors[id];
  doorLockedForMonster(id: string): boolean {
    const d = DOORS.find((x) => x.id === id)!;
    if (d.kind === 'security') return !this.labUnlocked;
    if (d.kind === 'exit') return true; // it never leaves the facility
    return false; // normal + powered (containment doors are its domain)
  }
  openDoorByMonster(id: string) {
    if (this.doors[id]) return;
    this.doors[id] = true;
    const d = DOORS.find((x) => x.id === id)!;
    const p = toWorld(d.tx, d.ty);
    this.emitAll({ kind: 'door', x: p.x, z: p.z, sound: 'door_bang', text: '[A door bangs open]', loud: 0.9 });
  }
  bodies(): Body[] {
    return [...this.players.values()].filter((p) => !p.left).map((p) => ({
      id: p.id, x: p.x, z: p.z, status: p.status === 'hidden' ? 'hidden' : p.status, mode: p.mode, flashlight: p.flashlight,
      enteringLockerId: p.status === 'hidden' && this.time < p.enteringUntil ? p.lockerId : null,
      reviving: p.hold?.kind === 'revive',
    }));
  }
  noises() { return this.noisesNow; }
  checkLocker(lockerId: string): string | null {
    const p = [...this.players.values()].find((pl) => pl.lockerId === lockerId && pl.status === 'hidden');
    if (!p) return null;
    const l = LOCKERS.find((x) => x.id === lockerId)!;
    const f = toWorld(l.tx + l.fx, l.ty + l.fy);
    p.lockerId = null;
    p.status = 'alive';
    p.x = f.x; p.z = f.z;
    this.emitTo(p.id, { kind: 'notice', text: 'It tore the locker open!' });
    return p.id;
  }
  attack(targetId: string): 'hit' | 'downed' | 'miss' {
    const p = this.players.get(targetId);
    if (!p || p.status !== 'alive') return 'miss';
    const d = Math.hypot(p.x - this.monster.x, p.z - this.monster.z);
    if (d > MONSTER.attackHitRange || !lineOfSight(this.monster.x, this.monster.z, p.x, p.z, this.doorOpen)) return 'miss'; // Bug 4
    const dmg = this.difficulty === 'hardcore' ? MONSTER.hardcoreDamage : MONSTER.damage;
    p.hp = Math.max(0, p.hp - dmg);
    p.hold = null;
    this.emitAll({ kind: 'sound', sound: 'hit', x: p.x, z: p.z, text: `[${p.name} is struck]` });
    if (p.hp <= 0) { this.down(p); return 'downed'; }
    return 'hit';
  }
  deviceExists(id: string) { return this.devices.has(id); }
  isLit(x: number, z: number): boolean {
    const zn = zoneAt(x, z);
    if (zn === 'reception') return true;
    return this.generator.done && (zn === 'hall' || zn === 'maintenance' || zn === 'laboratory' || zn === 'exit');
  }
  missionZone(): string | null {
    const st = this.stage();
    return st === 'power' ? 'maintenance' : st === 'data' ? 'laboratory' : st === 'protocol' ? (this.switches.a ? 'maintenance' : 'containment') : st === 'escape' ? 'exit' : null;
  }
  emit(kind: 'sound' | 'subtitle' | 'adapted' | 'locker_checked' | 'attack_windup', data: { text?: string; sound?: string; x?: number; z?: number; loud?: number }) {
    this.emitAll({ kind, ...data });
  }
  telemetry(line: string) {
    this.telemetryLog.push(`${this.time.toFixed(1)}s ${line}`);
    if (this.telemetryLog.length > 400) this.telemetryLog.shift();
  }

  // ───────────────────────── events ─────────────────────────
  private emitAll(e: Omit<GameEvent, 'id'>) { this.outbox.push({ to: 'all', type: 'event', msg: { id: `ev-${++eventCounter}`, ...e } }); }
  private emitTo(id: string, e: Omit<GameEvent, 'id'>) { this.outbox.push({ to: id, type: 'event', msg: { id: `ev-${++eventCounter}`, ...e } }); }
  drainOutbox(): Outbound[] { const o = this.outbox; this.outbox = []; return o; }
  private noise(x: number, z: number, radius: number, kind: string, deviceId?: string) { this.noisesNow.push({ x, z, radius, kind, time: this.time, deviceId }); }

  // ───────────────────────── input ─────────────────────────
  /** Sequenced input queue: drops stale/replayed packets (Bug 9) and caps buffer. */
  queueInput(id: string, input: InputMsg) {
    const p = this.players.get(id);
    if (!p || p.left || !Number.isInteger(input.seq) || input.seq <= p.lastQueuedSeq) return;
    if (!p.inputLimiter.take(this.time)) return;
    const clean: InputMsg = {
      seq: input.seq, mx: clampN(input.mx, -1, 1), mz: clampN(input.mz, -1, 1), yaw: Number(input.yaw) || 0, pitch: clampN(input.pitch, -1.5, 1.5),
      run: !!input.run, crouch: !!input.crouch, interactHeld: !!input.interactHeld, flashlight: !!input.flashlight,
    };
    p.lastQueuedSeq = input.seq;
    p.inputs.push(clean);
    while (p.inputs.length > MAX_INPUT_BUFFER) p.inputs.shift();
  }

  // ───────────────────────── interactions (server-validated, GDD §10) ─────────────────────────
  handleInteract(id: string, msg: InteractMsg): InteractionResult {
    const p = this.players.get(id);
    const rid = String(msg?.requestId ?? '').slice(0, 64);
    if (!p || !rid) return { requestId: rid, ok: false, reason: 'Invalid request' };
    const cached = p.recentRequests.get(rid);
    if (cached) return cached; // idempotent replay
    const res = this.result ? { requestId: rid, ok: false, reason: 'Match is over' } : !p.limiter.take(this.time) ? { requestId: rid, ok: false, reason: 'Too many requests' } : this.interact(p, rid, String(msg.entityId ?? ''), String(msg.action ?? ''), msg.payload);
    p.recentRequests.set(rid, res);
    if (p.recentRequests.size > 48) p.recentRequests.delete(p.recentRequests.keys().next().value!);
    return res;
  }

  private near(p: SimPlayer, x: number, z: number, range = INTERACT_RANGE) {
    return Math.hypot(p.x - x, p.z - z) <= range && lineOfSight(p.x, p.z, x, z, this.doorOpen);
  }

  private interact(p: SimPlayer, rid: string, entityId: string, action: string, payload?: { code?: string }): InteractionResult {
    const ok = (): InteractionResult => ({ requestId: rid, ok: true });
    const no = (reason: string): InteractionResult => ({ requestId: rid, ok: false, reason });
    if (p.left || !p.connected) return no('Not connected');
    if (p.status === 'dead' || p.status === 'escaped') return no('You cannot act now');

    // downed player actions
    if (entityId === 'self') {
      if (action === 'distress') {
        if (p.status !== 'downed') return no('Only while downed');
        this.noise(p.x, p.z, NOISE.distress, 'distress');
        this.emitAll({ kind: 'notice', text: `${p.name} is calling for help!`, x: p.x, z: p.z, sound: 'distress' });
        return ok();
      }
      if (action === 'self_revive') {
        if (p.status !== 'downed') return no('Not downed');
        if (p.selfRevives <= 0) return no('No self-revives left');
        p.hold = { kind: 'self_revive', targetId: p.id, progress: 0, duration: DOWNED.selfReviveTime, txId: `tx-${++this.txSeq}` };
        return ok();
      }
      return no('Unknown action');
    }
    if (p.status === 'downed') return no('You are downed');

    // lockers
    const locker = LOCKERS.find((l) => l.id === entityId);
    if (locker) {
      const lp = toWorld(locker.tx, locker.ty);
      if (action === 'exit') {
        if (p.lockerId !== locker.id) return no('Not inside this locker');
        const f = toWorld(locker.tx + locker.fx, locker.ty + locker.fy);
        p.lockerId = null; p.status = 'alive'; p.x = f.x; p.z = f.z;
        this.noise(f.x, f.z, NOISE.lockerSlam * 0.6, 'locker');
        return ok();
      }
      if (p.status === 'hidden') return no('Already hiding');
      if (!this.near(p, lp.x, lp.z)) return no('Too far away');
      if ([...this.players.values()].some((o) => o.lockerId === locker.id)) return no('Someone is already inside');
      p.lockerId = locker.id; p.status = 'hidden'; p.enteringUntil = this.time + 0.6; p.hold = null; p.flashlight = false;
      p.x = lp.x; p.z = lp.z;
      this.noise(lp.x, lp.z, 2.5, 'locker');
      return ok();
    }
    if (p.status === 'hidden') return no('Leave the locker first');

    // revive teammate (transaction – Bug 3)
    if (entityId.startsWith('player:')) {
      const t = this.players.get(entityId.slice(7));
      if (!t || t === p) return no('Invalid target');
      if (t.status !== 'downed') return no('They do not need reviving');
      if (!this.near(p, t.x, t.z)) return no('Too far away');
      if (!p.inventory.includes('medkit')) return no('You need a Medkit');
      if ([...this.players.values()].some((o) => o.hold?.kind === 'revive' && o.hold.targetId === t.id)) return no('Someone is already reviving them');
      p.hold = { kind: 'revive', targetId: t.id, progress: 0, duration: DOWNED.reviveTime, txId: `tx-${++this.txSeq}` };
      return ok();
    }

    // world items (Bug 1 – single atomic transition)
    const item = this.items.get(entityId);
    if (item) {
      if (item.state !== 'world') return no('Item no longer available');
      if (!this.near(p, item.x, item.z)) return no('Too far away');
      if (item.kind === 'document') {
        item.state = 'consumed';
        const doc = LORE_DOCUMENTS[item.docIndex ?? 0];
        this.documentsFound.add(item.docIndex ?? 0);
        this.emitTo(p.id, { kind: 'document', title: doc.title, body: doc.body });
        this.emitAll({ kind: 'notice', text: `${p.name} found a research document (${this.documentsFound.size}/${LORE_DOCUMENTS.length})` });
        return ok();
      }
      const slot = p.inventory.indexOf(null);
      if (slot < 0) return no('Inventory full');
      item.state = 'owned';
      p.inventory[slot] = item.kind;
      this.emitAll({ kind: 'pickup', text: `${p.name} picked up ${item.kind.replace('_', ' ')}`, x: item.x, z: item.z, sound: 'pickup' });
      return ok();
    }

    // doors
    const door = DOORS.find((d) => d.id === entityId);
    if (door) {
      const dp = toWorld(door.tx, door.ty);
      if (!this.near(p, dp.x, dp.z)) return no('Too far away');
      if (door.kind === 'security' && !this.labUnlocked) {
        if (!p.inventory.includes('keycard')) return no('Requires a Keycard');
        this.labUnlocked = true;
        for (const d of DOORS) if (d.kind === 'security') this.doors[d.id] = d.id === door.id;
        this.emitAll({ kind: 'door', text: 'Laboratory security released', x: dp.x, z: dp.z, sound: 'door_security' });
        this.noise(dp.x, dp.z, NOISE.door, 'door');
        return ok();
      }
      if (door.kind === 'powered' && !this.generator.done) return no('No power to this door');
      if (door.kind === 'exit') {
        if (!this.protocolDone) return no('Emergency protocol not unlocked');
        if (this.exitOpen) return no('Already open');
        p.hold = { kind: 'exit_open', targetId: door.id, progress: 0, duration: MISSION.exitHoldTime, txId: `tx-${++this.txSeq}` };
        return ok();
      }
      const willOpen = !this.doors[door.id];
      if (!willOpen && this.doorOccupied(door.tx, door.ty)) return no('Something is in the doorway');
      this.doors[door.id] = willOpen;
      this.noise(dp.x, dp.z, NOISE.door, 'door');
      this.emitAll({ kind: 'door', x: dp.x, z: dp.z, sound: willOpen ? 'door_open' : 'door_close' });
      return ok();
    }

    // fixtures & objectives (state machines – Bug 5)
    const fx = FIXTURES.find((f) => f.id === entityId);
    if (fx) {
      const fp = toWorld(fx.tx, fx.ty);
      if (!this.near(p, fp.x, fp.z, INTERACT_RANGE + (fx.solid ? 0.5 : 0))) return no('Too far away');
      switch (fx.kind) {
        case 'fuse_box': {
          if (this.fuseInserted) return no('Fuse already installed');
          const s = p.inventory.indexOf('fuse');
          if (s < 0) return no('Requires a Fuse');
          p.inventory[s] = null;
          this.fuseInserted = true;
          this.emitAll({ kind: 'notice', text: `${p.name} installed the fuse. Start the generator.`, sound: 'clunk', x: fp.x, z: fp.z });
          return ok();
        }
        case 'generator': {
          if (!this.fuseInserted) return no('The fuse box is empty');
          if (this.generator.started) return no(this.generator.done ? 'Generator is running' : 'Generator is spinning up');
          this.generator.started = true;
          this.emitAll({ kind: 'notice', text: 'Generator spinning up – it is LOUD. Keep it running.', sound: 'generator_start', x: fp.x, z: fp.z });
          return ok();
        }
        case 'whiteboard': {
          p.knownCode = this.layout.terminalCode;
          this.emitTo(p.id, { kind: 'document', title: 'Whiteboard – Lab B4', body: `"Terminal override (temp) → ${this.layout.terminalCode}. ERASE THIS. – H."` });
          return ok();
        }
        case 'terminal': {
          if (!this.generator.done) return no('Terminal has no power');
          if (this.terminal.done) return no('Data already recovered');
          if (this.terminal.codeAccepted) return no('Download in progress');
          if (action !== 'enter_code') return { requestId: rid, ok: false, reason: 'CODE_REQUIRED' };
          if (String(payload?.code ?? '').trim() !== this.layout.terminalCode) {
            this.noise(fp.x, fp.z, 6, 'terminal');
            return no('ACCESS DENIED – wrong code');
          }
          this.terminal.codeAccepted = true;
          this.emitAll({ kind: 'notice', text: 'Download started. Stay near the terminal.', sound: 'terminal_ok', x: fp.x, z: fp.z });
          return ok();
        }
        case 'switch_a':
        case 'switch_b': {
          if (!this.terminal.done) return no('Override locked – recover the research data first');
          if (this.protocolDone) return no('Protocol already unlocked');
          const key = fx.kind === 'switch_a' ? 'a' : 'b';
          if (this.switches[key] !== null) return no('Already armed');
          this.switches[key] = this.time;
          this.noise(fp.x, fp.z, NOISE.door, 'switch');
          const other = key === 'a' ? 'b' : 'a';
          if (this.switches[other] !== null) {
            this.protocolDone = true;
            this.emitAll({ kind: 'notice', text: 'Signals synchronised. Emergency exit code received – open the Emergency Exit!', sound: 'protocol' });
          } else {
            this.emitAll({ kind: 'notice', text: `Override ${key.toUpperCase()} armed. Arm the other switch within ${this.switchWindow()}s.`, sound: 'switch' });
          }
          return ok();
        }
      }
    }
    return no('Nothing to interact with');
  }

  private doorOccupied(tx: number, ty: number) {
    const occ = (x: number, z: number) => { const t = toTile(x, z); return t.tx === tx && t.ty === ty; };
    return [...this.players.values()].some((p) => !p.left && occ(p.x, p.z)) || occ(this.monster.x, this.monster.z);
  }

  private switchWindow() {
    const active = [...this.players.values()].filter((p) => !p.left && (p.status === 'alive' || p.status === 'hidden' || p.status === 'downed')).length;
    return active <= 1 ? MISSION.switchWindowSolo : MISSION.switchWindowCoop;
  }

  handleUse(id: string, msg: SlotMsg): InteractionResult {
    const p = this.players.get(id);
    const rid = String(msg?.requestId ?? '');
    if (!p || p.left) return { requestId: rid, ok: false, reason: 'Invalid' };
    const cached = p.recentRequests.get(rid);
    if (cached) return cached;
    const no = (reason: string) => ({ requestId: rid, ok: false, reason });
    let res: InteractionResult;
    const slot = Number(msg.slot);
    const kind = Number.isInteger(slot) ? p.inventory[slot] : null;
    if (!p.limiter.take(this.time)) res = no('Too many requests');
    else if (p.status !== 'alive') res = no('You cannot use items now');
    else if (!kind) res = no('Empty slot');
    else if (kind === 'medkit') {
      if (p.hp >= HEALTH_MAX) res = no('Already at full health');
      else { p.hp = Math.min(HEALTH_MAX, p.hp + 50); p.inventory[slot] = null; res = { requestId: rid, ok: true }; }
    } else if (kind === 'battery') {
      if (p.battery >= 99) res = no('Flashlight battery is full');
      else { p.battery = Math.min(100, p.battery + FLASHLIGHT.batteryRestore); p.inventory[slot] = null; res = { requestId: rid, ok: true }; }
    } else if (kind === 'noise_maker') {
      const fx = p.x - Math.sin(p.yaw) * 1.2, fz = p.z - Math.cos(p.yaw) * 1.2;
      const t = toTile(fx, fz);
      const pos = tileAt(t.tx, t.ty) === Tile.Floor ? toWorld(t.tx, t.ty) : { x: p.x, z: p.z };
      const dev: Device = { id: `device_${++this.deviceSeq}`, x: pos.x, z: pos.z, pulses: 3, nextPulse: this.time + 2 };
      this.devices.set(dev.id, dev);
      p.inventory[slot] = null;
      this.emitAll({ kind: 'notice', text: `${p.name} set a noise maker (2s)`, x: pos.x, z: pos.z });
      res = { requestId: rid, ok: true };
    } else res = no('This item cannot be used directly');
    p.recentRequests.set(rid, res);
    return res;
  }

  handleDrop(id: string, msg: SlotMsg): InteractionResult {
    const p = this.players.get(id);
    const rid = String(msg?.requestId ?? '');
    if (!p || p.left) return { requestId: rid, ok: false, reason: 'Invalid' };
    const cached = p.recentRequests.get(rid);
    if (cached) return cached;
    const slot = Number(msg.slot);
    let res: InteractionResult;
    if (p.status !== 'alive') res = { requestId: rid, ok: false, reason: 'You cannot drop items now' };
    else if (!Number.isInteger(slot) || !p.inventory[slot]) res = { requestId: rid, ok: false, reason: 'Empty slot' };
    else {
      this.spawnDrop(p.inventory[slot]!, p.x, p.z);
      p.inventory[slot] = null;
      this.noise(p.x, p.z, NOISE.drop, 'drop');
      res = { requestId: rid, ok: true };
    }
    p.recentRequests.set(rid, res);
    return res;
  }

  private spawnDrop(kind: ItemKind, x: number, z: number) {
    const t = toTile(x, z);
    let pos = { x, z };
    if (tileAt(t.tx, t.ty) !== Tile.Floor) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) if (tileAt(t.tx + dx, t.ty + dy) === Tile.Floor) { pos = toWorld(t.tx + dx, t.ty + dy); break; }
    }
    const id = `drop_${++this.dropSeq}`;
    this.items.set(id, { id, kind, x: pos.x, z: pos.z, state: 'world' });
  }

  /** Critical items are never lost: dropped on death/leave so missions stay completable (GDD §26, §32). */
  private dropAll(p: SimPlayer) {
    p.inventory.forEach((k) => k && this.spawnDrop(k, p.x, p.z));
    p.inventory = Array(INVENTORY_SLOTS).fill(null);
  }

  private down(p: SimPlayer) {
    p.downs++;
    p.hold = null;
    if (p.downs > DOWNED.maxDowns) return this.kill(p, 'was killed');
    p.status = 'downed';
    p.hp = 0;
    p.downedLeft = this.difficulty === 'hardcore' ? 30 : DOWNED.duration;
    p.flashlight = false;
    this.emitAll({ kind: 'downed', text: `${p.name} is down! Revive them with a Medkit.`, x: p.x, z: p.z, sound: 'downed' });
  }

  private kill(p: SimPlayer, why: string) {
    p.status = 'dead';
    p.hp = 0;
    p.hold = null;
    p.lockerId = null;
    this.dropAll(p);
    this.emitAll({ kind: 'died', text: `${p.name} ${why}.`, x: p.x, z: p.z, sound: 'death' });
  }

  setConnected(id: string, connected: boolean) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    p.inputs = [];
    p.hold = null;
    p.interactHeld = false;
    this.emitAll({ kind: connected ? 'player_reconnected' : 'player_left', text: connected ? `${p.name} reconnected` : `${p.name} lost connection (60s to reconnect)` });
  }

  /** Called when the reconnection window expired or the player left voluntarily. */
  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p || p.left) return;
    p.left = true;
    p.connected = false;
    if (p.status !== 'escaped' && p.status !== 'dead') { this.dropAll(p); p.status = 'dead'; }
    p.lockerId = null;
    this.emitAll({ kind: 'player_left', text: `${p.name} left the match. Their items were dropped.` });
  }

  // ───────────────────────── simulation step ─────────────────────────
  step() {
    if (this.result) return;
    this.tick++;
    this.time += DT;
    this.noisesNow = [];

    for (const p of this.players.values()) this.stepPlayer(p);
    this.stepObjectives();
    this.stepDevices();
    const alive = [...this.players.values()].filter((p) => p.status === 'alive' || p.status === 'hidden');
    const downed = [...this.players.values()].filter((p) => p.status === 'downed');
    const di = {
      time: this.time, alive: alive.length, downed: downed.length, injured: alive.filter((p) => p.hp < 60).length, missionZone: this.missionZone(),
      lastChaseEnded: this.monster.lastChaseEnded, chaseActive: this.monster.chaseActive, totalDowns: 0, finalHunt: this.finalHunt,
    };
    this.director.update(di, DT);
    this.monster.update(this, DT);
    if (this.director.wantsAmbientScare(di, this.rng.next())) {
      const pick = this.rng.pick(['[Distant pipes groan]', '[Static crackles over a dead intercom]', '[Ventilation shudders, then stops]']);
      this.emitAll({ kind: 'sound', sound: 'ambient_scare', text: pick, x: this.rng.range(5, 60), z: this.rng.range(5, 40), loud: 0.3 });
    }
    this.checkEnd();
  }

  private stepPlayer(p: SimPlayer) {
    if (p.left || p.status === 'dead' || p.status === 'escaped') return;
    // downed timer
    if (p.status === 'downed') {
      p.downedLeft -= DT;
      if (p.downedLeft <= 0) { this.kill(p, 'bled out'); return; }
    }
    // consume inputs (at most 2 per tick when catching up)
    const n = p.inputs.length > 4 ? 2 : 1;
    for (let i = 0; i < n && p.inputs.length; i++) {
      const input = p.inputs.shift()!;
      p.lastSeq = input.seq;
      p.yaw = input.yaw;
      p.pitch = input.pitch;
      p.interactHeld = input.interactHeld;
      if (p.status === 'hidden') { p.mode = 'idle'; continue; }
      p.flashlight = input.flashlight && p.battery > 0 && p.status === 'alive';
      if (!p.connected) continue;
      if (p.hold && (input.mx !== 0 || input.mz !== 0) && p.hold.kind !== 'self_revive') {
        p.hold = null;
        this.emitTo(p.id, { kind: 'notice', text: 'Interrupted – you moved' });
      }
      const s = stepMovement({ x: p.x, z: p.z, stamina: p.stamina, staminaDelay: p.staminaDelay, mode: p.mode as never }, input, DT, this.doorOpen, { downed: p.status === 'downed' || !!p.hold });
      p.x = s.x; p.z = s.z; p.stamina = s.stamina; p.staminaDelay = s.staminaDelay; p.mode = s.mode;
    }
    if (!p.inputs.length && p.mode !== 'idle' && this.tick % 3 === 0) p.mode = p.mode === 'run' ? 'walk' : p.mode;
    const z = zoneAt(p.x, p.z);
    if (z) p.zonesVisited.add(z);
    if (p.flashlight) { p.battery = Math.max(0, p.battery - FLASHLIGHT.drainPerSec * DT); if (p.battery <= 0) p.flashlight = false; }
    // footstep noise
    p.noiseTimer -= DT;
    if (p.noiseTimer <= 0 && (p.mode === 'run' || p.mode === 'walk')) {
      this.noise(p.x, p.z, p.mode === 'run' ? NOISE.run : NOISE.walk, p.mode === 'run' ? 'run' : 'walk');
      p.noiseTimer = p.mode === 'run' ? 0.4 : 0.6;
    }
    // escape
    if (this.exitOpen && z === 'escape' && p.status === 'alive') {
      p.status = 'escaped';
      p.hold = null;
      this.emitAll({ kind: 'escaped', text: `${p.name} reached the evacuation lift!`, sound: 'escaped' });
      return;
    }
    this.stepHold(p);
  }

  private stepHold(p: SimPlayer) {
    const h = p.hold;
    if (!h) return;
    if (!p.interactHeld) { p.hold = null; return; }
    if (h.kind === 'revive') {
      const t = this.players.get(h.targetId);
      if (!t || t.status !== 'downed' || !this.near(p, t.x, t.z, INTERACT_RANGE + 0.3) || !p.inventory.includes('medkit')) { p.hold = null; return; }
    } else if (h.kind === 'self_revive') {
      if (p.status !== 'downed') { p.hold = null; return; }
    } else if (h.kind === 'exit_open') {
      const d = DOORS.find((x) => x.id === h.targetId)!;
      const dp = toWorld(d.tx, d.ty);
      if (p.status !== 'alive' || !this.near(p, dp.x, dp.z, INTERACT_RANGE + 0.3)) { p.hold = null; return; }
    }
    h.progress += DT;
    if (h.progress < h.duration) return;
    p.hold = null;
    if (h.kind === 'revive') {
      const t = this.players.get(h.targetId)!;
      const slot = p.inventory.indexOf('medkit');
      if (t.status !== 'downed' || slot < 0) return; // already completed by someone else – idempotent
      p.inventory[slot] = null;
      t.status = 'alive';
      t.hp = DOWNED.reviveHp;
      t.downedLeft = 0;
      this.emitAll({ kind: 'revived', text: `${p.name} revived ${t.name}`, x: t.x, z: t.z, sound: 'revive' });
    } else if (h.kind === 'self_revive') {
      if (p.status !== 'downed' || p.selfRevives <= 0) return;
      p.selfRevives--;
      p.status = 'alive';
      p.hp = 30;
      this.emitAll({ kind: 'revived', text: `${p.name} got back up (${p.selfRevives} self-revive left)`, sound: 'revive' });
    } else if (h.kind === 'exit_open') {
      if (this.exitOpen) return;
      this.exitOpen = true;
      this.doors['door_emergency'] = true;
      this.finalHunt = true;
      this.finalLeft = MISSION.finalHuntTime;
      const dp = toWorld(38, 22);
      this.noise(dp.x, dp.z, NOISE.exitDoor, 'exit');
      this.emitAll({ kind: 'final_hunt', text: 'EMERGENCY EXIT OPEN – everyone to the evacuation lift! It knows where you are going.', sound: 'alarm' });
    }
  }

  private stepObjectives() {
    // generator spin-up: progresses unless the creature is right on top of it ("protect the start-up")
    if (this.generator.started && !this.generator.done) {
      const g = toWorld(40, 6);
      const blocked = Math.hypot(this.monster.x - g.x, this.monster.z - g.z) < 4;
      if (!blocked) this.generator.progress += DT;
      if (this.time >= this.generator.nextPulse) { this.noise(g.x, g.z, NOISE.generator, 'generator'); this.generator.nextPulse = this.time + 3; }
      if (this.generator.progress >= MISSION.generatorSpinUp) {
        this.generator.done = true;
        this.emitAll({ kind: 'power_on', text: 'Backup power restored. Containment doors and the lab terminal are online.', sound: 'power_on' });
      }
    }
    // terminal download: needs a defender nearby and no creature at the desk
    if (this.terminal.codeAccepted && !this.terminal.done) {
      const t = toWorld(6, 4);
      const defended = [...this.players.values()].some((p) => p.status === 'alive' && Math.hypot(p.x - t.x, p.z - t.z) < 4.5);
      const blocked = Math.hypot(this.monster.x - t.x, this.monster.z - t.z) < 3;
      if (defended && !blocked) this.terminal.progress += DT;
      if (this.time >= this.terminal.nextPulse) { this.noise(t.x, t.z, NOISE.terminal, 'terminal'); this.terminal.nextPulse = this.time + 4; }
      if (this.terminal.progress >= MISSION.downloadTime) {
        this.terminal.done = true;
        this.emitAll({ kind: 'notice', text: 'Research data recovered. Arm BOTH override switches (Containment + Maintenance).', sound: 'terminal_ok' });
      }
    }
    // override window
    if (!this.protocolDone) {
      const win = this.switchWindow();
      for (const k of ['a', 'b'] as const) {
        const at = this.switches[k];
        if (at !== null && this.time - at > win) {
          this.switches[k] = null;
          this.emitAll({ kind: 'notice', text: `Override ${k.toUpperCase()} timed out – signals not synchronised. Try again.`, sound: 'error' });
        }
      }
    }
    if (this.finalHunt) {
      this.finalLeft -= DT;
      if (this.finalLeft <= 0) {
        for (const p of this.players.values()) if (!p.left && (p.status === 'alive' || p.status === 'hidden' || p.status === 'downed')) this.kill(p, 'was left behind when the lift departed');
      }
    }
  }

  private stepDevices() {
    for (const d of this.devices.values()) {
      if (this.time < d.nextPulse) continue;
      this.noise(d.x, d.z, NOISE.noiseMaker, 'noise_maker', d.id);
      this.emitAll({ kind: 'sound', sound: 'noise_maker', x: d.x, z: d.z, loud: 1, text: '[Shrill electronic beeping]' });
      d.pulses--;
      d.nextPulse = this.time + 2;
      if (d.pulses <= 0) {
        // device stays (spent) for a while so the creature can find it
        d.nextPulse = Infinity;
        this.deviceExpiry.set(d.id, this.time + 20);
      }
    }
    for (const [id, until] of this.deviceExpiry) if (this.time > until) { this.devices.delete(id); this.deviceExpiry.delete(id); }
  }
  deviceExpiry = new Map<string, number>();

  stage(): ObjectiveView['stage'] {
    if (this.result) return 'done';
    if (!this.generator.done) return 'power';
    if (!this.terminal.done) return 'data';
    if (!this.protocolDone) return 'protocol';
    return 'escape';
  }

  objectiveView(): ObjectiveView {
    const st = this.stage();
    const base = { powerOn: this.generator.done, documentsFound: this.documentsFound.size, documentsTotal: LORE_DOCUMENTS.length, finalTimeLeft: this.finalHunt ? Math.max(0, this.finalLeft) : null };
    const anyHas = (k: ItemKind) => [...this.players.values()].some((p) => p.inventory.includes(k));
    if (st === 'power') return { ...base, stage: st, title: 'Mission 1 – Restore Power', progress: this.generator.started ? this.generator.progress / MISSION.generatorSpinUp : null, steps: [
      { text: 'Find a Fuse', done: this.fuseInserted || anyHas('fuse') },
      { text: 'Install it in the Maintenance fuse box', done: this.fuseInserted },
      { text: 'Start the backup generator', done: this.generator.started },
      { text: 'Keep the generator running (it is loud)', done: this.generator.done },
    ] };
    if (st === 'data') return { ...base, stage: st, title: 'Mission 2 – Recover Research Data', progress: this.terminal.codeAccepted ? this.terminal.progress / MISSION.downloadTime : null, steps: [
      { text: 'Find a Keycard', done: this.labUnlocked || anyHas('keycard') },
      { text: 'Open the Laboratory', done: this.labUnlocked },
      { text: 'Find the terminal code (lab whiteboard)', done: [...this.players.values()].some((p) => p.knownCode) },
      { text: 'Enter the code at the terminal', done: this.terminal.codeAccepted },
      { text: 'Defend the terminal until the download completes', done: this.terminal.done },
    ] };
    if (st === 'protocol') return { ...base, stage: st, title: 'Mission 3 – Unlock Emergency Protocol', progress: null, steps: [
      { text: 'Arm override A (Containment)', done: this.switches.a !== null },
      { text: 'Arm override B (Maintenance)', done: this.switches.b !== null },
      { text: `Synchronise: both within ${this.switchWindow()}s`, done: this.protocolDone },
    ] };
    return { ...base, stage: st, title: 'Final – Escape', progress: null, steps: [
      { text: 'Open the Emergency Exit (hold E)', done: this.exitOpen },
      { text: 'Reach the evacuation lift', done: false },
    ] };
  }

  private checkEnd() {
    const ps = [...this.players.values()];
    const inside = ps.filter((p) => !p.left && (p.status === 'alive' || p.status === 'downed' || p.status === 'hidden'));
    if (inside.length > 0) return;
    const escaped = ps.filter((p) => p.status === 'escaped').length;
    const missions = (this.generator.done ? 1 : 0) + (this.terminal.done ? 1 : 0) + (this.protocolDone ? 1 : 0);
    const docs = this.documentsFound.size;
    let ending: string, endingText: string;
    if (escaped === 0) { ending = 'Retained Subjects'; endingText = 'Subject 47 keeps its new subjects. Somewhere below, the learning protocol continues.'; }
    else if (escaped === ps.length && docs >= 4) { ending = 'Full Disclosure'; endingText = 'Everyone made it out with the truth about SYNAPSE. The world will know what Subject 47 is.'; }
    else if (escaped === ps.length) { ending = 'Clean Escape'; endingText = 'The whole team escaped – but most of the evidence stayed behind on B4.'; }
    else { ending = 'The Cost of Leaving'; endingText = 'Some of you reached the lift. The creature remembers the ones who did not.'; }
    this.result = {
      outcome: escaped === 0 ? 'wiped' : escaped === ps.length ? 'escaped_all' : 'escaped_some',
      ending, endingText, durationSec: Math.round(this.time),
      players: ps.map((p) => ({ id: p.id, name: p.name, fate: p.left ? 'left' : p.status, downs: p.downs })),
      missionsCompleted: missions, documents: docs, seed: this.seed,
      learned: this.monster.learnedSummary().map((r) => ({
        behavior: r.behavior, score: r.score, tier: ['observing', 'extra checks', 'changed priorities', 'counter-tactics'][r.tier],
        note: `${r.repetitions} observation(s)`,
      })),
    };
    this.telemetry(`[MATCH] ended: ${this.result.outcome}`);
  }

  // ───────────────────────── snapshots (per-client, culled) ─────────────────────────
  snapshotFor(id: string): Snapshot | null {
    const me = this.players.get(id);
    if (!me) return null;
    const d = Math.hypot(this.monster.x - me.x, this.monster.z - me.z);
    const showMonster = this.monster.state !== 'DORMANT' && (d <= MONSTER.monsterRevealRange || lineOfSight(me.x, me.z, this.monster.x, this.monster.z, this.doorOpen));
    return {
      t: this.tick,
      time: this.time,
      self: {
        lastSeq: me.lastSeq, stamina: me.stamina, staminaDelay: me.staminaDelay, battery: me.battery, inventory: [...me.inventory], downs: me.downs,
        selfRevives: me.selfRevives, lockerId: me.lockerId, hold: me.hold ? { kind: me.hold.kind, progress: me.hold.progress / me.hold.duration } : null,
        knownCode: me.knownCode, zonesVisited: [...me.zonesVisited],
      },
      players: [...this.players.values()].filter((p) => !p.left).map((p) => ({
        id: p.id, name: p.name, character: p.character, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, mode: p.mode, status: p.status, hp: p.hp,
        flashlight: p.flashlight, connected: p.connected, downedLeft: Math.max(0, p.downedLeft), holdProgress: p.hold ? p.hold.progress / p.hold.duration : 0,
      })),
      monster: showMonster ? { x: this.monster.x, z: this.monster.z, yaw: this.monster.yaw, look: this.monster.presentation } : null,
      doors: { ...this.doors },
      items: [...this.items.values()].filter((i) => i.state === 'world').map((i) => ({ id: i.id, kind: i.kind, x: i.x, z: i.z })),
      lockersOccupiedBySelf: me.lockerId,
      fixtures: {
        fuse_box: this.fuseInserted ? 'installed' : 'empty',
        generator: this.generator.done ? 'running' : this.generator.started ? 'spinning' : 'off',
        terminal: this.terminal.done ? 'done' : this.terminal.codeAccepted ? 'downloading' : this.generator.done ? 'locked' : 'no power',
        switch_a: this.switches.a !== null || this.protocolDone ? 'armed' : 'idle',
        switch_b: this.switches.b !== null || this.protocolDone ? 'armed' : 'idle',
        whiteboard: 'readable',
      },
      objective: this.objectiveView(),
    };
  }
}

function clampN(v: unknown, lo: number, hi: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
}
