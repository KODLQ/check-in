import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { searchPlaces, type Place } from '@/lib/places';
import { Field, useColors } from './ui';

export interface LocationValue {
  locationText: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
}

/** Free-text location with optional place search that attaches a map point. */
export function LocationField({
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  label: string;
  placeholder: string;
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  error?: string | null;
}) {
  const c = useColors();
  const [results, setResults] = useState<Place[]>([]);
  const [focused, setFocused] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const hasPoint = value.latitude != null;

  useEffect(() => {
    if (!focused || hasPoint) return;
    const timer = setTimeout(() => {
      abort.current?.abort();
      abort.current = new AbortController();
      searchPlaces(value.locationText, abort.current.signal).then(setResults).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [value.locationText, focused, hasPoint]);

  return (
    <View style={{ gap: 6 }}>
      <Field
        testID="location"
        label={label}
        placeholder={placeholder}
        value={value.locationText}
        // Typing again detaches the map point: the text is the source of truth.
        onChangeText={(text) => onChange({ locationText: text })}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        error={error}
      />
      {hasPoint ? <Text style={{ color: c.muted }}>📍 {value.placeName}</Text> : null}
      {focused && !hasPoint && results.length > 0 ? (
        <View style={{ backgroundColor: c.surface, borderRadius: 12 }}>
          {results.map((p, i) => (
            <Pressable
              key={`${p.latitude},${p.longitude},${i}`}
              onPress={() => {
                onChange({
                  locationText: [p.name, p.label].filter(Boolean).join(', '),
                  placeName: p.name,
                  latitude: p.latitude,
                  longitude: p.longitude,
                });
                setResults([]);
              }}
              style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderColor: c.border }}
            >
              <Text style={{ color: c.text, fontWeight: '600' }}>{p.name}</Text>
              {p.label ? <Text style={{ color: c.muted }}>{p.label}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
