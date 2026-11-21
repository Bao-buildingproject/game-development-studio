import { DOORS, FIXTURES, ITEM_SPOTS, ItemKind, MAP_W, PLAYER_SPAWNS, Tile, createRng, tileAt, DOOR_AT, ZONES } from '@itl/shared';
import { reachable } from '../ai/pathfinding';

export interface SpawnedItem { id: string; kind: ItemKind; tx: number; ty: number; docIndex?: number }
export interface MatchLayout {
  seed: number;
  items: SpawnedItem[];
  terminalCode: string;
  doorsOpen: Record<string, boolean>;
  patrolStartZone: string;
  attempts: number;
}

export const LORE_DOCUMENTS = [
  { title: 'SYNAPSE // Project Brief 47-A', body: 'Objective: an organism that builds predictive models of the people around it. Success metric: time-to-prediction after first observation.' },
  { title: 'Lab Notebook – Dr. Hale', body: 'Day 41. It stopped reacting to the bell. It reacts to the *person who rings it*. When I changed the routine, it watched me for an hour.' },
  { title: 'Incident Report 0912', body: 'Subject 47 ignored a repeated diversion stimulus on the third trial and moved to the observation exit instead. Recommend randomising protocols.' },
  { title: 'Maintenance Memo', body: 'Lockers on B4 keep getting dented from the INSIDE of the containment wing. Facilities says "pressure differential". Sure.' },
  { title: 'Final Log – Security Control', body: 'It is not learning to escape. It is learning *us*. If you are reading this: do not do the same thing twice.' },
] as const;

function freeSpots(zones: string[], used: Set<string>): [number, number][] {
  return zones.flatMap((z) => ITEM_SPOTS[z] ?? []).filter(([x, y]) => !used.has(`${x},${y}`));
}

/** Seeded layout + solvability check (GDD §33: server verifies there is a path to finish every mission). */
export function generateLayout(seed: number, playerCount: number): MatchLayout {
  for (let attempt = 0; attempt < 25; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const rng = createRng(s);
    const used = new Set<string>();
    const items: SpawnedItem[] = [];
    let n = 0;
    const place = (kind: ItemKind, zones: string[], extra: Partial<SpawnedItem> = {}) => {
      const spots = freeSpots(zones, used);
      if (!spots.length) return false;
      const [tx, ty] = rng.pick(spots);
      used.add(`${tx},${ty}`);
      items.push({ id: `item_${++n}`, kind, tx, ty, ...extra });
      return true;
    };
    place('fuse', ['reception', 'archive', 'exit', 'hall', 'east', 'west']);
    place('keycard', ['maintenance', 'archive', 'exit', 'east', 'containment']);
    for (let i = 0; i < (playerCount >= 3 ? 3 : 2); i++) place('medkit', ['reception', 'archive', 'exit', 'hall', 'containment', 'maintenance']);
    for (let i = 0; i < 3; i++) place('battery', ['reception', 'archive', 'hall', 'west', 'east', 'maintenance', 'laboratory']);
    for (let i = 0; i < 3; i++) place('noise_maker', ['reception', 'hall', 'archive', 'exit', 'maintenance', 'containment']);
    const docZones = rng.shuffle(['laboratory', 'archive', 'containment', 'maintenance', 'exit']);
    LORE_DOCUMENTS.forEach((_, i) => place('document', [docZones[i]], { docIndex: i }));

    const doorsOpen: Record<string, boolean> = {};
    for (const d of DOORS) doorsOpen[d.id] = d.kind === 'normal' ? (rng.next() < 0.5 ? d.startsOpen : !d.startsOpen) : false;
    const layout: MatchLayout = {
      seed: s,
      items,
      terminalCode: String(rng.int(1000, 9999)),
      doorsOpen,
      patrolStartZone: rng.pick(['hall', 'east', 'west', 'containment']),
      attempts: attempt + 1,
    };
    if (validateLayout(layout)) return layout;
  }
  throw new Error('Could not generate a solvable layout');
}

/** Progressive reachability: each mission stage unlocks door kinds; every required item/fixture must be reachable in time. */
export function validateLayout(layout: MatchLayout): boolean {
  const [sx, sy] = PLAYER_SPAWNS[0];
  const stage = (kinds: string[]) =>
    reachable(sx, sy, (tx, ty) => {
      const t = tileAt(tx, ty);
      if (t === Tile.Floor) return true;
      if (t === Tile.Door) return kinds.includes(DOOR_AT.get(ty * MAP_W + tx)!.kind);
      return false;
    });
  const near = (set: Set<number>, tx: number, ty: number) =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => set.has((ty + dy) * MAP_W + tx + dx));
  const fx = (k: string) => FIXTURES.find((f) => f.kind === k)!;
  const item = (k: ItemKind) => layout.items.find((i) => i.kind === k);

  const s0 = stage(['normal']);
  const fuse = item('fuse'), key = item('keycard');
  if (!fuse || !key) return false;
  if (!near(s0, fuse.tx, fuse.ty) || !near(s0, fx('fuse_box').tx, fx('fuse_box').ty) || !near(s0, fx('generator').tx, fx('generator').ty)) return false;
  const s1 = stage(['normal', 'powered']);
  if (!near(s1, key.tx, key.ty)) return false;
  const s2 = stage(['normal', 'powered', 'security']);
  for (const k of ['terminal', 'whiteboard', 'switch_a', 'switch_b']) if (!near(s2, fx(k).tx, fx(k).ty)) return false;
  const s3 = stage(['normal', 'powered', 'security', 'exit']);
  const esc = ZONES.find((z) => z.id === 'escape')!;
  if (!s3.has(esc.y0 * MAP_W + esc.x0)) return false;
  return layout.items.every((i) => near(s2, i.tx, i.ty));
}
