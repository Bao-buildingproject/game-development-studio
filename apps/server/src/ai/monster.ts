import { DOORS, Difficulty, LOCKERS, MAP_W, MONSTER, Rng, TILE, ZONES, collideCircle, toTile, toWorld, zoneAt, DOOR_AT, Tile, tileAt } from '@itl/shared';
import { AdaptiveMemory, BehaviorType, tierOf } from './memory';
import { Director } from './director';
import { findPath, monsterPassable } from './pathfinding';
import { Body, Heard, NoiseEvent, Percept, hear, see } from './perception';

export type MonsterState = 'DORMANT' | 'PATROL' | 'SUSPICIOUS' | 'INVESTIGATE' | 'SEARCH' | 'CHASE' | 'ADAPT' | 'RECOVER' | 'FINAL_HUNT';

/** Narrow world interface: the brain never reads raw player positions – only percepts (GDD §15 Rule C). */
export interface MonsterWorld {
  time: number;
  rng: Rng;
  difficulty: Difficulty;
  finalHunt: boolean;
  doorOpen(id: string): boolean;
  doorLockedForMonster(id: string): boolean;
  openDoorByMonster(id: string): void;
  bodies(): Body[];
  noises(): NoiseEvent[];
  checkLocker(lockerId: string): string | null;
  attack(targetId: string): 'hit' | 'downed' | 'miss';
  deviceExists(deviceId: string): boolean;
  isLit(x: number, z: number): boolean;
  missionZone(): string | null;
  emit(kind: 'sound' | 'subtitle' | 'adapted' | 'locker_checked' | 'attack_windup', data: { text?: string; sound?: string; x?: number; z?: number; loud?: number }): void;
  telemetry(line: string): void;
}

interface Task { kind: 'locker'; lockerId: string }

const STATE_TIMEOUT: Record<MonsterState, number> = {
  DORMANT: 1e9, PATROL: 45, SUSPICIOUS: 2.5, INVESTIGATE: 25, SEARCH: 22, CHASE: 40, ADAPT: 2.5, RECOVER: 40, FINAL_HUNT: 1e9,
};

const BEHAVIOR_CUES: Record<string, string[]> = {
  hiding: ['[Locker doors slam somewhere in the facility]', '[Metal doors being pried open, one after another]', '[It is opening the lockers. All of them.]'],
  noise_distraction: ['[A long, low clicking – like something listening carefully]', '[The device beeps. Nothing moves toward it.]', '[It is not fooled by that sound any more]'],
  repeated_route: ['[Heavy footsteps settle near a corridor you use often]', '[Something waits where you usually pass]', '[It knows your route]'],
  flashlight: ['[A hiss whenever the light flickers]', '[It turns toward light faster now]', '[Your light draws it in]'],
  rescue: ['[It lingers near where people fall]', '[It circles back to the wounded]', '[It waits for rescuers]'],
};

export class MonsterBrain {
  x: number;
  z: number;
  yaw = 0;
  state: MonsterState = 'DORMANT';
  stateTime = 0;
  memory = new AdaptiveMemory();
  awareness = new Map<string, number>();
  target: string | null = null;
  lastKnown: { x: number; z: number; t: number; vx: number; vz: number } | null = null;
  lastSeenEnteringLocker: string | null = null;
  private path: [number, number][] = [];
  private pathGoal: [number, number] | null = null;
  private dest: { x: number; z: number } | null = null;
  private waitTimer = 0;
  private doorPause = 0;
  private tasks: Task[] = [];
  private searchPoints: { x: number; z: number }[] = [];
  private windup = 0;
  private cooldown = 0;
  private investigateKind: string | null = null;
  private investigateDevice: string | null = null;
  private stuckRef = { x: 0, z: 0, t: 0 };
  private repathFails = 0;
  private restLeft = 0;
  chaseActive = false;
  lastChaseEnded = -999;
  private routeSeen = new Map<string, number>();
  presentation: 'calm' | 'alert' | 'hunting' | 'attacking' | 'checking' = 'calm';

  constructor(x: number, z: number, private director: Director) {
    this.x = x;
    this.z = z;
  }

  private set(s: MonsterState, w: MonsterWorld, why: string) {
    if (s === this.state) return;
    if (this.state === 'CHASE') { this.chaseActive = false; this.lastChaseEnded = w.time; }
    if (s === 'CHASE') this.chaseActive = true;
    w.telemetry(`[AI] ${this.state} → ${s} (${why})`);
    this.state = s;
    this.stateTime = 0;
    this.path = [];
    this.pathGoal = null;
    this.dest = null;
    this.waitTimer = 0;
  }

  private observe(w: MonsterWorld, behavior: BehaviorType, playerId: string | null, zone: string | null, confidence: number, weight: number, note: string) {
    const { before, after } = this.memory.observe({ behavior, playerId, zone, time: w.time, confidence, weight, note });
    w.telemetry(`[LEARN] ${behavior} +${(weight * confidence).toFixed(1)} → ${this.memory.score(behavior).toFixed(1)} (${note})`);
    if (after > before) {
      const cue = BEHAVIOR_CUES[behavior]?.[Math.min(2, after - 1)];
      w.emit('adapted', { text: cue, sound: `adapt_${behavior}`, x: this.x, z: this.z });
      w.telemetry(`[ADAPT] ${behavior} tier ${before} → ${after}`);
    }
  }

  private speed(w: MonsterWorld): number {
    const base =
      this.state === 'CHASE' ? MONSTER.speed.chase + (w.difficulty === 'hardcore' ? MONSTER.hardcoreChaseBonus : 0)
      : this.state === 'INVESTIGATE' ? MONSTER.speed.investigate
      : this.state === 'SEARCH' ? MONSTER.speed.search
      : MONSTER.speed.patrol;
    const v = w.finalHunt && this.state !== 'CHASE' ? Math.max(base, MONSTER.speed.investigate) : w.finalHunt ? MONSTER.speed.finalHunt : base;
    return Math.min(MONSTER.maxSpeed, v);
  }

  private goTo(w: MonsterWorld, x: number, z: number): boolean {
    const s = toTile(this.x, this.z), g = toTile(x, z);
    if (this.pathGoal && this.pathGoal[0] === g.tx && this.pathGoal[1] === g.ty && this.path.length) { this.dest = { x, z }; return true; }
    const p = findPath(s.tx, s.ty, g.tx, g.ty, monsterPassable((id) => w.doorLockedForMonster(id)));
    if (!p) {
      this.repathFails++;
      return false;
    }
    this.repathFails = 0;
    this.path = p;
    this.pathGoal = [g.tx, g.ty];
    this.dest = { x, z };
    return true;
  }

  /** Follows the current path; opens doors physically (pause + noise). Returns true when arrived. */
  private move(w: MonsterWorld, dt: number): boolean {
    if (this.doorPause > 0) { this.doorPause -= dt; return false; }
    if (!this.dest) return true;
    let nx: number, nz: number;
    if (this.path.length) {
      const [tx, ty] = this.path[0];
      if (tileAt(tx, ty) === Tile.Door) {
        const d = DOOR_AT.get(ty * MAP_W + tx)!;
        if (!w.doorOpen(d.id)) {
          if (w.doorLockedForMonster(d.id)) { this.path = []; this.pathGoal = null; return false; }
          w.openDoorByMonster(d.id);
          this.doorPause = 0.8; // telegraphed, never instant
          return false;
        }
      }
      ({ x: nx, z: nz } = this.path.length === 1 ? this.dest : toWorld(tx, ty));
    } else ({ x: nx, z: nz } = this.dest);
    const dx = nx - this.x, dz = nz - this.z;
    const d = Math.hypot(dx, dz);
    const step = this.speed(w) * dt;
    if (d > 1e-4) {
      const targetYaw = Math.atan2(-dx, -dz);
      let dy = targetYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += Math.max(-6 * dt, Math.min(6 * dt, dy));
    }
    if (d <= step) {
      this.x = nx; this.z = nz;
      if (this.path.length) this.path.shift();
      if (!this.path.length && Math.hypot(this.dest.x - this.x, this.dest.z - this.z) < 0.3) return true;
    } else {
      const p = collideCircle(this.x + (dx / d) * step, this.z + (dz / d) * step, MONSTER.radius * 0.8, (id) => w.doorOpen(id));
      this.x = p.x; this.z = p.z;
    }
    return false;
  }

  private randomFloorNear(w: MonsterWorld, x: number, z: number, r: number): { x: number; z: number } {
    for (let i = 0; i < 20; i++) {
      const a = w.rng.next() * Math.PI * 2, d = w.rng.next() * r;
      const p = toTile(x + Math.cos(a) * d, z + Math.sin(a) * d);
      if (tileAt(p.tx, p.ty) === Tile.Floor) return toWorld(p.tx, p.ty);
    }
    return { x, z };
  }

  private zonePoint(w: MonsterWorld, zoneId: string) {
    const zn = ZONES.find((z) => z.id === zoneId)!;
    for (let i = 0; i < 20; i++) {
      const tx = w.rng.int(zn.x0, zn.x1), ty = w.rng.int(zn.y0, zn.y1);
      if (tileAt(tx, ty) === Tile.Floor) return toWorld(tx, ty);
    }
    return toWorld(Math.round((zn.x0 + zn.x1) / 2), Math.round((zn.y0 + zn.y1) / 2));
  }

  private pickPatrolGoal(w: MonsterWorld) {
    const here = zoneAt(this.x, this.z);
    const di = this.directorInputs(w);
    const bias = this.director.missionBias(di);
    const routeTier = this.memory.tier('repeated_route');
    const hotRoute = this.memory.hottestZone('repeated_route');
    const hideTier = this.memory.tier('hiding');
    const hotHide = this.memory.hottestZone('hiding');
    const weights: [string, number][] = ZONES.filter((z) => z.id !== 'escape' && z.id !== here).map((z) => {
      let wgt = 1;
      if (z.id === di.missionZone) wgt += bias;
      if (w.finalHunt && (z.id === 'exit' || z.id === 'hall' || z.id === 'east')) wgt += 3;
      if (routeTier >= 2 && z.id === hotRoute) wgt += routeTier === 3 ? 4 : 2;
      if (hideTier >= 2 && z.id === hotHide) wgt += 1.5;
      return [z.id, wgt];
    });
    let r = w.rng.next() * weights.reduce((a, [, v]) => a + v, 0);
    let pick = weights[0][0];
    for (const [id, v] of weights) { r -= v; if (r <= 0) { pick = id; break; } }
    const p = this.zonePoint(w, pick);
    this.goTo(w, p.x, p.z);
    // Hiding adaptation, tier 3: pre-emptively check one locker in a zone where players hid before.
    if (hideTier >= 3 && pick === hotHide && w.rng.next() < 0.5) {
      const lk = LOCKERS.filter((l) => l.zone === pick);
      if (lk.length) this.tasks.push({ kind: 'locker', lockerId: w.rng.pick(lk).id });
    }
    // Route adaptation, tier 3: hold position at the hot zone for a while (an ambush that can be avoided by changing route).
    if (routeTier >= 3 && pick === hotRoute) this.waitTimer = 8;
  }

  private planSearch(w: MonsterWorld) {
    this.searchPoints = [];
    this.tasks = [];
    const lk = this.lastKnown ?? { x: this.x, z: this.z };
    // Observed hiding is certain knowledge: always check that locker first.
    if (this.lastSeenEnteringLocker) this.tasks.push({ kind: 'locker', lockerId: this.lastSeenEnteringLocker });
    const tier = this.memory.tier('hiding');
    const counts = [1, 2, 3, 4], probs = [0.2, 0.45, 0.6, 0.75]; // never 100% (GDD §18)
    const near = LOCKERS.filter((l) => l.id !== this.lastSeenEnteringLocker)
      .map((l) => ({ l, d: Math.hypot(toWorld(l.tx, l.ty).x - lk.x, toWorld(l.tx, l.ty).z - lk.z) }))
      .filter((o) => o.d < 10)
      .sort((a, b) => a.d - b.d)
      .slice(0, counts[tier]);
    for (const o of near) if (w.rng.next() < probs[tier]) this.tasks.push({ kind: 'locker', lockerId: o.l.id });
    for (let i = 0; i < 3; i++) this.searchPoints.push(this.randomFloorNear(w, lk.x, lk.z, 6));
    this.lastSeenEnteringLocker = null;
  }

  private directorInputs(w: MonsterWorld) {
    return {
      time: w.time, alive: 0, downed: 0, injured: 0, missionZone: w.missionZone(), lastChaseEnded: this.lastChaseEnded,
      chaseActive: this.chaseActive, totalDowns: 0, finalHunt: w.finalHunt,
    };
  }

  /** One fixed-timestep AI update. */
  update(w: MonsterWorld, dt: number) {
    this.stateTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.memory.tick(w.time);
    const doorOpen = (id: string) => w.doorOpen(id);
    const flashTier = this.memory.tier('flashlight');
    const seen = see(this.x, this.z, this.yaw, w.bodies(), doorOpen, dt, {
      visionBonusLit: flashTier >= 2 ? 1.15 : 1,
      lit: (x, z) => w.isLit(x, z),
    });
    const heard = this.state === 'DORMANT' ? hear(this.x, this.z, w.noises().filter((n) => n.radius >= 20), doorOpen) : hear(this.x, this.z, w.noises(), doorOpen);

    // awareness integration
    const seenIds = new Set(seen.map((s) => s.id));
    for (const [id, a] of this.awareness) if (!seenIds.has(id)) this.awareness.set(id, Math.max(0, a - dt * 0.35));
    let best: Percept | null = null;
    for (const p of seen) {
      const a = Math.min(1.5, (this.awareness.get(p.id) ?? 0) + p.gain);
      this.awareness.set(p.id, a);
      if (!best || a > (this.awareness.get(best.id) ?? 0)) best = p;
      // observations (only from what it actually sees)
      if (a > 0.5 && p.zone) {
        // one route observation per player per zone per 20 s – a single sighting is not a "habit"
        const k = `${p.id}:${p.zone}`;
        if (w.time - (this.routeSeen.get(k) ?? -1e9) > 20) { this.routeSeen.set(k, w.time); this.observe(w, 'repeated_route', p.id, p.zone, 0.4, 6, `saw player in ${p.zone}`); }
      }
      if (a > 0.5 && p.flashlight && w.rng.next() < dt * 2) this.observe(w, 'flashlight', p.id, p.zone, 0.6, 8, 'player using flashlight');
      if (p.enteringLockerId && a > 0.3) {
        if (this.lastSeenEnteringLocker !== p.enteringLockerId) this.observe(w, 'hiding', p.id, p.zone, 1, 30, `watched player enter ${p.enteringLockerId}`);
        this.lastSeenEnteringLocker = p.enteringLockerId;
      }
      if (p.reviving && a > 0.5 && w.rng.next() < dt) this.observe(w, 'rescue', p.id, p.zone, 0.8, 15, 'saw a rescue attempt');
    }
    const bestA = best ? this.awareness.get(best.id) ?? 0 : 0;

    const recovering = this.state === 'RECOVER' && this.stateTime < 5; // a real breather after downing someone
    if (best && bestA >= 1 && !best.enteringLockerId && !best.downed && !recovering && this.state !== 'CHASE' && this.state !== 'DORMANT') {
      this.target = best.id;
      this.set('CHASE', w, `confirmed ${best.id}`);
      w.emit('sound', { sound: 'roar', x: this.x, z: this.z, loud: 1, text: '[A shriek – it has seen you]' });
    }
    if (best && this.state === 'CHASE' && best.id === this.target) {
      const prev = this.lastKnown;
      const vx = prev ? (best.x - prev.x) / Math.max(dt, w.time - prev.t || dt) : 0;
      const vz = prev ? (best.z - prev.z) / Math.max(dt, w.time - prev.t || dt) : 0;
      this.lastKnown = { x: best.x, z: best.z, t: w.time, vx, vz };
    } else if (best && bestA > 0.25) {
      this.lastKnown = { x: best.x, z: best.z, t: w.time, vx: 0, vz: 0 };
    }

    switch (this.state) {
      case 'DORMANT': {
        this.presentation = 'calm';
        if (w.time >= 60 || heard.length) this.set('PATROL', w, heard.length ? 'loud noise woke it' : 'dormancy over');
        break;
      }
      case 'PATROL':
      case 'FINAL_HUNT': {
        this.presentation = 'calm';
        if (w.finalHunt && this.state !== 'FINAL_HUNT') { this.set('FINAL_HUNT', w, 'escape protocol'); break; }
        if (this.handleHearing(w, heard)) break;
        if (best && bestA > 0.3) { this.set('SUSPICIOUS', w, 'glimpse'); break; }
        if (this.tasks.length) { this.doTask(w, dt); break; }
        if (this.waitTimer > 0) { this.waitTimer -= dt; this.yaw += dt * 0.6; break; }
        if (!this.dest || this.move(w, dt)) this.pickPatrolGoal(w);
        break;
      }
      case 'SUSPICIOUS': {
        this.presentation = 'alert';
        if (this.lastKnown) this.faceTo(this.lastKnown.x, this.lastKnown.z, dt);
        if (this.stateTime > 1.2) {
          if (this.lastKnown) { this.investigateKind = 'glimpse'; this.investigateDevice = null; this.set('INVESTIGATE', w, 'checking glimpse'); this.goTo(w, this.lastKnown.x, this.lastKnown.z); }
          else this.set(w.finalHunt ? 'FINAL_HUNT' : 'PATROL', w, 'nothing');
        }
        break;
      }
      case 'INVESTIGATE': {
        this.presentation = 'alert';
        if (best && bestA > 0.3 && this.stateTime > 0.5 && this.investigateKind !== 'glimpse') { this.lastKnown = { x: best.x, z: best.z, t: w.time, vx: 0, vz: 0 }; this.goTo(w, best.x, best.z); }
        if (this.dest && !this.move(w, dt)) break;
        // arrived
        if (this.waitTimer <= 0) this.waitTimer = this.memory.tier('noise_distraction') >= 1 && this.investigateKind === 'noise_maker' ? 1 : 2.2;
        this.waitTimer -= dt;
        this.yaw += dt * 1.5;
        if (this.waitTimer <= 0) {
          if (this.investigateKind === 'noise_maker' && this.investigateDevice && w.deviceExists(this.investigateDevice)) {
            this.observe(w, 'noise_distraction', null, zoneAt(this.x, this.z), 1, 30, 'found a decoy device');
            if (this.memory.tier('noise_distraction') >= 2) {
              // counter: sweep the exits around the decoy instead of giving up
              this.searchPoints = DOORS.filter((d) => Math.hypot(toWorld(d.tx, d.ty).x - this.x, toWorld(d.tx, d.ty).z - this.z) < 14 && !w.doorLockedForMonster(d.id))
                .slice(0, 3).map((d) => toWorld(d.tx, d.ty));
              this.tasks = [];
              this.set('SEARCH', w, 'decoy: sweeping nearby exits');
              this.searchPoints = this.searchPoints.length ? this.searchPoints : [this.randomFloorNear(w, this.x, this.z, 8)];
              break;
            }
          }
          if (this.lastKnown && w.time - this.lastKnown.t < 10) { this.set('SEARCH', w, 'search area'); this.planSearch(w); }
          else this.set(w.finalHunt ? 'FINAL_HUNT' : 'PATROL', w, 'nothing found');
        }
        break;
      }
      case 'SEARCH': {
        this.presentation = 'checking';
        if (this.handleHearing(w, heard)) break;
        if (best && bestA > 0.35 && this.stateTime > 0.3) { this.lastKnown = { x: best.x, z: best.z, t: w.time, vx: 0, vz: 0 }; this.goTo(w, best.x, best.z); }
        if (this.tasks.length) { this.doTask(w, dt); break; }
        if (this.dest && !this.move(w, dt)) break;
        if (this.searchPoints.length) { const p = this.searchPoints.shift()!; this.goTo(w, p.x, p.z); break; }
        this.set('ADAPT', w, 'search exhausted');
        break;
      }
      case 'CHASE': {
        this.presentation = this.windup > 0 ? 'attacking' : 'hunting';
        const t = this.target;
        const seeing = best && best.id === t;
        // Noise-maker during chase: distracts unless the creature has learned the trick (never 100%).
        const decoy = heard.find((h) => h.kind === 'noise_maker');
        if (decoy) {
          const tier = this.memory.tier('noise_distraction');
          const ignoreP = [0, 0.3, 0.6, 0.85][tier];
          if (w.rng.next() >= ignoreP) {
            this.investigateKind = 'noise_maker';
            this.investigateDevice = decoy.deviceId ?? null;
            this.set('INVESTIGATE', w, 'lured by decoy during chase');
            this.goTo(w, decoy.x, decoy.z);
            break;
          } else {
            this.memory.counterSucceeded('noise_distraction', w.time);
            w.telemetry('[COUNTER] ignored decoy during chase');
          }
        }
        if (this.windup > 0) {
          this.windup -= dt;
          if (this.windup <= 0 && t) {
            const r = w.attack(t);
            w.telemetry(`[ATTACK] ${t}: ${r}`);
            this.cooldown = MONSTER.attackCooldown;
            if (r === 'downed') {
              this.target = null;
              this.restLeft = this.memory.tier('rescue') >= 2 ? 6 : this.director.restSeconds(this.directorInputs(w));
              this.set('RECOVER', w, 'target downed – backing off');
            }
          }
          break;
        }
        if (seeing) {
          const d = Math.hypot(best!.x - this.x, best!.z - this.z);
          this.faceTo(best!.x, best!.z, dt * 2);
          if (d <= MONSTER.attackRange && this.cooldown <= 0) {
            this.windup = MONSTER.attackWindup;
            w.emit('attack_windup', { x: this.x, z: this.z, sound: 'windup', text: '[It rears back!]' });
            break;
          }
          this.goTo(w, best!.x, best!.z);
          this.move(w, dt);
        } else {
          const lk = this.lastKnown;
          if (!lk || w.time - lk.t > 4) {
            this.set('SEARCH', w, 'lost sight');
            this.planSearch(w);
            break;
          }
          // reasonable inference: extrapolate last seen motion a little (no hidden knowledge)
          const px = lk.x + lk.vx * Math.min(1.5, w.time - lk.t), pz = lk.z + lk.vz * Math.min(1.5, w.time - lk.t);
          if (!this.goTo(w, px, pz)) this.goTo(w, lk.x, lk.z);
          if (this.move(w, dt)) { this.set('SEARCH', w, 'reached last known'); this.planSearch(w); }
        }
        break;
      }
      case 'ADAPT': {
        this.presentation = 'calm';
        if (this.stateTime > 1.5) {
          this.restLeft = this.director.restSeconds(this.directorInputs(w));
          this.set('RECOVER', w, 'regroup');
        }
        break;
      }
      case 'RECOVER': {
        this.presentation = 'calm';
        this.restLeft -= dt;
        if (!this.dest) {
          const far = ZONES.filter((z) => z.id !== 'escape' && z.id !== zoneAt(this.x, this.z));
          const p = this.zonePoint(w, w.rng.pick(far).id);
          this.goTo(w, p.x, p.z);
        }
        this.move(w, dt * 0.8);
        if (this.restLeft <= 0) this.set(w.finalHunt ? 'FINAL_HUNT' : 'PATROL', w, 'rested');
        break;
      }
    }

    // timeouts: no state can trap the AI forever (GDD §14)
    if (this.stateTime > STATE_TIMEOUT[this.state]) this.set(this.state === 'CHASE' ? 'SEARCH' : w.finalHunt ? 'FINAL_HUNT' : 'PATROL', w, 'timeout');
    this.stuckCheck(w);
  }

  private handleHearing(w: MonsterWorld, heard: Heard[]): boolean {
    if (!heard.length) return false;
    const h = heard.reduce((a, b) => (b.strength > a.strength ? b : a));
    if (h.kind === 'noise_maker') {
      const tier = this.memory.tier('noise_distraction');
      if (tier >= 3 && w.rng.next() < 0.6) {
        // learned: decoys mean someone is near an exit – check exits around the sound instead
        this.searchPoints = DOORS.filter((d) => Math.hypot(toWorld(d.tx, d.ty).x - h.x, toWorld(d.tx, d.ty).z - h.z) < 14 && !w.doorLockedForMonster(d.id)).slice(0, 3).map((d) => toWorld(d.tx, d.ty));
        if (this.searchPoints.length) { this.tasks = []; this.set('SEARCH', w, 'decoy heard: checking escape routes'); return true; }
      }
    }
    if (h.strength < 0.15 && h.kind !== 'noise_maker' && h.kind !== 'generator' && h.kind !== 'terminal') return false;
    this.investigateKind = h.kind;
    this.investigateDevice = h.deviceId ?? null;
    this.lastKnown = { x: h.x, z: h.z, t: w.time, vx: 0, vz: 0 };
    this.set('INVESTIGATE', w, `heard ${h.kind}`);
    this.goTo(w, h.x, h.z);
    return true;
  }

  private doTask(w: MonsterWorld, dt: number) {
    const task = this.tasks[0];
    const l = LOCKERS.find((x) => x.id === task.lockerId)!;
    const front = toWorld(l.tx + l.fx, l.ty + l.fy);
    if (!this.dest || this.pathGoal?.[0] !== toTile(front.x, front.z).tx || this.pathGoal?.[1] !== toTile(front.x, front.z).ty) {
      if (!this.goTo(w, front.x, front.z)) { this.tasks.shift(); return; }
    }
    if (!this.move(w, dt)) return;
    this.faceTo(toWorld(l.tx, l.ty).x, toWorld(l.tx, l.ty).z, 1);
    this.waitTimer += dt;
    if (this.waitTimer < 1.0) return; // visible reach animation (Rule E)
    this.waitTimer = 0;
    this.tasks.shift();
    const found = w.checkLocker(l.id);
    w.emit('locker_checked', { x: front.x, z: front.z, sound: 'locker_rip', loud: 0.8 });
    w.telemetry(`[CHECK] locker ${l.id}: ${found ?? 'empty'}`);
    if (found) {
      this.observe(w, 'hiding', found, l.zone, 0.9, 25, `found player in ${l.id}`);
      this.memory.counterSucceeded('hiding', w.time);
      this.target = found;
      this.awareness.set(found, 1.2);
      this.set('CHASE', w, 'pulled player out of locker');
    }
  }

  private faceTo(x: number, z: number, dt: number) {
    const targetYaw = Math.atan2(-(x - this.x), -(z - this.z));
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += Math.max(-5 * dt, Math.min(5 * dt, dy));
  }

  /** Stuck detection & navigation recovery (GDD §49, Bug 10). */
  private stuckCheck(w: MonsterWorld) {
    if (this.state === 'DORMANT' || this.waitTimer > 0 || this.doorPause > 0 || this.windup > 0 || !this.dest) { this.stuckRef = { x: this.x, z: this.z, t: w.time }; return; }
    if (w.time - this.stuckRef.t > 3) {
      if (Math.hypot(this.x - this.stuckRef.x, this.z - this.stuckRef.z) < 0.3) {
        w.telemetry('[NAV] stuck – recovering');
        this.path = [];
        this.pathGoal = null;
        this.tasks = [];
        const here = toTile(this.x, this.z);
        if (tileAt(here.tx, here.ty) !== Tile.Floor || this.repathFails > 2) {
          // snap to nearest floor tile centre within 1 tile (local, not a teleport)
          for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (tileAt(here.tx + dx, here.ty + dy) === Tile.Floor) { const p = toWorld(here.tx + dx, here.ty + dy); this.x = p.x; this.z = p.z; break; }
          }
        }
        this.set(this.state === 'CHASE' ? 'SEARCH' : w.finalHunt ? 'FINAL_HUNT' : 'PATROL', w, 'stuck recovery');
        this.dest = null;
      }
      this.stuckRef = { x: this.x, z: this.z, t: w.time };
    }
  }

  learnedSummary() {
    return [...this.memory.records.values()].map((r) => ({ behavior: r.behavior, score: Math.round(r.score), tier: tierOf(r.score), repetitions: r.repetitions }));
  }
}

export const MONSTER_TILE = TILE;
