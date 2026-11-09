import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { locale } from '@/lib/i18n';
import { locationTextFor, searchPlaces, type Place } from '@/lib/places';
import { Field, useColors } from './ui';

export interface LocationValue {
  locationText: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
}

/** Fixed row height so a late or changed result list never resizes rows under the user's finger. */
const ROW_HEIGHT = 56;

/**
 * Free-text location with optional place search that attaches a map point. The typed text is
 * only replaced when the user taps a suggestion; suggestions show only while the field is focused.
 */
export function LocationField({
  label,
  placeholder,
  value,
  onChange,
  onFocus,
  error,
}: {
  label: string;
  placeholder: string;
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  /** Lets the form scroll the field up so the suggestions sit above the keyboard. */
  onFocus?: () => void;
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
      const controller = new AbortController();
      abort.current = controller;
      searchPlaces(value.locationText, locale, controller.signal)
        .then((places) => {
          // A response for an older query or after the field lost focus is dropped.
          if (!controller.signal.aborted) setResults(places);
        })
        .catch((e: unknown) => {
          if (__DEV__ && (e as Error).name !== 'AbortError') console.warn('place search failed', e);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [value.locationText, focused, hasPoint]);

  const showResults = focused && !hasPoint && value.locationText.trim().length >= 3 && results.length > 0;

  return (
    <View style={{ gap: 6 }}>
      <Field
        testID="location"
        label={label}
        placeholder={placeholder}
        value={value.locationText}
        // Typing again detaches the map point: the text is the source of truth.
        onChangeText={(text) => onChange({ locationText: text })}
        autoCorrect={false}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        // Taps on a suggestion don't blur the field (keyboardShouldPersistTaps="handled").
        // Nothing appears after focus leaves: cancel the search in flight and forget the results.
        onBlur={() => {
          setFocused(false);
          abort.current?.abort();
          setResults([]);
        }}
        error={error}
      />
      {hasPoint ? <Text style={{ color: c.muted }}>📍 {value.placeName}</Text> : null}
      {showResults ? (
        <View testID="location-results" style={{ backgroundColor: c.surface, borderRadius: 12 }}>
          {results.map((p, i) => (
            <Pressable
              key={`${p.latitude},${p.longitude},${i}`}
              testID={`location-result-${i}`}
              accessibilityRole="button"
              onPress={() => {
                onChange({
                  locationText: locationTextFor(value.locationText, p),
                  placeName: p.name,
                  latitude: p.latitude,
                  longitude: p.longitude,
                });
                setResults([]);
              }}
              style={({ pressed }) => ({
                height: ROW_HEIGHT,
                justifyContent: 'center',
                paddingHorizontal: 12,
                borderTopWidth: i ? 1 : 0,
                borderColor: c.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text numberOfLines={1} style={{ color: c.text, fontWeight: '600' }}>
                {p.name}
              </Text>
              {p.label ? (
                <Text numberOfLines={1} style={{ color: c.muted }}>
                  {p.label}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
