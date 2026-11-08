import { describe, expect, it } from 'vitest';
import { formatEventTime, formatTimeRange, hasEventEnded } from './dates';

describe('hasEventEnded', () => {
  const start = new Date('2026-12-12T19:00:00Z');
  it('uses end time when set', () => {
    const end = new Date('2026-12-12T23:00:00Z');
    expect(hasEventEnded(start, end, new Date('2026-12-12T22:59:00Z'))).toBe(false);
    expect(hasEventEnded(start, end, new Date('2026-12-12T23:01:00Z'))).toBe(true);
  });
  it('falls back to 12 hours after start', () => {
    expect(hasEventEnded(start, null, new Date('2026-12-13T06:59:00Z'))).toBe(false);
    expect(hasEventEnded(start, null, new Date('2026-12-13T07:01:00Z'))).toBe(true);
  });
});

describe('formatting', () => {
  const start = new Date('2026-12-12T19:00:00Z'); // 20:00 in Stockholm
  it('formats in Stockholm time', () => {
    expect(formatEventTime(start, 'en')).toContain('20:00');
    expect(formatEventTime(start, 'sv')).toMatch(/lör/);
  });
  it('shortens same-day ranges', () => {
    expect(formatTimeRange(start, new Date('2026-12-12T22:00:00Z'), 'en')).toMatch(/– 23:00$/);
  });
});
