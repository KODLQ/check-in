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

/**
 * Place search via Photon (OpenStreetMap, no API key), biased towards Stockholm.
 * Fair-use public endpoint: fine for the MVP, swap for a paid geocoder at scale.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
    `&lat=59.3293&lon=18.0686&limit=5&lang=en`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { features: PhotonFeature[] };
  return json.features.map((f) => {
    const p = f.properties;
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const name = p.name ?? street ?? q;
    const label = [name !== street ? street : null, p.district ?? p.city].filter(Boolean).join(', ');
    return {
      name,
      label,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    };
  });
}
