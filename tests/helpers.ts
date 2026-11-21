import { InputMsg, LOCKERS, toWorld } from '@itl/shared';
import { GameSimulation } from '../apps/server/src/simulation/game';

export function makeSim(n = 1, seed = 42, difficulty: 'standard' | 'hardcore' = 'standard') {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, character: (['vega', 'ortiz', 'kim', 'adeyemi'] as const)[i] }));
  return new GameSimulation({ seed, difficulty, players });
}
let seq = 0;
export function input(over: Partial<InputMsg> = {}): InputMsg {
  return { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, run: false, crouch: false, interactHeld: false, flashlight: false, ...over };
}
/** Test harness: place a player at a tile (headless tests only). */
export function place(sim: GameSimulation, id: string, tx: number, ty: number) {
  const p = sim.players.get(id)!;
  const w = toWorld(tx, ty);
  p.x = w.x; p.z = w.z;
}
export function run(sim: GameSimulation, seconds: number, each?: () => void) {
  for (let i = 0; i < Math.round(seconds * 30); i++) { each?.(); sim.step(); }
}
export function giveItem(sim: GameSimulation, id: string, kind: 'fuse' | 'keycard' | 'medkit' | 'battery' | 'noise_maker') {
  const p = sim.players.get(id)!;
  p.inventory[p.inventory.indexOf(null)] = kind;
}
export const lockerFront = (id: string) => { const l = LOCKERS.find((x) => x.id === id)!; return [l.tx + l.fx, l.ty + l.fy] as [number, number]; };
let rq = 0;
export const req = () => `r${++rq}`;
