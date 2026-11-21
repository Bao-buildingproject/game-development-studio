import { describe, expect, it } from 'vitest';
import { AdaptiveMemory, MEMORY_CONFIG, tierOf } from '../../apps/server/src/ai/memory';

describe('adaptive memory', () => {
  it('applies Updated = clamp(prev × decay + weight × confidence)', () => {
    const m = new AdaptiveMemory();
    m.observe({ behavior: 'hiding', playerId: 'p1', zone: 'lab', time: 1, confidence: 1, weight: 30, note: '' });
    expect(m.score('hiding')).toBe(30);
    m.observe({ behavior: 'hiding', playerId: 'p1', zone: 'lab', time: 2, confidence: 0.5, weight: 20, note: '' });
    expect(m.score('hiding')).toBeCloseTo(30 * MEMORY_CONFIG.decayOnObservation + 10);
  });
  it('a single action can never max out adaptation', () => {
    const m = new AdaptiveMemory();
    m.observe({ behavior: 'hiding', playerId: null, zone: null, time: 0, confidence: 1, weight: 1000, note: '' });
    expect(m.score('hiding')).toBeLessThanOrEqual(MEMORY_CONFIG.maxSingleGain);
    expect(tierOf(m.score('hiding'))).toBeLessThan(3);
  });
  it('stays within 0..100 and forgets over time', () => {
    const m = new AdaptiveMemory();
    for (let i = 0; i < 50; i++) m.observe({ behavior: 'noise_distraction', playerId: null, zone: null, time: i, confidence: 1, weight: 30, note: '' });
    expect(m.score('noise_distraction')).toBeLessThanOrEqual(100);
    const before = m.score('noise_distraction');
    for (let t = 50; t < 600; t++) m.tick(t);
    expect(m.score('noise_distraction')).toBeLessThan(before * 0.2);
  });
  it('reports tier changes for perceivable cues', () => {
    const m = new AdaptiveMemory();
    const r = m.observe({ behavior: 'hiding', playerId: null, zone: null, time: 0, confidence: 1, weight: 30, note: '' });
    expect(r).toEqual({ before: 0, after: 1 });
  });
});
