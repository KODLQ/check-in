export interface Place {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    countrycode?: string;
  };
}

/** Greater Stockholm. We launch here, so local matches come first. */
export const STOCKHOLM_BBOX = '17.2,58.7,19.6,60.2';
/** Sweden. The fallback never goes worldwide: a far-away match is worse than none. */
export const SWEDEN_BBOX = '10.5,55.0,24.2,69.1';

/** Photon only knows default/de/en/fr; `default` gives local (Swedish) names. */
export function photonLang(locale: string): string {
  return locale === 'en' ? 'en' : 'default';
}

export function photonUrl(q: string, bbox: string, locale: string): string {
  return `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=${photonLang(locale)}&bbox=${bbox}`;
}

async function photon(
  q: string,
  bbox: string,
  locale: string,
  signal?: AbortSignal,
): Promise<PhotonFeature[]> {
  const res = await fetch(photonUrl(q, bbox, locale), { signal });
  if (!res.ok) return [];
  const { features } = (await res.json()) as { features: PhotonFeature[] };
  // The Sweden box also covers bits of Norway, Finland and Denmark.
  return features.filter((f) => !f.properties.countrycode || f.properties.countrycode === 'SE');
}

export function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name ?? street;
  const label = [name !== street ? street : null, p.district ?? p.city].filter(Boolean).join(', ');
  return {
    name,
    label,
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
  };
}

/**
 * Place search via Photon (OpenStreetMap, no API key). Searches Stockholm first and
 * falls back to the rest of Sweden. Fair-use public endpoint: fine for the MVP, swap for a
 * paid geocoder at scale.
 */
export async function searchPlaces(
  query: string,
  locale: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  // OSM often lacks house numbers, so try: exact in Stockholm, street in Stockholm, Sweden.
  const withoutNumber = q.replace(/\s*\d+\s*[a-zA-Z]?\s*$/, '').trim();
  let features = await photon(q, STOCKHOLM_BBOX, locale, signal);
  if (features.length === 0 && withoutNumber && withoutNumber !== q) {
    features = await photon(withoutNumber, STOCKHOLM_BBOX, locale, signal);
  }
  if (features.length === 0) features = await photon(q, SWEDEN_BBOX, locale, signal);

  const seen = new Set<string>();
  const places: Place[] = [];
  for (const place of features.map(toPlace)) {
    const key = `${place.name}|${place.label}`;
    if (!place.name || seen.has(key)) continue;
    seen.add(key);
    places.push(place);
    if (places.length === 5) break;
  }
  return places;
}

/**
 * Text to store as the event location when a suggestion is picked. If the user typed a
 * house number the geocoder doesn't know, keep their text and only attach the map point.
 */
export function locationTextFor(typed: string, place: Place): string {
  const formatted = [place.name, place.label].filter(Boolean).join(', ');
  return /\d/.test(typed) && !/\d/.test(place.name) ? typed.trim() : formatted;
}
