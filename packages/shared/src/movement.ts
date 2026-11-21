import { PLAYER_RADIUS, SPEED, STAMINA, TILE } from './constants';
import { DoorOpenFn, isBlocking, toTile } from './map';

export interface MoveInput {
  seq: number;
  mx: number; // strafe −1..1
  mz: number; // forward −1..1
  yaw: number;
  pitch: number;
  run: boolean;
  crouch: boolean;
  interactHeld: boolean;
}

export interface MoveState {
  x: number;
  z: number;
  stamina: number;
  staminaDelay: number;
  mode: 'walk' | 'run' | 'crouch' | 'crawl' | 'idle';
}

/** Circle-vs-tile collision resolve, axis separated. Shared by server simulation and client prediction. */
export function collideCircle(x: number, z: number, r: number, doorOpen: DoorOpenFn): { x: number; z: number } {
  const { tx, ty } = toTile(x, z);
  for (let iy = ty - 1; iy <= ty + 1; iy++) {
    for (let ix = tx - 1; ix <= tx + 1; ix++) {
      if (!isBlocking(ix, iy, doorOpen)) continue;
      const minX = ix * TILE, maxX = minX + TILE, minZ = iy * TILE, maxZ = minZ + TILE;
      const cx = Math.max(minX, Math.min(x, maxX));
      const cz = Math.max(minZ, Math.min(z, maxZ));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // centre inside the tile: push out along the smallest penetration axis
          const pen = [x - minX, maxX - x, z - minZ, maxZ - z];
          const m = Math.min(...pen);
          if (m === pen[0]) x = minX - r; else if (m === pen[1]) x = maxX + r; else if (m === pen[2]) z = minZ - r; else z = maxZ + r;
        }
      }
    }
  }
  return { x, z };
}

/**
 * Deterministic movement step (fixed dt). Same function runs on server (authority) and client (prediction),
 * so reconciliation only corrects real divergence (GDD §25, Bug 8: FPS-independent).
 */
export function stepMovement(s: MoveState, input: MoveInput, dt: number, doorOpen: DoorOpenFn, opts: { downed: boolean }): MoveState {
  let mx = Math.max(-1, Math.min(1, input.mx)), mz = Math.max(-1, Math.min(1, input.mz));
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = len > 0.01;
  let stamina = s.stamina, delay = s.staminaDelay;
  let mode: MoveState['mode'] = 'idle';
  let speed = 0;
  if (opts.downed) { mode = moving ? 'crawl' : 'idle'; speed = SPEED.crawl; }
  else if (moving) {
    if (input.crouch) { mode = 'crouch'; speed = SPEED.crouch; }
    else if (input.run && stamina > 0 && mz > 0.1) { mode = 'run'; speed = SPEED.run; }
    else { mode = 'walk'; speed = SPEED.walk; }
  }
  if (mode === 'run') {
    stamina = Math.max(0, stamina - STAMINA.runCostPerSec * dt);
    delay = STAMINA.regenDelay;
  } else if (delay > 0) delay = Math.max(0, delay - dt);
  else stamina = Math.min(STAMINA.max, stamina + STAMINA.regenPerSec * dt);

  // yaw = 0 looks toward −z
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  const fx = -sin, fz = -cos; // forward
  const rx = cos, rz = -sin; // right
  const vx = (fx * mz + rx * mx) * speed, vz = (fz * mz + rz * mx) * speed;
  let x = s.x + vx * dt;
  let p = collideCircle(x, s.z, PLAYER_RADIUS, doorOpen);
  x = p.x;
  let z = p.z + vz * dt;
  p = collideCircle(x, z, PLAYER_RADIUS, doorOpen);
  return { x: p.x, z: p.z, stamina, staminaDelay: delay, mode };
}
