import { describe, expect, it } from 'vitest';
import type { MoveState } from '@itl/shared';
import { DOORS, GRID, MAP_W, SPEED, STAMINA, Tile, asciiMap, createRng, lineOfSight, stepMovement, toWorld, LOCKERS, FIXTURES, PLAYER_SPAWNS, tileAt } from '@itl/shared';

const allOpen = () => true, allClosed = () => false;

describe('map', () => {
  it('has the expected size and features', () => {
    expect(GRID.length).toBe(MAP_W * 30);
    const a = asciiMap();
    expect(a.split('\n')).toHaveLength(30);
    expect(DOORS.every((d) => tileAt(d.tx, d.ty) === Tile.Door)).toBe(true);
    expect(LOCKERS.every((l) => tileAt(l.tx, l.ty) === Tile.Locker && tileAt(l.tx + l.fx, l.ty + l.fy) === Tile.Floor)).toBe(true);
    expect(FIXTURES.filter((f) => !f.solid).every((f) => tileAt(f.tx, f.ty) === Tile.Floor)).toBe(true);
    expect(PLAYER_SPAWNS.every(([x, y]) => tileAt(x, y) === Tile.Floor)).toBe(true);
  });
  it('line of sight is blocked by walls and closed doors only', () => {
    const lab = toWorld(7, 9), hall = toWorld(7, 13);
    expect(lineOfSight(lab.x, lab.z, hall.x, hall.z, allClosed)).toBe(false);
    expect(lineOfSight(lab.x, lab.z, hall.x, hall.z, allOpen)).toBe(true);
    const a = toWorld(5, 13), b = toWorld(30, 13);
    expect(lineOfSight(a.x, a.z, b.x, b.z, allClosed)).toBe(true);
    const r = toWorld(21, 20), lab2 = toWorld(5, 5);
    expect(lineOfSight(r.x, r.z, lab2.x, lab2.z, allOpen)).toBe(false);
  });
});

describe('movement (shared prediction = authority)', () => {
  const base: MoveState = { x: toWorld(21, 22).x, z: toWorld(21, 22).z, stamina: 100, staminaDelay: 0, mode: 'idle' };
  const inp = (o = {}) => ({ seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, run: false, crouch: false, interactHeld: false, ...o });
  it('is deterministic and frame-rate independent (fixed dt)', () => {
    let a = base, b = base;
    for (let i = 0; i < 30; i++) a = stepMovement(a, inp(), 1 / 30, allOpen, { downed: false });
    for (let i = 0; i < 30; i++) b = stepMovement(b, inp(), 1 / 30, allOpen, { downed: false });
    expect(a).toEqual(b);
    expect(base.z - a.z).toBeCloseTo(SPEED.walk, 1);
  });
  it('running drains stamina in about 12 s, then regenerates after a delay', () => {
    let s: MoveState = { ...base, z: toWorld(21, 28).z };
    let t = 0;
    while (s.stamina > 0 && t < 20) { s = stepMovement(s, inp({ run: true, yaw: Math.PI / 2 }), 1 / 30, allOpen, { downed: false }); s = { ...s, x: base.x }; t += 1 / 30; }
    expect(t).toBeGreaterThan(11);
    expect(t).toBeLessThan(13);
    for (let i = 0; i < 30; i++) s = stepMovement(s, inp({ mz: 0 }), 1 / 30, allOpen, { downed: false });
    expect(s.stamina).toBe(0);
    for (let i = 0; i < 30; i++) s = stepMovement(s, inp({ mz: 0 }), 1 / 30, allOpen, { downed: false });
    expect(s.stamina).toBeCloseTo(STAMINA.regenPerSec * (2 - STAMINA.regenDelay), 0); // 1.5 s delay, then 8/s
  });
  it('cannot pass through walls or closed doors', () => {
    let s: MoveState = { ...base, x: toWorld(21, 16).x, z: toWorld(21, 16).z };
    for (let i = 0; i < 120; i++) s = stepMovement(s, inp(), 1 / 30, allClosed, { downed: false });
    expect(s.z).toBeGreaterThan(16 * 1.5);
  });
});

describe('rng', () => {
  it('is seeded', () => {
    const a = createRng(5), b = createRng(5);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});
