import { describe, expect, it } from 'vitest';
import { announcementInputSchema, fieldErrors, makeEventInputSchema, rsvpInputSchema } from './schemas';

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
