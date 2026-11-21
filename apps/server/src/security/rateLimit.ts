/** Token bucket in simulation time (GDD §52 rate limiting). */
export class RateLimiter {
  private tokens: number;
  private last = 0;
  constructor(private capacity: number, private perSecondFactor: number) {
    this.tokens = capacity;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.capacity * this.perSecondFactor);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
