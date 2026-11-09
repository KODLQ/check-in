import { EVENT_THEMES, fieldErrors, makeEventInputSchema, MAX_PLUS_ONES, type EventInput } from '@check-in/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Cover } from './cover';
import { DateField } from './date-field';
import { LocationField, type LocationValue } from './location-field';
import { Body, Button, ErrorText, Field, Label, Stepper, useColors } from './ui';

export interface EventFormValues extends EventInput {
  coverPath?: string | null;
  guestListVisible: boolean;
}

/** Next full hour + 1 day at 19:00-ish is a reasonable party default. */
export function defaultStart(now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  return d;
}

export function EventForm({
  initial,
  submitLabel,
  onSubmit,
  onPickCover,
  now = () => new Date(),
}: {
  initial?: Partial<EventFormValues>;
  submitLabel: string;
  /** Returns an error key (errors.*) or nothing on success. */
  onSubmit: (values: EventFormValues) => Promise<string | void>;
  onPickCover?: () => Promise<string | null>;
  now?: () => Date;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [startsAt, setStartsAt] = useState<Date>(initial?.startsAt ?? defaultStart(now()));
  const [endsAt, setEndsAt] = useState<Date | undefined>(initial?.endsAt);
  const [location, setLocation] = useState<LocationValue>({
    locationText: initial?.locationText ?? '',
    placeName: initial?.placeName,
    latitude: initial?.latitude,
    longitude: initial?.longitude,
  });
  const [description, setDescription] = useState(initial?.description ?? '');
  const [theme, setTheme] = useState(initial?.theme ?? 'sunset');
  const [coverPath, setCoverPath] = useState<string | null>(initial?.coverPath ?? null);
  const [guestListVisible, setGuestListVisible] = useState(initial?.guestListVisible ?? true);
  // Guests (add-guest-capacity): optional, collapsed so creating an event stays a 30-second job.
  const [allowPlusOnes, setAllowPlusOnes] = useState(initial?.allowPlusOnes ?? false);
  const [maxPlusOnes, setMaxPlusOnes] = useState(initial?.maxPlusOnes ?? 1);
  const [capacityText, setCapacityText] = useState(initial?.capacity != null ? String(initial.capacity) : '');
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const err = (k: string) => (errors[k] ? t(`errors.${errors[k]}`) : null);

  async function submit() {
    const trimmedCapacity = capacityText.trim();
    const capacity = trimmedCapacity === '' ? null : /^\d+$/.test(trimmedCapacity) ? Number(trimmedCapacity) : NaN;
    const raw = { title, startsAt, endsAt, ...location, description, theme, allowPlusOnes, maxPlusOnes, capacity };
    const parsed = makeEventInputSchema(now).safeParse(raw);
    const fe = fieldErrors(parsed);
    if (fe || !parsed.success) {
      setErrors(fe ?? {});
      if (fe?.capacity || fe?.maxPlusOnes) setGuestsOpen(true);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await onSubmit({ ...parsed.data, coverPath, guestListVisible });
      if (result) setErrors({ _: result });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <Cover coverPath={coverPath} theme={theme} height={140} />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {EVENT_THEMES.map((th) => (
            <Pressable
              key={th.id}
              accessibilityLabel={th.id}
              onPress={() => {
                setTheme(th.id);
                setCoverPath(null);
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundImage: `linear-gradient(135deg, ${th.colors[0]}, ${th.colors[1]})`,
                borderWidth: theme === th.id && !coverPath ? 3 : 0,
                borderColor: c.text,
              }}
            />
          ))}
          {onPickCover ? (
            <Pressable
              onPress={async () => {
                const path = await onPickCover();
                if (path) setCoverPath(path);
              }}
            >
              <Text style={{ color: c.accent, fontWeight: '600' }}>{t('events.upload_cover')}</Text>
            </Pressable>
          ) : null}
        </View>

        <Field
          testID="title"
          value={title}
          onChangeText={setTitle}
          placeholder={t('events.title_placeholder')}
          style={{ fontSize: 22, fontWeight: '700' }}
          maxLength={100}
          error={err('title')}
        />

        <DateField testID="starts-at" label={t('events.starts')} value={startsAt} onChange={setStartsAt} error={err('startsAt')} />
        {endsAt ? (
          <DateField testID="ends-at" label={t('events.ends')} value={endsAt} onChange={setEndsAt} error={err('endsAt')} />
        ) : (
          <Button
            variant="ghost"
            title={`+ ${t('events.add_end')}`}
            onPress={() => setEndsAt(new Date(startsAt.getTime() + 3 * 60 * 60 * 1000))}
          />
        )}

        <LocationField
          label={t('events.location')}
          placeholder={t('events.location_placeholder')}
          value={location}
          onChange={setLocation}
          error={err('locationText') ?? err('latitude')}
        />

        <Field
          label={`${t('events.description')} (${t('common.optional')})`}
          value={description}
          onChangeText={setDescription}
          placeholder={t('events.description_placeholder')}
          multiline
          maxLength={2000}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Label>{t('events.show_guest_list')}</Label>
          </View>
          <Switch value={guestListVisible} onValueChange={setGuestListVisible} />
        </View>

        <View style={{ gap: 14 }}>
          <Pressable
            testID="guests-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: guestsOpen }}
            onPress={() => setGuestsOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Label>{t('events.guests_section')}</Label>
              <Text testID="guests-summary" style={{ color: c.muted, fontSize: 15 }}>
                {t('events.guests_summary', {
                  plus: allowPlusOnes ? t('events.plus_ones_up_to', { count: maxPlusOnes }) : t('events.plus_ones_off'),
                  limit: capacityText.trim() ? t('events.limit_of', { count: capacityText.trim() }) : t('events.no_limit'),
                })}
              </Text>
            </View>
            <Text style={{ color: c.muted, fontSize: 18 }}>{guestsOpen ? '⌃' : '⌄'}</Text>
          </Pressable>
          {guestsOpen ? (
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body>{t('events.allow_plus_ones')}</Body>
                </View>
                <Switch testID="allow-plus-ones" value={allowPlusOnes} onValueChange={setAllowPlusOnes} />
              </View>
              {allowPlusOnes ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Body>{t('events.max_plus_ones')}</Body>
                  <Stepper
                    testID="max-plus-ones"
                    value={maxPlusOnes}
                    min={1}
                    max={MAX_PLUS_ONES}
                    onChange={setMaxPlusOnes}
                    decreaseLabel={t('rsvp.plus_ones_decrease')}
                    increaseLabel={t('rsvp.plus_ones_increase')}
                  />
                </View>
              ) : null}
              <ErrorText testID="max-plus-ones-error">{err('maxPlusOnes')}</ErrorText>
              <Field
                testID="capacity"
                label={`${t('events.capacity')} (${t('common.optional')})`}
                value={capacityText}
                onChangeText={setCapacityText}
                placeholder={t('events.capacity_placeholder')}
                keyboardType="number-pad"
                maxLength={4}
                error={err('capacity')}
              />
              <Text style={{ color: c.muted, fontSize: 13 }}>{t('events.capacity_hint')}</Text>
            </View>
          ) : null}
        </View>

        <ErrorText testID="form-error">{errors._ ? t(`errors.${errors._}`, t('common.error')) : null}</ErrorText>
        <Button testID="submit" title={submitLabel} loading={busy} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
