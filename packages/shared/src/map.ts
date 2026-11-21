import { TILE } from './constants';

/** SYNAPSE FACILITY – B4 (MVP map, GDD §28–30). Built from rectangles so it stays readable and testable. */
export const MAP_W = 44;
export const MAP_H = 30;

export const enum Tile { Floor = 0, Wall = 1, Door = 2, Locker = 3, Prop = 4 }

export type ZoneId = 'reception' | 'laboratory' | 'archive' | 'maintenance' | 'containment' | 'exit' | 'escape' | 'hall' | 'west' | 'east';
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface ZoneDef extends Rect { id: ZoneId; name: string; mvpZone: boolean }
export type DoorKind = 'normal' | 'security' | 'powered' | 'exit';
export interface DoorDef { id: string; tx: number; ty: number; kind: DoorKind; startsOpen: boolean; vertical: boolean }
export interface LockerDef { id: string; tx: number; ty: number; fx: number; fy: number; zone: ZoneId }
export type FixtureKind = 'fuse_box' | 'generator' | 'terminal' | 'whiteboard' | 'switch_a' | 'switch_b';
export interface FixtureDef { id: string; kind: FixtureKind; tx: number; ty: number; solid: boolean; label: string }

export const ZONES: ZoneDef[] = [
  { id: 'laboratory', name: 'Research Laboratory', x0: 1, y0: 1, x1: 13, y1: 10, mvpZone: true },
  { id: 'archive', name: 'Records Archive', x0: 18, y0: 1, x1: 25, y1: 10, mvpZone: false },
  { id: 'maintenance', name: 'Maintenance', x0: 30, y0: 1, x1: 42, y1: 10, mvpZone: true },
  { id: 'hall', name: 'Central Hall', x0: 1, y0: 12, x1: 42, y1: 14, mvpZone: false },
  { id: 'west', name: 'West Corridor', x0: 15, y0: 1, x1: 16, y1: 28, mvpZone: false },
  { id: 'east', name: 'East Corridor', x0: 27, y0: 1, x1: 28, y1: 28, mvpZone: false },
  { id: 'containment', name: 'Containment', x0: 1, y0: 16, x1: 13, y1: 28, mvpZone: true },
  { id: 'reception', name: 'Reception (Lobby)', x0: 18, y0: 16, x1: 25, y1: 28, mvpZone: true },
  { id: 'exit', name: 'Emergency Exit', x0: 30, y0: 16, x1: 37, y1: 28, mvpZone: true },
  { id: 'escape', name: 'Evacuation Lift', x0: 39, y0: 16, x1: 42, y1: 28, mvpZone: false },
];

export const DOORS: DoorDef[] = [
  { id: 'door_lab_hall', tx: 7, ty: 11, kind: 'security', startsOpen: false, vertical: false },
  { id: 'door_lab_west', tx: 14, ty: 6, kind: 'security', startsOpen: false, vertical: true },
  { id: 'door_archive_hall', tx: 21, ty: 11, kind: 'normal', startsOpen: true, vertical: false },
  { id: 'door_archive_west', tx: 17, ty: 4, kind: 'normal', startsOpen: false, vertical: true },
  { id: 'door_maint_hall', tx: 35, ty: 11, kind: 'normal', startsOpen: false, vertical: false },
  { id: 'door_maint_east', tx: 29, ty: 5, kind: 'normal', startsOpen: true, vertical: true },
  { id: 'door_cont_hall', tx: 7, ty: 15, kind: 'powered', startsOpen: false, vertical: false },
  { id: 'door_cont_west', tx: 14, ty: 22, kind: 'powered', startsOpen: false, vertical: true },
  { id: 'door_rec_hall', tx: 21, ty: 15, kind: 'normal', startsOpen: true, vertical: false },
  { id: 'door_rec_west', tx: 17, ty: 24, kind: 'normal', startsOpen: false, vertical: true },
  { id: 'door_rec_east', tx: 26, ty: 24, kind: 'normal', startsOpen: false, vertical: true },
  { id: 'door_exit_hall', tx: 33, ty: 15, kind: 'normal', startsOpen: false, vertical: false },
  { id: 'door_exit_east', tx: 29, ty: 22, kind: 'normal', startsOpen: true, vertical: true },
  { id: 'door_emergency', tx: 38, ty: 22, kind: 'exit', startsOpen: false, vertical: true },
];

const L = (id: string, tx: number, ty: number, fx: number, fy: number, zone: ZoneId): LockerDef => ({ id, tx, ty, fx, fy, zone });
export const LOCKERS: LockerDef[] = [
  L('locker_lab_1', 1, 3, 1, 0, 'laboratory'), L('locker_lab_2', 1, 4, 1, 0, 'laboratory'), L('locker_lab_3', 12, 1, 0, 1, 'laboratory'),
  L('locker_arc_1', 18, 8, 1, 0, 'archive'), L('locker_arc_2', 25, 2, -1, 0, 'archive'), L('locker_arc_3', 25, 3, -1, 0, 'archive'),
  L('locker_mnt_1', 42, 9, -1, 0, 'maintenance'), L('locker_mnt_2', 30, 9, 1, 0, 'maintenance'),
  L('locker_cnt_1', 1, 20, 1, 0, 'containment'), L('locker_cnt_2', 13, 27, -1, 0, 'containment'), L('locker_cnt_3', 1, 21, 1, 0, 'containment'),
  L('locker_rec_1', 18, 18, 1, 0, 'reception'), L('locker_rec_2', 25, 27, -1, 0, 'reception'),
  L('locker_exit_1', 30, 27, 1, 0, 'exit'), L('locker_exit_2', 37, 17, -1, 0, 'exit'),
  L('locker_hall_1', 3, 12, 0, 1, 'hall'), L('locker_hall_2', 40, 14, 0, -1, 'hall'),
];

export const FIXTURES: FixtureDef[] = [
  { id: 'fuse_box', kind: 'fuse_box', tx: 31, ty: 1, solid: false, label: 'Fuse box' },
  { id: 'generator', kind: 'generator', tx: 40, ty: 6, solid: true, label: 'Backup generator' },
  { id: 'terminal', kind: 'terminal', tx: 6, ty: 4, solid: true, label: 'Research terminal' },
  { id: 'whiteboard', kind: 'whiteboard', tx: 10, ty: 10, solid: false, label: 'Whiteboard' },
  { id: 'switch_a', kind: 'switch_a', tx: 3, ty: 28, solid: false, label: 'Containment override switch' },
  { id: 'switch_b', kind: 'switch_b', tx: 41, ty: 1, solid: false, label: 'Maintenance override switch' },
];

/** Item spawn candidates per zone (tile coords). Server picks with the match seed. */
export const ITEM_SPOTS: Record<string, [number, number][]> = {
  reception: [[20, 18], [23, 21], [19, 26], [24, 25], [22, 27]],
  archive: [[19, 2], [22, 5], [24, 8], [20, 9]],
  maintenance: [[33, 3], [37, 8], [32, 7], [39, 2]],
  laboratory: [[3, 2], [9, 7], [11, 3], [4, 9]],
  containment: [[5, 18], [9, 24], [11, 19], [4, 26]],
  exit: [[32, 18], [35, 25], [33, 21]],
  hall: [[10, 13], [30, 13], [24, 12], [41, 13]],
  west: [[15, 8], [16, 20]],
  east: [[28, 8], [27, 19]],
};

export const PLAYER_SPAWNS: [number, number][] = [[20, 23], [23, 23], [20, 25], [23, 25]];
export const MONSTER_SPAWN: [number, number] = [7, 22]; // containment cell

function build(): Uint8Array {
  const g = new Uint8Array(MAP_W * MAP_H).fill(Tile.Wall);
  for (const z of ZONES) for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) g[y * MAP_W + x] = Tile.Floor;
  for (const d of DOORS) g[d.ty * MAP_W + d.tx] = Tile.Door;
  for (const l of LOCKERS) g[l.ty * MAP_W + l.tx] = Tile.Locker;
  for (const f of FIXTURES) if (f.solid) g[f.ty * MAP_W + f.tx] = Tile.Prop;
  return g;
}
export const GRID = build();

export const tileAt = (tx: number, ty: number): Tile =>
  tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? Tile.Wall : (GRID[ty * MAP_W + tx] as Tile);

export const DOOR_AT = new Map(DOORS.map((d) => [d.ty * MAP_W + d.tx, d]));

export const toWorld = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE, z: (ty + 0.5) * TILE });
export const toTile = (x: number, z: number) => ({ tx: Math.floor(x / TILE), ty: Math.floor(z / TILE) });

export function zoneAt(x: number, z: number): ZoneId | null {
  const { tx, ty } = toTile(x, z);
  for (const zn of ZONES) if (tx >= zn.x0 && tx <= zn.x1 && ty >= zn.y0 && ty <= zn.y1) return zn.id;
  return null;
}

/** Door state lookup supplied by caller (server state or last known snapshot on the client). */
export type DoorOpenFn = (doorId: string) => boolean;

export function isBlocking(tx: number, ty: number, doorOpen: DoorOpenFn): boolean {
  const t = tileAt(tx, ty);
  if (t === Tile.Floor) return false;
  if (t === Tile.Door) return !doorOpen(DOOR_AT.get(ty * MAP_W + tx)!.id);
  return true;
}

/** Grid DDA line-of-sight between two world points (GDD Rule A: no seeing through walls/closed doors/lockers). */
export function lineOfSight(ax: number, az: number, bx: number, bz: number, doorOpen: DoorOpenFn): boolean {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const steps = Math.ceil(dist / (TILE * 0.25));
  const start = toTile(ax, az), end = toTile(bx, bz);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const { tx, ty } = toTile(ax + dx * t, az + dz * t);
    if ((tx === start.tx && ty === start.ty) || (tx === end.tx && ty === end.ty)) continue;
    if (isBlocking(tx, ty, doorOpen)) return false;
  }
  return true;
}

/** ASCII render for debugging & tests. */
export function asciiMap(): string {
  const ch = ['.', '#', 'D', 'L', 'P'];
  const rows: string[] = [];
  for (let y = 0; y < MAP_H; y++) {
    let r = '';
    for (let x = 0; x < MAP_W; x++) r += ch[GRID[y * MAP_W + x]];
    rows.push(r);
  }
  return rows.join('\n');
}
