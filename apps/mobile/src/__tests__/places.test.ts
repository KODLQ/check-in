import { locationTextFor, searchPlaces, STOCKHOLM_BBOX, SWEDEN_BBOX, toPlace } from '@/lib/places';

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

describe('searchPlaces', () => {
  const feature = (name: string, countrycode = 'SE') => ({
    geometry: { coordinates: [18.03, 59.31] },
    properties: { name, city: 'Stockholm', countrycode },
  });
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  const respond = (...batches: unknown[][]) => {
    for (const features of batches) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ features }) });
    }
  };
  const urls = () => fetchMock.mock.calls.map(([url]) => new URL(url as string));

  it('searches Stockholm first, in the app language Photon supports', async () => {
    respond([feature('Hornstull')]);
    const places = await searchPlaces('Hornstull', 'en');
    expect(places.map((p) => p.name)).toEqual(['Hornstull']);
    const [url] = urls();
    expect(url.searchParams.get('bbox')).toBe(STOCKHOLM_BBOX);
    expect(url.searchParams.get('lang')).toBe('en');
  });

  it('uses local names for Swedish (Photon has no "sv")', async () => {
    respond([feature('Hornstull')]);
    await searchPlaces('Hornstull', 'sv');
    expect(urls()[0].searchParams.get('lang')).toBe('default');
  });

  it('falls back to Sweden, never worldwide, and drops matches outside Sweden', async () => {
    respond([], [feature('My Place Bangkok', 'TH'), feature('Myplace Malmö')]);
    const places = await searchPlaces('My place', 'en');
    expect(urls().map((u) => u.searchParams.get('bbox'))).toEqual([STOCKHOLM_BBOX, SWEDEN_BBOX]);
    expect(urls().every((u) => !u.searchParams.has('lat'))).toBe(true);
    expect(places.map((p) => p.name)).toEqual(['Myplace Malmö']);
  });

  it('returns nothing when nothing in Sweden matches', async () => {
    respond([], []);
    expect(await searchPlaces('Sukhumvit', 'en')).toEqual([]);
  });

  it('ignores queries shorter than 3 characters', async () => {
    expect(await searchPlaces('Ho', 'en')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
