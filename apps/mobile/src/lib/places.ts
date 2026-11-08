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
  };
}

/** Greater Stockholm. We launch here, so local matches come first. */
const STOCKHOLM_BBOX = '17.2,58.7,19.6,60.2';

async function photon(q: string, extra: string, signal?: AbortSignal): Promise<PhotonFeature[]> {
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${extra}`,
    { signal },
  );
  if (!res.ok) return [];
  return ((await res.json()) as { features: PhotonFeature[] }).features;
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
 * falls back to everywhere. Fair-use public endpoint: fine for the MVP, swap for a
 * paid geocoder at scale.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  // OSM often lacks house numbers, so try: exact in Stockholm, street in Stockholm, anywhere.
  const withoutNumber = q.replace(/\s*\d+\s*[a-zA-Z]?\s*$/, '').trim();
  let features = await photon(q, `&bbox=${STOCKHOLM_BBOX}`, signal);
  if (features.length === 0 && withoutNumber && withoutNumber !== q) {
    features = await photon(withoutNumber, `&bbox=${STOCKHOLM_BBOX}`, signal);
  }
  if (features.length === 0) features = await photon(q, '&lat=59.3293&lon=18.0686', signal);

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
