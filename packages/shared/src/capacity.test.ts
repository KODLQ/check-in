import { describe, expect, it } from 'vitest';
import { formatHeads, headCount, headsOf, sortWaitlist, spotsLeft } from './capacity';

describe('headCount', () => {
  const rsvps = [
    { status: 'going', plus_ones: 0 },
    { status: 'going', plus_ones: 1 },
    { status: 'going', plus_ones: 2 },
    { status: 'maybe', plus_ones: 0 },
    { status: 'declined', plus_ones: 0 },
    { status: 'waitlisted', plus_ones: 3 },
  ];
  it('counts Going guests plus their plus-ones only', () => expect(headCount(rsvps)).toBe(6));
  it('counts waitlisted heads on request', () => expect(headCount(rsvps, 'waitlisted')).toBe(4));
  it('treats missing plus-ones as none', () => expect(headCount([{ status: 'going' }])).toBe(1));
  it('is 0 for no responses', () => expect(headCount([])).toBe(0));
  it('headsOf is 1 + plus-ones', () => expect(headsOf({ status: 'going', plus_ones: 3 })).toBe(4));
});

describe('capacity helpers', () => {
  it('formats heads against capacity', () => {
    expect(formatHeads(14, 30)).toBe('14 / 30');
    expect(formatHeads(12, 10)).toBe('12 / 10');
    expect(formatHeads(14, null)).toBe('14');
  });
  it('spots left never goes negative', () => {
    expect(spotsLeft(6, 10)).toBe(4);
    expect(spotsLeft(12, 10)).toBe(0);
    expect(spotsLeft(3, null)).toBeNull();
  });
  it('orders the waitlist by waitlisted_at, then id', () => {
    const rows = [
      { id: 'b', waitlisted_at: '2026-01-01T10:00:00Z' },
      { id: 'c', waitlisted_at: '2026-01-01T09:00:00Z' },
      { id: 'a', waitlisted_at: '2026-01-01T10:00:00Z' },
    ];
    expect(sortWaitlist(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
