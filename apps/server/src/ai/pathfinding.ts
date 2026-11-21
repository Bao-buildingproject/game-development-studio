import { DOOR_AT, MAP_H, MAP_W, Tile, tileAt } from '@itl/shared';

export type Passable = (tx: number, ty: number) => boolean;

/** Monster passability: floor + doors it can open (normal doors, unlocked others). Lockers/props/walls block. */
export function monsterPassable(doorLocked: (doorId: string) => boolean): Passable {
  return (tx, ty) => {
    const t = tileAt(tx, ty);
    if (t === Tile.Floor) return true;
    if (t === Tile.Door) return !doorLocked(DOOR_AT.get(ty * MAP_W + tx)!.id);
    return false;
  };
}

/** 8-neighbour A* on the tile grid (no corner cutting). Returns tile path excluding start, or null. */
export function findPath(sx: number, sy: number, gx: number, gy: number, pass: Passable, maxNodes = 4000): [number, number][] | null {
  if (!pass(gx, gy)) return null;
  const idx = (x: number, y: number) => y * MAP_W + x;
  const g = new Float32Array(MAP_W * MAP_H).fill(Infinity);
  const came = new Int32Array(MAP_W * MAP_H).fill(-1);
  const closed = new Uint8Array(MAP_W * MAP_H);
  const open: { i: number; f: number }[] = [];
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const s = idx(sx, sy);
  g[s] = 0;
  open.push({ i: s, f: h(sx, sy) });
  let expanded = 0;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const { i } = open.splice(bi, 1)[0];
    if (closed[i]) continue;
    closed[i] = 1;
    if (++expanded > maxNodes) return null;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    if (x === gx && y === gy) {
      const path: [number, number][] = [];
      let c = i;
      while (c !== s) { path.push([c % MAP_W, (c / MAP_W) | 0]); c = came[c]; }
      return path.reverse();
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || !pass(nx, ny)) continue;
      if (dx && dy && (!pass(x + dx, y) || !pass(x, y + dy))) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const ng = g[i] + (dx && dy ? Math.SQRT2 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = i; open.push({ i: ni, f: ng + h(nx, ny) }); }
    }
  }
  return null;
}

/** Flood fill reachability for spawn validation. */
export function reachable(sx: number, sy: number, pass: Passable): Set<number> {
  const seen = new Set<number>([sy * MAP_W + sx]);
  const q: [number, number][] = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * MAP_W + nx;
      if (!seen.has(k) && pass(nx, ny)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}
