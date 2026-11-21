/**
 * AI Director (GDD §20): controls overall pressure, NOT how the creature hunts.
 * It only uses match-level signals (alive/downed counts, chase timing, mission stage) – never secret positions for targeting.
 */
export interface DirectorInputs {
  time: number;
  alive: number;
  downed: number;
  injured: number;
  missionZone: string | null;
  lastChaseEnded: number;
  chaseActive: boolean;
  totalDowns: number;
  finalHunt: boolean;
}

export class Director {
  tension = 0;
  private lastScare = -999;

  update(i: DirectorInputs, dt: number) {
    let target = 0.2;
    if (i.chaseActive) target = 1;
    else if (i.time - i.lastChaseEnded < 25) target = 0.7;
    target += i.downed * 0.25 + i.injured * 0.05;
    this.tension += (Math.min(1.2, target) - this.tension) * Math.min(1, dt * 0.5);
  }

  /** Breather after a chase: higher tension ⇒ longer rest (bounded). */
  restSeconds(i: DirectorInputs): number {
    if (i.finalHunt) return 4;
    const base = 8 + this.tension * 14 + i.downed * 6;
    return Math.min(28, base);
  }

  /** How strongly patrols lean toward the current (publicly known) mission area. */
  missionBias(i: DirectorInputs): number {
    if (i.finalHunt) return 3;
    const quiet = i.time - i.lastChaseEnded;
    return quiet > 90 ? 2.5 : quiet > 45 ? 1.5 : 0.6;
  }

  /** Scare Director: rare ambient events, never during chases or right after them (GDD §36). */
  wantsAmbientScare(i: DirectorInputs, roll: number): boolean {
    if (i.time < 45 || i.chaseActive || i.time - i.lastChaseEnded < 30 || i.time - this.lastScare < 40 || this.tension > 0.6) return false;
    if (roll < 0.02) {
      this.lastScare = i.time;
      return true;
    }
    return false;
  }
}
