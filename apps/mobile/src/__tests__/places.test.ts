import { locationTextFor, toPlace } from '@/lib/places';

const street = toPlace({
  geometry: { coordinates: [18.05, 59.317] },
  properties: { name: 'Hornsgatan', city: 'Stockholm', district: 'Södermalm' },
});

describe('places', () => {
  it('keeps the typed house number when the match is only a street', () => {
    expect(locationTextFor('Hornsgatan 12', street)).toBe('Hornsgatan 12');
  });
  it('uses the formatted place when nothing more specific was typed', () => {
    expect(locationTextFor('Hornsg', street)).toBe('Hornsgatan, Södermalm');
  });
});
