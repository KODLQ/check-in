import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { formatEventTime } from '@check-in/shared';
import { Platform, Pressable, Text, View } from 'react-native';

import { locale } from '@/lib/i18n';
import { ErrorText, Label, useColors } from './ui';

export function DateField({
  label,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  error?: string | null;
  testID?: string;
}) {
  const c = useColors();

  if (Platform.OS === 'ios') {
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>{label}</Label>
          <DateTimePicker
            testID={testID}
            value={value}
            mode="datetime"
            display="compact"
            minuteInterval={5}
            locale={locale === 'sv' ? 'sv-SE' : 'en-GB'}
            onValueChange={(_e, d) => d && onChange(d)}
          />
        </View>
        <ErrorText testID={testID ? `${testID}-error` : undefined}>{error}</ErrorText>
      </View>
    );
  }

  // Android has no combined date+time picker: open date, then time.
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
      <Pressable testID={testID} onPress={open} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 14 }}>
        <Text style={{ color: c.text, fontSize: 16 }}>{formatEventTime(value, locale)}</Text>
      </Pressable>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
