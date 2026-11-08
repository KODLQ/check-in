import { describe, expect, it } from 'vitest';
import { fieldErrors, makeEventInputSchema, rsvpInputSchema } from './schemas';

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
