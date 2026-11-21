import { describe, expect, it } from 'vitest';
import { LOCKERS, MONSTER, TILE, toWorld, Tile, tileAt, createRng } from '@itl/shared';
import { see } from '../../apps/server/src/ai/perception';
import { MonsterBrain } from '../../apps/server/src/ai/monster';
import { Director } from '../../apps/server/src/ai/director';
import { input, lockerFront, makeSim, place, req, run } from '../helpers';

describe('perception & fairness rules', () => {
  it('Rule A: cannot see through walls even when facing the player', () => {
    const m = toWorld(7, 9); // lab, facing south toward the hall through a wall
    const body = { id: 'p', ...toWorld(7, 13), status: 'alive' as const, mode: 'run', flashlight: true, enteringLockerId: null, reviving: false };
    const r = see(m.x, m.z, Math.PI, [body], () => false, 1, { visionBonusLit: 1, lit: () => true });
    expect(r).toHaveLength(0);
    const r2 = see(m.x, m.z, Math.PI, [body], () => true, 1, { visionBonusLit: 1, lit: () => true });
    expect(r2).toHaveLength(1);
  });
  it('Rule C: hidden players are invisible unless seen climbing in', () => {
    const m = toWorld(21, 20);
    const base = { id: 'p', ...toWorld(21, 23), mode: 'idle', flashlight: false, reviving: false };
    expect(see(m.x, m.z, Math.PI, [{ ...base, status: 'hidden', enteringLockerId: null }], () => true, 1, { visionBonusLit: 1, lit: () => false })).toHaveLength(0);
    expect(see(m.x, m.z, Math.PI, [{ ...base, status: 'hidden', enteringLockerId: 'locker_rec_1' }], () => true, 1, { visionBonusLit: 1, lit: () => false })).toHaveLength(1);
  });
  it('needs time to confirm a target (no instant detection)', () => {
    const m = toWorld(21, 17);
    const body = { id: 'p', ...toWorld(21, 24), status: 'alive' as const, mode: 'walk', flashlight: false, enteringLockerId: null, reviving: false };
    const r = see(m.x, m.z, Math.PI, [body], () => true, 1 / 30, { visionBonusLit: 1, lit: () => false });
    expect(r[0].gain).toBeLessThan(0.1);
  });
});

describe('adaptation 1 – learning from hiding (GDD §18)', () => {
  it('watching players enter lockers raises hiding tier and expands locker checks, never to 100%', () => {
    const sim = makeSim(1, 3);
    const brain = sim.monster;
    const l = LOCKERS.find((x) => x.id === 'locker_rec_1')!;
    for (let i = 0; i < 4; i++) {
      brain.memory.observe({ behavior: 'hiding', playerId: 'p1', zone: 'reception', time: i, confidence: 1, weight: 30, note: 'test' });
    }
    expect(brain.memory.tier('hiding')).toBeGreaterThanOrEqual(2);
    // statistical check of search planning: higher tier ⇒ more locker checks than a naive creature
    const checks = (b: MonsterBrain) => {
      let total = 0;
      for (let k = 0; k < 200; k++) {
        b.lastKnown = { ...toWorld(l.tx + 1, l.ty), t: 0, vx: 0, vz: 0 };
        (b as unknown as { planSearch: (w: unknown) => void }).planSearch(sim);
        total += (b as unknown as { tasks: unknown[] }).tasks.length;
      }
      return total / 200;
    };
    const naive = new MonsterBrain(0, 0, new Director());
    const learned = checks(brain), base = checks(naive);
    expect(learned).toBeGreaterThan(base + 0.5);
    expect(learned).toBeLessThan(4); // never checks every nearby locker with certainty
  });

  it('end-to-end: seen entering a locker ⇒ creature checks THAT locker and pulls the player out', () => {
    const sim = makeSim(1, 11);
    const l = LOCKERS.find((x) => x.id === 'locker_rec_1')!;
    const [fx, fy] = lockerFront(l.id);
    place(sim, 'p1', fx, fy);
    const m = sim.monster;
    const mp = toWorld(22, 18);
    m.x = mp.x; m.z = mp.z; m.yaw = Math.atan2(-(toWorld(fx, fy).x - mp.x), -(toWorld(fx, fy).z - mp.z));
    m.state = 'PATROL';
    sim.time = 100;
    expect(sim.handleInteract('p1', { requestId: req(), entityId: l.id, action: 'enter' }).ok).toBe(true);
    let pulled = false;
    run(sim, 20, () => { if (sim.players.get('p1')!.status === 'alive' && !sim.players.get('p1')!.lockerId) pulled = true; sim.queueInput('p1', input()); });
    expect(m.memory.score('hiding')).toBeGreaterThan(0);
    expect(pulled || sim.players.get('p1')!.status === 'downed').toBe(true);
    expect(sim.telemetryLog.some((l2) => l2.includes('[CHECK] locker locker_rec_1: p1'))).toBe(true);
  });
});

describe('adaptation 2 – learning from noise decoys (GDD §57 Scenario B)', () => {
  it('repeated decoys raise the noise tier; a learned creature often ignores decoys mid-chase', () => {
    const trial = (tier: number) => {
      let ignored = 0;
      for (let k = 0; k < 100; k++) {
        const sim = makeSim(1, 100 + k);
        const m = sim.monster;
        for (let i = 0; i < tier; i++) m.memory.observe({ behavior: 'noise_distraction', playerId: null, zone: 'hall', time: 0, confidence: 1, weight: 30, note: '' });
        const p = sim.players.get('p1')!;
        place(sim, 'p1', 20, 13);
        const mp = toWorld(30, 13);
        m.x = mp.x; m.z = mp.z; m.yaw = Math.PI / 2; m.state = 'CHASE'; m.target = 'p1'; m.chaseActive = true;
        m.lastKnown = { x: p.x, z: p.z, t: 0, vx: 0, vz: 0 };
        sim.devices.set('device_t', { id: 'device_t', ...toWorld(36, 13), pulses: 1, nextPulse: 0 });
        sim.step();
        if (m.state === 'CHASE') ignored++;
      }
      return ignored;
    };
    const naive = trial(0), learned = trial(4);
    expect(naive).toBeLessThan(15);
    expect(learned).toBeGreaterThan(45);
    expect(learned).toBeLessThan(100); // counterplay still exists
  });

  it('finding a spent decoy device is recorded as a noise_distraction observation', () => {
    const sim = makeSim(1, 5);
    const m = sim.monster;
    m.state = 'PATROL';
    sim.time = 70;
    const d = toWorld(24, 13);
    const mp = toWorld(30, 13);
    m.x = mp.x; m.z = mp.z;
    place(sim, 'p1', 21, 26);
    sim.devices.set('device_x', { id: 'device_x', x: d.x, z: d.z, pulses: 3, nextPulse: sim.time });
    run(sim, 15, () => sim.queueInput('p1', input()));
    expect(m.memory.score('noise_distraction')).toBeGreaterThan(0);
    expect(sim.telemetryLog.some((l) => l.includes('found a decoy device'))).toBe(true);
  });
});

describe('navigation soak test (Bug 10, Rule B)', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 8 simulated minutes – never teleports, never stuck for long`, () => {
      const sim = makeSim(2, seed);
      const rng = createRng(seed);
      let prev = { x: sim.monster.x, z: sim.monster.z };
      let maxStep = 0;
      let lastMoveT = 0;
      let longestStill = 0;
      let yaw = 0;
      run(sim, 480, () => {
        // two wandering bots that also make noise
        if (sim.tick % 45 === 0) yaw = rng.range(-Math.PI, Math.PI);
        for (const id of ['p1', 'p2']) {
          const p = sim.players.get(id)!;
          if (p.status === 'downed') { p.status = 'alive'; p.hp = 100; p.downs = 0; } // keep bots alive for the soak
          sim.queueInput(id, input({ mz: 1, yaw: yaw + (id === 'p2' ? 1 : 0), run: rng.next() < 0.2 }));
        }
        const m = sim.monster;
        const step = Math.hypot(m.x - prev.x, m.z - prev.z);
        maxStep = Math.max(maxStep, step);
        if (step > 0.01 || m.state === 'DORMANT') lastMoveT = sim.time;
        longestStill = Math.max(longestStill, sim.time - lastMoveT);
        prev = { x: m.x, z: m.z };
        const t = tileAt(Math.floor(m.x / TILE), Math.floor(m.z / TILE));
        expect(t === Tile.Floor || t === Tile.Door).toBe(true);
      });
      expect(maxStep).toBeLessThanOrEqual(Math.max(MONSTER.maxSpeed / 30 + 0.01, TILE + 0.01));
      expect(longestStill).toBeLessThan(30);
      expect(sim.telemetryLog.some((l) => l.includes('→ CHASE') || l.includes('→ INVESTIGATE'))).toBe(true);
    });
  }
});
