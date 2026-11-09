import { describe, expect, it } from 'vitest';

import { deletedVoteCount, leadingOptionId, pickOutcome, pollNeedsPick, tally, unchangedOptionIds } from './polls';

const t = (yes: number, if_needed = 0, no = 0) => ({ yes, if_needed, no });

describe('leadingOptionId', () => {
  it('highlights the option with most Yes', () => {
    expect(leadingOptionId([{ id: 'a', tallies: t(1, 5) }, { id: 'b', tallies: t(3) }])).toBe('b');
  });
  it('breaks Yes ties with If needed', () => {
    expect(leadingOptionId([{ id: 'a', tallies: t(2, 1) }, { id: 'b', tallies: t(2, 3) }])).toBe('b');
  });
  it('highlights nothing without votes or on a full tie', () => {
    expect(leadingOptionId([{ id: 'a', tallies: t(0, 0, 4) }, { id: 'b', tallies: t(0) }])).toBeNull();
    expect(leadingOptionId([{ id: 'a', tallies: t(2, 1) }, { id: 'b', tallies: t(2, 1) }])).toBeNull();
  });
});

describe('tally', () => {
  it('counts answers per option', () => {
    const votes = [
      { option_id: 'a', choice: 'yes' as const },
      { option_id: 'a', choice: 'no' as const },
      { option_id: 'b', choice: 'yes' as const },
      { option_id: 'a', choice: 'yes' as const },
    ];
    expect(tally(votes, 'a')).toEqual(t(2, 0, 1));
  });
});

describe('pickOutcome', () => {
  it('converts Yes to Going and If needed to Maybe', () => {
    expect(pickOutcome(t(5, 2), null)).toEqual({ going: 5, waitlisted: 0, maybe: 2 });
  });
  it('waitlists Yes voters beyond the capacity', () => {
    expect(pickOutcome(t(5, 2), 3)).toEqual({ going: 3, waitlisted: 2, maybe: 2 });
  });
});

describe('editing options', () => {
  const original = [
    { id: 'a', starts_at: '2030-01-01T18:00:00.000Z', ends_at: null },
    { id: 'b', starts_at: '2030-01-02T18:00:00.000Z', ends_at: '2030-01-02T22:00:00.000Z' },
    { id: 'c', starts_at: '2030-01-03T18:00:00.000Z', ends_at: null },
  ];
  const votes = [
    { option_id: 'a' },
    { option_id: 'b' },
    { option_id: 'c' },
    { option_id: 'c' },
    { option_id: 'c' },
  ];
  const same = (o: (typeof original)[number]) => ({
    id: o.id,
    startsAt: new Date(o.starts_at),
    endsAt: o.ends_at ? new Date(o.ends_at) : null,
  });

  it('removing an option with 3 votes deletes 3', () => {
    expect(deletedVoteCount(original, [same(original[0]!), same(original[1]!)], votes)).toBe(3);
  });
  it('adding an option deletes none', () => {
    const edited = [...original.map(same), { startsAt: new Date('2030-01-04T18:00:00Z') }];
    expect(deletedVoteCount(original, edited, votes)).toBe(0);
  });
  it('re-timing an option deletes its votes, including an end-time change', () => {
    const edited = original.map(same);
    edited[1] = { ...edited[1]!, endsAt: null };
    expect(unchangedOptionIds(original, edited)).toEqual(['a', 'c']);
    expect(deletedVoteCount(original, edited, votes)).toBe(1);
  });
});

describe('pollNeedsPick', () => {
  const now = new Date('2030-01-01T12:00:00Z');
  const options = [{ starts_at: '2030-01-02T18:00:00Z' }, { starts_at: '2030-01-03T18:00:00Z' }];
  it('is false while voting is open', () => expect(pollNeedsPick({ closes_at: null, options }, now)).toBe(false));
  it('is true after the deadline', () =>
    expect(pollNeedsPick({ closes_at: '2030-01-01T11:00:00Z', options }, now)).toBe(true));
  it('is true when every option has passed', () =>
    expect(pollNeedsPick({ closes_at: null, options }, new Date('2030-01-04T00:00:00Z'))).toBe(true));
});
