/** Gameplay constants (GDD §9, §12, §24). Tunable – keep server & client in sync by importing from here. */
export const TILE = 1.5; // metres per map tile
export const WALL_HEIGHT = 3;
export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.65;
export const CROUCH_EYE_HEIGHT = 1.0;

export const SPEED = { walk: 2.8, run: 4.5, crouch: 1.5, crawl: 0.7 } as const;
export const STAMINA = { max: 100, runCostPerSec: 100 / 12, regenPerSec: 8, regenDelay: 1.5 } as const;
export const HEALTH_MAX = 100;
export const INVENTORY_SLOTS = 4;

export const DOWNED = { duration: 45, reviveTime: 6, reviveHp: 40, maxDowns: 2, selfReviveTime: 8 } as const;

export const TICK_RATE = 30; // server simulation Hz
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // ticks → 15 Hz
export const INTERP_DELAY_MS = 120;
export const MAX_INPUT_BUFFER = 12;

export const INTERACT_RANGE = 2.2;
export const RECONNECT_SECONDS = 60;
export const MAX_PLAYERS = 4;

export const FLASHLIGHT = { drainPerSec: 100 / 300, batteryRestore: 60 } as const;

export const MONSTER = {
  radius: 0.5,
  speed: { patrol: 2.0, investigate: 2.7, search: 2.3, chase: 4.15, finalHunt: 4.35 },
  hardcoreChaseBonus: 0.15,
  maxSpeed: 4.5, // hard cap (GDD §20: no arbitrary speed-ups)
  attackRange: 1.7,
  attackHitRange: 2.1,
  attackWindup: 0.6,
  attackCooldown: 1.6,
  damage: 34,
  hardcoreDamage: 50,
  visionFov: (110 * Math.PI) / 180,
  visionRangeDark: 11,
  visionRangeLit: 20,
  confirmTime: 0.7, // seconds of clear sight to confirm a target
  monsterRevealRange: 28, // snapshot culling: clients only get the monster when near / in sight
} as const;

/** Noise radii in metres (GDD §15 hearing). */
export const NOISE = {
  run: 9,
  walk: 3,
  door: 8,
  drop: 6,
  generator: 24,
  terminal: 16,
  noiseMaker: 28,
  distress: 12,
  lockerSlam: 7,
  exitDoor: 30,
} as const;

export const MISSION = {
  generatorSpinUp: 15,
  downloadTime: 30,
  switchWindowSolo: 90,
  switchWindowCoop: 25,
  exitHoldTime: 3,
  finalHuntTime: 150,
  dormantSeconds: 60,
} as const;

export type Difficulty = 'standard' | 'hardcore';
