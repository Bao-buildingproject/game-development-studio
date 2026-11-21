/**
 * Behavioral memory & adaptive scoring (GDD §16–17).
 * Updated = clamp(prev × decay + weight × confidence, 0, 100). Only fed by perception-backed observations.
 * Memory lives per match – never carried into the next match (GDD §16).
 */
export type BehaviorType = 'hiding' | 'noise_distraction' | 'repeated_route' | 'flashlight' | 'grouping' | 'rescue';

export interface Observation {
  behavior: BehaviorType;
  playerId: string | null;
  zone: string | null;
  time: number;
  confidence: number; // 0..1
  weight: number; // evidence weight
  note: string;
}

export interface BehaviorRecord {
  behavior: BehaviorType;
  score: number;
  repetitions: number;
  lastObserved: number;
  lastSuccessfulCounter: number | null;
  expiresAt: number;
  zones: Record<string, number>;
  log: Observation[];
}

export const TIERS = [
  { min: 75, label: 'overt counter-tactics' },
  { min: 50, label: 'changed priorities' },
  { min: 25, label: 'extra checks nearby' },
  { min: 0, label: 'normal observation' },
] as const;
export const tierOf = (score: number) => (score >= 75 ? 3 : score >= 50 ? 2 : score >= 25 ? 1 : 0);

export const MEMORY_CONFIG = {
  decayOnObservation: 0.92,
  passiveDecayPerMinute: 0.9, // idle forgetting
  maxSingleGain: 35, // GDD: one action can never max out the AI
  expirySeconds: 300,
};

export class AdaptiveMemory {
  records = new Map<BehaviorType, BehaviorRecord>();
  private lastDecay = 0;

  record(b: BehaviorType): BehaviorRecord {
    let r = this.records.get(b);
    if (!r) {
      r = { behavior: b, score: 0, repetitions: 0, lastObserved: -1, lastSuccessfulCounter: null, expiresAt: 0, zones: {}, log: [] };
      this.records.set(b, r);
    }
    return r;
  }

  score(b: BehaviorType): number {
    return this.records.get(b)?.score ?? 0;
  }
  tier(b: BehaviorType): number {
    return tierOf(this.score(b));
  }

  /** Returns {before, after} tiers so callers can emit a perceivable cue when behaviour shifts (Rule F). */
  observe(o: Observation): { before: number; after: number } {
    const r = this.record(o.behavior);
    const before = tierOf(r.score);
    const gain = Math.min(MEMORY_CONFIG.maxSingleGain, o.weight * Math.max(0, Math.min(1, o.confidence)));
    r.score = Math.max(0, Math.min(100, r.score * MEMORY_CONFIG.decayOnObservation + gain));
    r.repetitions++;
    r.lastObserved = o.time;
    r.expiresAt = o.time + MEMORY_CONFIG.expirySeconds;
    if (o.zone) r.zones[o.zone] = (r.zones[o.zone] ?? 0) + o.confidence;
    r.log.push(o);
    if (r.log.length > 40) r.log.shift();
    return { before, after: tierOf(r.score) };
  }

  counterSucceeded(b: BehaviorType, time: number) {
    this.record(b).lastSuccessfulCounter = time;
  }

  /** Time-based forgetting + expiry, call once per second. */
  tick(time: number) {
    if (time - this.lastDecay < 1) return;
    const k = Math.pow(MEMORY_CONFIG.passiveDecayPerMinute, (time - this.lastDecay) / 60);
    this.lastDecay = time;
    for (const r of this.records.values()) {
      r.score *= k;
      if (time > r.expiresAt) r.score *= 0.5;
      for (const z of Object.keys(r.zones)) r.zones[z] *= k;
    }
  }

  hottestZone(b: BehaviorType): string | null {
    const r = this.records.get(b);
    if (!r) return null;
    let best: string | null = null, bv = 0.5;
    for (const [z, v] of Object.entries(r.zones)) if (v > bv) { bv = v; best = z; }
    return best;
  }
}
