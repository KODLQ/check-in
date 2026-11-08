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
