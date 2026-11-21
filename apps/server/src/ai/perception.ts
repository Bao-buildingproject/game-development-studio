import { DoorOpenFn, MONSTER, lineOfSight, zoneAt } from '@itl/shared';

/** Raw body info the simulation exposes ONLY to the perception layer (GDD §15, §48). */
export interface Body {
  id: string;
  x: number;
  z: number;
  status: 'alive' | 'downed' | 'dead' | 'escaped' | 'hidden';
  mode: string;
  flashlight: boolean;
  enteringLockerId: string | null; // visible only during the short "climbing in" window
  reviving: boolean;
}

export interface NoiseEvent { x: number; z: number; radius: number; kind: string; time: number; deviceId?: string }

export interface Percept {
  id: string;
  x: number;
  z: number;
  zone: string | null;
  gain: number; // awareness gained this tick
  downed: boolean;
  flashlight: boolean;
  enteringLockerId: string | null;
  reviving: boolean;
}
export interface Heard { x: number; z: number; kind: string; strength: number; deviceId?: string }

export interface PerceptionOpts { visionBonusLit: number; lit: (x: number, z: number) => boolean }

/** Vision: finite FOV + range, LOS, light & motion modifiers, proximity sense. No x-ray, no global knowledge. */
export function see(mx: number, mz: number, yaw: number, bodies: Body[], doorOpen: DoorOpenFn, dt: number, opts: PerceptionOpts): Percept[] {
  const out: Percept[] = [];
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (const b of bodies) {
    if (b.status === 'dead' || b.status === 'escaped') continue;
    if (b.status === 'hidden' && !b.enteringLockerId) continue;
    const dx = b.x - mx, dz = b.z - mz;
    const dist = Math.hypot(dx, dz);
    let range: number = b.flashlight ? MONSTER.visionRangeLit * opts.visionBonusLit : MONSTER.visionRangeDark;
    if (opts.lit(b.x, b.z)) range = Math.max(range, MONSTER.visionRangeLit * 0.8);
    if (b.mode === 'crouch' || b.status === 'downed') range *= 0.6;
    if (b.mode === 'run') range *= 1.15;
    const proximity = dist < 2.2;
    if (dist > range && !proximity) continue;
    const cos = dist > 1e-6 ? (dx * fx + dz * fz) / dist : 1;
    if (!proximity && cos < Math.cos(MONSTER.visionFov / 2)) continue;
    if (!lineOfSight(mx, mz, b.x, b.z, doorOpen)) continue;
    const closeness = 1 - Math.min(1, dist / Math.max(range, 0.1));
    const motion = b.mode === 'run' ? 1.4 : b.mode === 'idle' || b.mode === 'crouch' ? 0.6 : 1;
    const gain = (dt / MONSTER.confirmTime) * (0.35 + closeness) * motion * (proximity ? 2 : 1);
    out.push({ id: b.id, x: b.x, z: b.z, zone: zoneAt(b.x, b.z), gain, downed: b.status === 'downed', flashlight: b.flashlight, enteringLockerId: b.enteringLockerId, reviving: b.reviving });
  }
  return out;
}

/** Hearing: radius-based with wall attenuation (sound travels, but muffled). */
export function hear(mx: number, mz: number, noises: NoiseEvent[], doorOpen: DoorOpenFn): Heard[] {
  const out: Heard[] = [];
  for (const n of noises) {
    const d = Math.hypot(n.x - mx, n.z - mz);
    const radius = lineOfSight(mx, mz, n.x, n.z, doorOpen) ? n.radius : n.radius * 0.6;
    if (d <= radius) out.push({ x: n.x, z: n.z, kind: n.kind, strength: 1 - d / radius, deviceId: n.deviceId });
  }
  return out;
}
