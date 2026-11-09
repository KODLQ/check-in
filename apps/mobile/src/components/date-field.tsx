import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { formatEventTime } from '@check-in/shared';
import { Platform, Pressable, Text, View } from 'react-native';

import { locale } from '@/lib/i18n';
import { ErrorText, Label, useColors } from './ui';

/** 44pt "×" that removes an optional date (end time). */
function ClearButton({ onPress, label, testID }: { onPress: () => void; label: string; testID?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Text style={{ color: c.muted, fontSize: 22, fontWeight: '600' }}>×</Text>
    </Pressable>
  );
}

export function DateField({
  label,
  value,
  onChange,
  onClear,
  clearLabel,
  error,
  testID,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  /** Shows a remove "×" (optional dates such as the end time). */
  onClear?: () => void;
  clearLabel?: string;
  error?: string | null;
  testID?: string;
}) {
  const c = useColors();
  const clear = onClear ? (
    <ClearButton onPress={onClear} label={clearLabel ?? label} testID={testID ? `${testID}-clear` : undefined} />
  ) : null;

  if (Platform.OS === 'ios') {
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>{label}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <DateTimePicker
              testID={testID}
              value={value}
              mode="datetime"
              display="compact"
              minuteInterval={5}
              accentColor={c.accent}
              locale={locale === 'sv' ? 'sv-SE' : 'en-GB'}
              onValueChange={(_e, d) => d && onChange(d)}
            />
            {clear}
          </View>
        </View>
        <ErrorText testID={testID ? `${testID}-error` : undefined}>{error}</ErrorText>
      </View>
    );
  }

  // Android has no combined date+time picker: open date, then time. Dialog colours come from the
  // app theme (plugins/with-android-accent).
  const open = () =>
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      onValueChange: (_e, date) => {
        if (!date) return;
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: true,
          onValueChange: (_e2, time) => time && onChange(time),
        });
      },
    });

  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          onPress={open}
          style={{ flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14 }}
        >
          <Text style={{ color: c.text, fontSize: 16 }}>{formatEventTime(value, locale)}</Text>
        </Pressable>
        {clear}
      </View>
      <ErrorText testID={testID ? `${testID}-error` : undefined}>{error}</ErrorText>
    </View>
  );
}
