import { describe, expect, it } from 'vitest';

import { buildHomeSections, hostingNudge } from './home';

const now = new Date('2030-06-15T12:00:00Z');
const hosted = (id: string, starts_at: string | null, cancelled = false) => ({
  id,
  starts_at,
  ends_at: null,
  cancelled_at: cancelled ? '2030-06-01T00:00:00Z' : null,
});
const invite = (
  id: string,
  starts_at: string,
  state: 'active' | 'past' | 'cancelled' = 'active',
) => ({
  id,
  starts_at,
  ends_at: null,
  state,
});

describe('buildHomeSections', () => {
  it('lists date-pending events first among upcoming, never as past (add-date-polls)', () => {
    const s = buildHomeSections(
      [hosted('h1', '2030-06-20T18:00:00Z'), hosted('poll', null), hosted('old', '2030-06-01T18:00:00Z')],
      [invite('i1', '2030-06-16T18:00:00Z')],
      now,
    );
    expect(s.upcoming.map((i) => i.id)).toEqual(['poll', 'i1', 'h1']);
    expect(s.past.map((i) => i.id)).toEqual(['old']);
  });

  it('sorts upcoming ascending and past descending, across hosted and invites', () => {
    const s = buildHomeSections(
      [hosted('h1', '2030-06-20T18:00:00Z'), hosted('h0', '2030-06-01T18:00:00Z')],
      [invite('i1', '2030-06-16T18:00:00Z'), invite('i0', '2030-06-10T18:00:00Z', 'past')],
      now,
    );
    expect(s.upcoming.map((i) => i.id)).toEqual(['i1', 'h1']);
    expect(s.past.map((i) => i.id)).toEqual(['i0', 'h0']);
    expect(s.upcoming.map((i) => i.kind)).toEqual(['invite', 'hosted']);
  });

  it('keeps cancelled events in their time bucket with a flag', () => {
    const s = buildHomeSections(
      [hosted('h', '2030-06-20T18:00:00Z', true)],
      [
        invite('a', '2030-06-18T18:00:00Z', 'cancelled'),
        invite('b', '2030-06-01T18:00:00Z', 'cancelled'),
      ],
      now,
    );
    expect(s.upcoming.map((i) => [i.id, i.cancelled])).toEqual([
      ['a', true],
      ['h', true],
    ]);
    expect(s.past.map((i) => [i.id, i.cancelled, i.past])).toEqual([['b', true, true]]);
  });

  it('shows an event that is both hosted and invited once, as hosted', () => {
    const s = buildHomeSections(
      [hosted('x', '2030-06-20T18:00:00Z')],
      [invite('x', '2030-06-20T18:00:00Z')],
      now,
    );
    expect(s.upcoming).toHaveLength(1);
    expect(s.upcoming[0]!.kind).toBe('hosted');
  });

  it('treats an event as ongoing until 12 hours after start when it has no end', () => {
    const s = buildHomeSections([], [invite('now', '2030-06-15T02:00:00Z')], now);
    expect(s.upcoming.map((i) => i.id)).toEqual(['now']);
  });
});

describe('hostingNudge', () => {
  it('is the empty state with nothing at all', () => {
    expect(hostingNudge(buildHomeSections([], [], now))).toBe('empty');
  });
  it('is the card with upcoming invites but no upcoming hosted events', () => {
    expect(
      hostingNudge(
        buildHomeSections(
          [hosted('h', '2030-06-01T18:00:00Z')],
          [invite('i', '2030-06-20T18:00:00Z')],
          now,
        ),
      ),
    ).toBe('card');
  });
  it('is nothing when the user hosts an upcoming event', () => {
    expect(
      hostingNudge(
        buildHomeSections(
          [hosted('h', '2030-06-21T18:00:00Z')],
          [invite('i', '2030-06-20T18:00:00Z')],
          now,
        ),
      ),
    ).toBe(null);
  });
  it('ignores cancelled invites', () => {
    expect(
      hostingNudge(buildHomeSections([], [invite('i', '2030-06-20T18:00:00Z', 'cancelled')], now)),
    ).toBe(null);
  });
});
