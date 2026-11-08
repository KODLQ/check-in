import { describe, expect, it } from 'vitest';
import { formatEventTime, formatRelativeTime, formatTimeRange, hasEventEnded } from './dates';

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

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  it('says now for under a minute', () => {
    expect(formatRelativeTime(new Date('2026-11-08T11:59:30Z'), 'en', now)).toBe('now');
    expect(formatRelativeTime(new Date('2026-11-08T11:59:30Z'), 'sv', now)).toBe('nu');
  });
  it('uses the largest unit', () => {
    expect(formatRelativeTime(new Date('2026-11-08T09:00:00Z'), 'en', now)).toBe('3 hours ago');
    expect(formatRelativeTime(new Date('2026-11-07T12:00:00Z'), 'en', now)).toBe('yesterday');
  });
});

describe('formatRelativeTime without Intl.RelativeTimeFormat', () => {
  it('falls back to simple strings', () => {
    const intl = Intl as { RelativeTimeFormat?: unknown };
    const original = intl.RelativeTimeFormat;
    intl.RelativeTimeFormat = undefined; // simulate Hermes
    try {
      const now = new Date('2026-11-08T12:00:00Z');
      expect(formatRelativeTime(new Date('2026-11-08T11:55:00Z'), 'en', now)).toBe('5 min ago');
      expect(formatRelativeTime(new Date('2026-11-08T09:00:00Z'), 'sv', now)).toBe('för 3 tim sedan');
      expect(formatRelativeTime(new Date('2026-11-07T11:00:00Z'), 'en', now)).toBe('yesterday');
    } finally {
      intl.RelativeTimeFormat = original;
    }
  });
});
