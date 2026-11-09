import { describe, expect, it } from 'vitest';
import {
  announcementInputSchema,
  ballotInputSchema,
  fieldErrors,
  makeDatePollInputSchema,
  makeEventInputSchema,
  pollErrors,
  rsvpInputSchema,
  VOTE_CHOICES,
} from './schemas';

const now = new Date('2026-06-01T12:00:00Z');
const schema = makeEventInputSchema(() => now);
const valid = {
  title: 'Midsommar',
  startsAt: new Date('2026-06-19T16:00:00Z'),
  locationText: 'Djurgården',
};

describe('event input', () => {
  it('accepts a minimal event and applies default theme', () => {
    const r = schema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data?.theme).toBe('sunset');
  });

  it.each([
    ['title', { title: '   ' }, 'title_required'],
    ['locationText', { locationText: '' }, 'location_required'],
    ['startsAt', { startsAt: new Date('2026-05-01T00:00:00Z') }, 'start_in_past'],
    ['endsAt', { endsAt: new Date('2026-06-19T15:00:00Z') }, 'end_before_start'],
    ['latitude', { latitude: 59.3 }, 'invalid_location'],
  ])('rejects invalid %s', (field, patch, key) => {
    const errs = fieldErrors(schema.safeParse({ ...valid, ...patch }));
    expect(errs?.[field]).toBe(key);
  });

  it('reports missing start time', () => {
    const { startsAt: _s, ...rest } = valid;
    expect(fieldErrors(schema.safeParse(rest))?.startsAt).toBe('start_required');
  });

  it('turns empty optional text into undefined', () => {
    expect(schema.parse({ ...valid, description: '  ' }).description).toBeUndefined();
  });
});

describe('rsvp input', () => {
  const ok = {
    token: 'AbCdEf123456',
    guestToken: 'x'.repeat(22),
    displayName: ' Anna ',
    status: 'going',
  };
  it('trims names', () => expect(rsvpInputSchema.parse(ok).displayName).toBe('Anna'));
  it('requires a name', () =>
    expect(fieldErrors(rsvpInputSchema.safeParse({ ...ok, displayName: ' ' }))?.displayName).toBe(
      'name_required',
    ));
  it('rejects malformed invite tokens', () =>
    expect(rsvpInputSchema.safeParse({ ...ok, token: 'short' }).success).toBe(false));
});

describe('rsvp email updates', () => {
  const base = {
    token: 'AbCdEf123456',
    guestToken: 'x'.repeat(22),
    displayName: 'Anna',
    status: 'going',
  };
  it('accepts an email with consent and normalises it', () => {
    const r = rsvpInputSchema.parse({ ...base, email: '  Anna@Example.COM ', emailConsent: true, locale: 'sv' });
    expect(r.email).toBe('anna@example.com');
    expect(r.locale).toBe('sv');
  });
  it('requires consent for a non-empty email', () =>
    expect(fieldErrors(rsvpInputSchema.safeParse({ ...base, email: 'anna@example.com' }))?.emailConsent).toBe(
      'consent_required',
    ));
  it('requires consent to be ticked, not just present', () =>
    expect(
      fieldErrors(rsvpInputSchema.safeParse({ ...base, email: 'anna@example.com', emailConsent: false }))
        ?.emailConsent,
    ).toBe('consent_required'));
  it('rejects a malformed email', () =>
    expect(
      fieldErrors(rsvpInputSchema.safeParse({ ...base, email: 'anna@', emailConsent: true }))?.email,
    ).toBe('invalid_email'));
  it('rejects addresses longer than 254 characters', () =>
    expect(
      rsvpInputSchema.safeParse({ ...base, email: `${'a'.repeat(250)}@x.se`, emailConsent: true }).success,
    ).toBe(false));
  it('treats null as removing the subscription', () => {
    const r = rsvpInputSchema.parse({ ...base, email: null });
    expect(r.email).toBeNull();
  });
  it('treats an omitted or blank email as keeping the current state', () => {
    expect(rsvpInputSchema.parse(base).email).toBeUndefined();
    expect(rsvpInputSchema.parse({ ...base, email: '  ' }).email).toBeUndefined();
  });
  it('still only requires a name', () => expect(rsvpInputSchema.safeParse(base).success).toBe(true));
});

describe('announcement input', () => {
  it.each([
    [0, 'announcement_required'],
    [500, null],
    [501, 'announcement_too_long'],
  ])('%i characters', (n, key) => {
    const errs = fieldErrors(announcementInputSchema.safeParse({ body: 'x'.repeat(n) }));
    expect(errs?.body ?? null).toBe(key);
  });
  it('trims before counting', () => {
    expect(fieldErrors(announcementInputSchema.safeParse({ body: '   ' }))?.body).toBe('announcement_required');
    expect(announcementInputSchema.parse({ body: `  ${'x'.repeat(500)}  ` }).body).toHaveLength(500);
  });
});

describe('guest settings (add-guest-capacity)', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const schema = makeEventInputSchema(() => now);
  const valid = { title: 'Fest', startsAt: new Date('2026-06-19T16:00:00Z'), locationText: 'Hemma' };

  it('defaults to no plus-ones and no capacity', () => {
    const e = schema.parse(valid);
    expect(e.allowPlusOnes).toBe(false);
    expect(e.maxPlusOnes).toBe(1);
    expect(e.capacity).toBeUndefined();
  });
  it('accepts plus-ones 1..5 and capacity 1..3000 (or null = no limit)', () => {
    for (const maxPlusOnes of [1, 5]) expect(schema.safeParse({ ...valid, allowPlusOnes: true, maxPlusOnes }).success).toBe(true);
    for (const capacity of [1, 3000, null]) expect(schema.safeParse({ ...valid, capacity }).success).toBe(true);
  });
  it.each([
    ['maxPlusOnes', { maxPlusOnes: 0 }, 'max_plus_ones_invalid'],
    ['maxPlusOnes', { maxPlusOnes: 6 }, 'max_plus_ones_invalid'],
    ['maxPlusOnes', { maxPlusOnes: 1.5 }, 'max_plus_ones_invalid'],
    ['capacity', { capacity: 0 }, 'capacity_invalid'],
    ['capacity', { capacity: 3001 }, 'capacity_invalid'],
    ['capacity', { capacity: 2.5 }, 'capacity_invalid'],
  ])('rejects invalid %s %j', (field, patch, key) => {
    expect(fieldErrors(schema.safeParse({ ...valid, ...patch }))?.[field]).toBe(key);
  });
});

describe('rsvp plus-ones', () => {
  const ok = { token: 'AbCdEf123456', guestToken: 'x'.repeat(22), displayName: 'Anna', status: 'going' };
  it('is optional (omitted = keep the current number)', () =>
    expect(rsvpInputSchema.parse(ok).plusOnes).toBeUndefined());
  it.each([0, 1, 5])('accepts %i', (plusOnes) =>
    expect(rsvpInputSchema.parse({ ...ok, plusOnes }).plusOnes).toBe(plusOnes));
  it.each([-1, 6, 1.5])('rejects %s', (plusOnes) =>
    expect(fieldErrors(rsvpInputSchema.safeParse({ ...ok, plusOnes }))?.plusOnes).toBe('too_many_plus_ones'));
});

describe('date poll input', () => {
  const schema = makeDatePollInputSchema(() => now);
  const at = (iso: string) => new Date(iso);
  const opts = (...isos: string[]) => isos.map((iso) => ({ startsAt: at(iso) }));
  const fri = '2026-06-05T17:00:00Z';
  const sat = '2026-06-06T17:00:00Z';

  it('accepts 2 to 4 future options and an optional deadline', () => {
    expect(schema.safeParse({ options: opts(fri, sat) }).success).toBe(true);
    expect(schema.safeParse({ options: opts(fri, sat), closesAt: at('2026-06-04T12:00:00Z') }).success).toBe(true);
  });

  it.each([
    ['one option', opts(fri)],
    ['five options', opts(fri, sat, '2026-06-07T17:00:00Z', '2026-06-08T17:00:00Z', '2026-06-09T17:00:00Z')],
  ])('rejects %s', (_label, options) => {
    expect(pollErrors(schema.safeParse({ options }))?.options).toBe('poll_option_count');
  });

  it('indicates the option in the past', () => {
    expect(pollErrors(schema.safeParse({ options: opts(fri, '2026-05-01T17:00:00Z') }))?.byOption[1]?.startsAt).toBe(
      'option_in_past',
    );
  });

  it('indicates the duplicate option', () => {
    expect(pollErrors(schema.safeParse({ options: opts(fri, sat, fri) }))?.byOption[2]?.startsAt).toBe('option_duplicate');
  });

  it('indicates an end at or before the start', () => {
    const r = schema.safeParse({ options: [{ startsAt: at(fri), endsAt: at(fri) }, { startsAt: at(sat) }] });
    expect(pollErrors(r)?.byOption[0]?.endsAt).toBe('end_before_start');
  });

  it.each([
    ['after the earliest option', '2026-06-05T18:00:00Z'],
    ['in the past', '2026-05-31T12:00:00Z'],
  ])('rejects a deadline %s', (_label, iso) => {
    expect(pollErrors(schema.safeParse({ options: opts(fri, sat), closesAt: at(iso) }))?.closesAt).toBe('deadline_invalid');
  });

  it('when editing, keeps unchanged passed options and an unchanged passed deadline', () => {
    const past = '2026-05-30T17:00:00Z';
    const deadline = at('2026-05-29T12:00:00Z');
    const edit = makeDatePollInputSchema(() => now, { keepIds: ['old'], previousClosesAt: deadline });
    const options = [{ id: 'old', startsAt: at(past) }, { startsAt: at(sat) }];
    expect(edit.safeParse({ options, closesAt: deadline }).success).toBe(true);
    expect(pollErrors(edit.safeParse({ options: [{ id: 'new', startsAt: at(past) }, { startsAt: at(sat) }] }))
      ?.byOption[0]?.startsAt).toBe('option_in_past');
  });
});

describe('ballot input', () => {
  const ok = {
    token: 'AbCdEf123456',
    guestToken: 'x'.repeat(22),
    displayName: ' Anna ',
    votes: [{ optionId: '6f1c1f9e-4c1a-4b8e-9d55-0a4f0b7c1a11', choice: 'yes' }],
  };
  it('has the three choices', () => expect(VOTE_CHOICES).toEqual(['yes', 'if_needed', 'no']));
  it('accepts a ballot and trims the name', () => expect(ballotInputSchema.parse(ok).displayName).toBe('Anna'));
  it('requires a name', () =>
    expect(fieldErrors(ballotInputSchema.safeParse({ ...ok, displayName: '' }))?.displayName).toBe('name_required'));
  it('requires at least one answer', () =>
    expect(fieldErrors(ballotInputSchema.safeParse({ ...ok, votes: [] }))?.votes).toBe('no_votes'));
  it('rejects unknown choices and duplicate options', () => {
    expect(ballotInputSchema.safeParse({ ...ok, votes: [{ ...ok.votes[0], choice: 'maybe' }] }).success).toBe(false);
    expect(ballotInputSchema.safeParse({ ...ok, votes: [ok.votes[0], ok.votes[0]] }).success).toBe(false);
  });
});
