import { describe, expect, it } from 'vitest';
import { FIXTURES, LOCKERS, toWorld } from '@itl/shared';
import { generateLayout, validateLayout } from '../../apps/server/src/simulation/spawn';
import { giveItem, input, lockerFront, makeSim, place, req, run } from '../helpers';

const fx = (k: string) => FIXTURES.find((f) => f.kind === k)!;

describe('layout generation', () => {
  it('every seed yields a solvable, deterministic layout', () => {
    for (let s = 1; s < 60; s++) {
      const l = generateLayout(s, 4);
      expect(validateLayout(l)).toBe(true);
      expect(l.items.filter((i) => i.kind === 'fuse')).toHaveLength(1);
      expect(l.items.filter((i) => i.kind === 'keycard')).toHaveLength(1);
    }
    expect(generateLayout(9, 2)).toEqual(generateLayout(9, 2));
  });
});

describe('server-authoritative interactions', () => {
  it('Scenario D: two simultaneous pickups – exactly one succeeds (Bug 1)', () => {
    const sim = makeSim(2);
    const key = [...sim.items.values()].find((i) => i.kind === 'keycard')!;
    for (const id of ['p1', 'p2']) { const p = sim.players.get(id)!; p.x = key.x + 0.4; p.z = key.z; }
    const a = sim.handleInteract('p1', { requestId: req(), entityId: key.id, action: 'pickup' });
    const b = sim.handleInteract('p2', { requestId: req(), entityId: key.id, action: 'pickup' });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, reason: 'Item no longer available' });
    const owners = [...sim.players.values()].filter((p) => p.inventory.includes('keycard'));
    expect(owners).toHaveLength(1);
    expect(sim.snapshotFor('p2')!.items.find((i) => i.id === key.id)).toBeUndefined();
  });

  it('rejects interactions from too far away and replays are idempotent', () => {
    const sim = makeSim(1);
    const key = [...sim.items.values()].find((i) => i.kind === 'keycard')!;
    const far = sim.handleInteract('p1', { requestId: 'x1', entityId: key.id, action: 'pickup' });
    expect(far).toMatchObject({ ok: false, reason: 'Too far away' });
    const p = sim.players.get('p1')!; p.x = key.x; p.z = key.z;
    expect(sim.handleInteract('p1', { requestId: 'x1', entityId: key.id, action: 'pickup' })).toEqual(far); // same requestId → cached
    expect(sim.handleInteract('p1', { requestId: 'x2', entityId: key.id, action: 'pickup' }).ok).toBe(true);
  });

  it('security door needs a keycard; powered doors need power', () => {
    const sim = makeSim(1);
    place(sim, 'p1', 7, 12);
    expect(sim.handleInteract('p1', { requestId: req(), entityId: 'door_lab_hall', action: 'use' })).toMatchObject({ ok: false, reason: 'Requires a Keycard' });
    giveItem(sim, 'p1', 'keycard');
    expect(sim.handleInteract('p1', { requestId: req(), entityId: 'door_lab_hall', action: 'use' }).ok).toBe(true);
    expect(sim.doors.door_lab_hall).toBe(true);
    place(sim, 'p1', 7, 14);
    expect(sim.handleInteract('p1', { requestId: req(), entityId: 'door_cont_hall', action: 'use' })).toMatchObject({ ok: false, reason: 'No power to this door' });
  });

  it('double revive is impossible (Bug 3) and consumes exactly one medkit', () => {
    const sim = makeSim(3);
    sim.monster.state = 'DORMANT';
    const t = sim.players.get('p3')!;
    place(sim, 'p3', 21, 22); place(sim, 'p1', 20, 22); place(sim, 'p2', 22, 22);
    t.hp = 0; t.status = 'downed'; t.downs = 1; t.downedLeft = 45;
    giveItem(sim, 'p1', 'medkit'); giveItem(sim, 'p2', 'medkit');
    expect(sim.handleInteract('p1', { requestId: req(), entityId: 'player:p3', action: 'revive' }).ok).toBe(true);
    expect(sim.handleInteract('p2', { requestId: req(), entityId: 'player:p3', action: 'revive' })).toMatchObject({ ok: false, reason: 'Someone is already reviving them' });
    sim.queueInput('p1', input({ interactHeld: true }));
    run(sim, 6.5, () => sim.queueInput('p1', input({ interactHeld: true })));
    expect(t.status).toBe('alive');
    expect(t.hp).toBe(40);
    const medkits = [...sim.players.values()].flatMap((p) => p.inventory).filter((k) => k === 'medkit');
    expect(medkits).toHaveLength(1);
  });

  it('objectives are state machines – completing twice is impossible (Bug 5)', () => {
    const sim = makeSim(2);
    const fb = fx('fuse_box');
    place(sim, 'p1', fb.tx, fb.ty + 1); place(sim, 'p2', fb.tx + 1, fb.ty + 1);
    giveItem(sim, 'p1', 'fuse'); giveItem(sim, 'p2', 'fuse');
    expect(sim.handleInteract('p1', { requestId: req(), entityId: 'fuse_box', action: 'use' }).ok).toBe(true);
    expect(sim.handleInteract('p2', { requestId: req(), entityId: 'fuse_box', action: 'use' })).toMatchObject({ ok: false, reason: 'Fuse already installed' });
    expect(sim.players.get('p2')!.inventory).toContain('fuse');
  });

  it('stale or replayed inputs are ignored (Bug 9)', () => {
    const sim = makeSim(1);
    sim.queueInput('p1', { ...input(), seq: 100 });
    sim.queueInput('p1', { ...input(), seq: 99 });
    sim.queueInput('p1', { ...input(), seq: 100 });
    expect(sim.players.get('p1')!.inputs).toHaveLength(1);
  });

  it('client cannot send arbitrary values: speed is clamped by shared movement', () => {
    const sim = makeSim(1);
    const p = sim.players.get('p1')!;
    const z0 = p.z;
    run(sim, 1, () => sim.queueInput('p1', input({ mz: 50, run: true })));
    expect(z0 - p.z).toBeLessThanOrEqual(4.6);
  });

  it('a dead player drops critical items so missions stay completable', () => {
    const sim = makeSim(2);
    giveItem(sim, 'p1', 'keycard');
    const p = sim.players.get('p1')!;
    p.downs = 2; p.hp = 10; p.status = 'alive';
    sim.monster.x = p.x + 1; sim.monster.z = p.z;
    sim.attack('p1');
    expect(p.status).toBe('dead');
    expect([...sim.items.values()].some((i) => i.kind === 'keycard' && i.state === 'world' && i.id.startsWith('drop_'))).toBe(true);
  });

  it('full mission chain (headless): power → data → protocol → escape → result', () => {
    const sim = makeSim(1, 7);
    const s = () => sim.handleInteract('p1', { requestId: req(), entityId: '', action: '' });
    void s;
    const p = sim.players.get('p1')!;
    const act = (entityId: string, action = 'use', payload?: { code?: string }) => sim.handleInteract('p1', { requestId: req(), entityId, action, payload });
    // keep the creature asleep far away for this functional test
    sim.monster.x = toWorld(7, 26).x; sim.monster.z = toWorld(7, 26).z;
    const freeze = () => { sim.monster.state = 'DORMANT'; sim.monster.x = toWorld(7, 26).x; sim.monster.z = toWorld(7, 26).z; };
    giveItem(sim, 'p1', 'fuse');
    place(sim, 'p1', 31, 2);
    expect(act('fuse_box').ok).toBe(true);
    place(sim, 'p1', 39, 6);
    expect(act('generator').ok).toBe(true);
    run(sim, 16, freeze);
    expect(sim.generator.done).toBe(true);
    giveItem(sim, 'p1', 'keycard');
    place(sim, 'p1', 7, 12);
    expect(act('door_lab_hall').ok).toBe(true);
    place(sim, 'p1', 10, 9);
    expect(act('whiteboard').ok).toBe(true);
    place(sim, 'p1', 6, 5);
    expect(act('terminal', 'enter_code', { code: '0000' }).ok).toBe(false);
    expect(act('terminal', 'enter_code', { code: p.knownCode! }).ok).toBe(true);
    run(sim, 31, freeze);
    expect(sim.terminal.done).toBe(true);
    place(sim, 'p1', 3, 27);
    // containment door is powered: open path not needed in harness, switches validated by proximity
    expect(act('switch_a').ok).toBe(true);
    place(sim, 'p1', 41, 2);
    expect(act('switch_b').ok).toBe(true);
    expect(sim.protocolDone).toBe(true);
    place(sim, 'p1', 37, 22);
    expect(act('door_emergency').ok).toBe(true);
    run(sim, 3.5, () => { freeze(); sim.queueInput('p1', input({ interactHeld: true })); });
    expect(sim.exitOpen).toBe(true);
    expect(sim.finalHunt).toBe(true);
    place(sim, 'p1', 40, 22);
    run(sim, 0.2, freeze);
    expect(p.status).toBe('escaped');
    expect(sim.result).toMatchObject({ outcome: 'escaped_all', missionsCompleted: 3 });
  });

  it('final hunt timer leaves stragglers behind', () => {
    const sim = makeSim(1);
    sim.exitOpen = true; sim.finalHunt = true; sim.finalLeft = 1; sim.protocolDone = true;
    run(sim, 1.2, () => { sim.monster.state = 'DORMANT'; });
    expect(sim.result?.outcome).toBe('wiped');
  });

  it('disconnect keeps the player vulnerable; leaving drops their items', () => {
    const sim = makeSim(2);
    giveItem(sim, 'p1', 'fuse');
    sim.setConnected('p1', false);
    expect(sim.players.get('p1')!.status).toBe('alive');
    sim.removePlayer('p1');
    expect([...sim.items.values()].some((i) => i.kind === 'fuse' && i.id.startsWith('drop_'))).toBe(true);
    expect(sim.result).toBeNull(); // p2 still inside
  });

  it('lockers hide players from sight and only one player fits', () => {
    const sim = makeSim(2);
    const l = LOCKERS[11]; // reception locker
    const [fx2, fy2] = lockerFront(l.id);
    place(sim, 'p1', fx2, fy2); place(sim, 'p2', fx2, fy2);
    expect(sim.handleInteract('p1', { requestId: req(), entityId: l.id, action: 'enter' }).ok).toBe(true);
    expect(sim.handleInteract('p2', { requestId: req(), entityId: l.id, action: 'enter' })).toMatchObject({ ok: false, reason: 'Someone is already inside' });
    expect(sim.bodies().find((b) => b.id === 'p1')!.status).toBe('hidden');
  });
});
