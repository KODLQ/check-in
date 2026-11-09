import {
  endsOnError,
  EVENT_THEMES,
  fieldErrors,
  formatRepeatRule,
  groupNameSchema,
  REPEAT_FREQUENCIES,
  makeDatePollInputSchema,
  makeEventInputSchema,
  MAX_PLUS_ONES,
  pollErrors,
  type EditedOption,
  type EventInput,
  type PollErrors,
  type RepeatFrequency,
} from '@check-in/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

import { locale } from '@/lib/i18n';

import { Cover } from './cover';
import { DateField } from './date-field';
import { LocationField, type LocationValue } from './location-field';
import { defaultPollOptions, PollOptionsEditor } from './poll-options-editor';
import { Body, Button, ErrorText, Field, Label, Stepper, useColors } from './ui';

export interface EventFormValues extends EventInput {
  coverPath?: string | null;
  guestListVisible: boolean;
  /**
   * "Let guests vote" (add-date-polls): candidate times instead of startsAt/endsAt, which are then
   * meaningless and must not be saved.
   */
  poll?: { options: { startsAt: Date; endsAt?: Date }[]; closesAt: Date | null };
  /**
   * Repeating (add-groups-and-recurring-events): the series belongs to an existing group (groupId) or to
   * a new one created first (newGroupName). endsOn is the last local date (YYYY-MM-DD) or null.
   */
  repeat?: { frequency: RepeatFrequency; endsOn: string | null; groupId: string | null; newGroupName: string | null };
  /** One-off event inviting a group the user owns or administers. */
  groupId?: string | null;
}

/** A group the user may invite or put a series in (owner or admin). */
export interface FormGroup {
  id: string;
  name: string;
}

/** Local calendar date (YYYY-MM-DD) of a Date on this device. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Far enough ahead to pass the start-time rule when only the other fields are being validated. */
const PLACEHOLDER_START_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Comparable snapshot of the form's editable state. The form is "dirty" (leaving asks "Discard
 * changes?") when the current snapshot differs from the one taken when it opened.
 */
export function formSnapshot(state: Record<string, unknown>): string {
  return JSON.stringify(state, (_key, value: unknown) => (typeof value === 'string' ? value.trim() : value));
}

/** What a screen needs to put Cancel / Save in its header. */
export interface EventFormHeader {
  submit: () => void;
  busy: boolean;
  dirty: boolean;
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
  allowPoll = false,
  datePending = false,
  renderHeader,
  onDirtyChange,
  groups,
  allowRepeat = false,
}: {
  /** Groups the user owns or administers: offered for repeating and for inviting a group. */
  groups?: readonly FormGroup[];
  /** Offer "Repeat" (creating an event with a fixed date). */
  allowRepeat?: boolean;
  /** Header buttons (Cancel / Save) of the screen showing the form. */
  renderHeader?: (header: EventFormHeader) => ReactNode;
  /** Called when the form gets or loses unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
  initial?: Partial<EventFormValues>;
  /** Offer "Fixed date / Let guests vote" (creating an event). */
  allowPoll?: boolean;
  /** Editing a date-pending event: its time is set only by picking an option, so no date fields. */
  datePending?: boolean;
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
  const [capacityText, setCapacityText] = useState(
    initial?.capacity != null ? String(initial.capacity) : '',
  );
  const [guestsOpen, setGuestsOpen] = useState(false);
  // Date poll (add-date-polls).
  const [mode, setMode] = useState<'fixed' | 'vote'>(initial?.poll ? 'vote' : 'fixed');
  const [pollOptions, setPollOptions] = useState<EditedOption[]>(
    initial?.poll?.options ?? defaultPollOptions(initial?.startsAt ?? defaultStart(now())),
  );
  const [closesAt, setClosesAt] = useState<Date | null>(initial?.poll?.closesAt ?? null);
  const [pollErrs, setPollErrs] = useState<PollErrors | null>(null);
  // Repeat and group (add-groups-and-recurring-events).
  const [frequency, setFrequency] = useState<RepeatFrequency | 'never'>(initial?.repeat?.frequency ?? 'never');
  const [seriesGroupId, setSeriesGroupId] = useState<string | null>(initial?.repeat?.groupId ?? groups?.[0]?.id ?? null);
  const [newGroupName, setNewGroupName] = useState<string | null>(groups && groups.length === 0 ? '' : null);
  const [endsOn, setEndsOn] = useState<Date | null>(null);
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(initial?.groupId ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const locationY = useRef(0);

  const snapshot = formSnapshot({
    title,
    startsAt,
    endsAt,
    location,
    description,
    theme,
    coverPath,
    guestListVisible,
    allowPlusOnes,
    maxPlusOnes,
    capacityText,
    mode,
    pollOptions,
    closesAt,
    frequency,
    seriesGroupId,
    newGroupName,
    endsOn,
    inviteGroupId,
  });
  const [initialSnapshot] = useState(snapshot);
  const dirty = snapshot !== initialSnapshot;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const err = (k: string) => (errors[k] ? t(`errors.${errors[k]}`) : null);
  /** A field's error goes away as soon as the field is changed; submitting validates again. */
  const clearErrors = (...keys: string[]) => {
    if (keys.some((k) => errors[k] || errors._))
      setErrors(({ _: _form, ...rest }) =>
        Object.fromEntries(Object.entries(rest).filter(([k]) => !keys.includes(k))),
      );
  };

  async function pickCover() {
    if (!onPickCover || pickingCover) return;
    // The system photo picker takes a few seconds to open, and the upload a few more.
    setPickingCover(true);
    try {
      const path = await onPickCover();
      if (path) setCoverPath(path);
    } catch (e) {
      if (__DEV__) console.warn('cover upload failed', e);
      Alert.alert(t('common.error'));
    } finally {
      setPickingCover(false);
    }
  }

  async function submit() {
    const trimmedCapacity = capacityText.trim();
    const capacity =
      trimmedCapacity === '' ? null : /^\d+$/.test(trimmedCapacity) ? Number(trimmedCapacity) : NaN;
    const voting = allowPoll && mode === 'vote';
    // Without a fixed date (poll, or editing a pending event) only the other fields are validated here.
    const noDate = voting || datePending;
    const raw = {
      title,
      startsAt: noDate ? new Date(now().getTime() + PLACEHOLDER_START_MS) : startsAt,
      endsAt: noDate ? undefined : endsAt,
      ...location,
      description,
      theme,
      allowPlusOnes,
      maxPlusOnes,
      capacity,
    };
    const parsed = makeEventInputSchema(now).safeParse(raw);
    const fe = fieldErrors(parsed);
    const pollParsed = voting
      ? makeDatePollInputSchema(now).safeParse({ options: pollOptions, closesAt })
      : null;
    const pe = pollParsed ? pollErrors(pollParsed) : null;
    setPollErrs(pe);
    const repeating = allowRepeat && !voting && frequency !== 'never';
    const repeatErrors: Record<string, string> = {};
    if (repeating) {
      if (newGroupName !== null) {
        if (!groupNameSchema.safeParse(newGroupName).success) repeatErrors.group = 'invalid_name';
      } else if (!seriesGroupId) {
        repeatErrors.group = 'group_required';
      }
      if (endsOn && endsOnError(localDate(endsOn), localDate(startsAt))) repeatErrors.endsOn = 'invalid_end_date';
    }
    if (fe || !parsed.success || pe || Object.keys(repeatErrors).length > 0) {
      setErrors({ ...(fe ?? {}), ...repeatErrors });
      if (fe?.capacity || fe?.maxPlusOnes) setGuestsOpen(true);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const poll = voting
        ? {
            options: pollOptions.map((o) => ({
              startsAt: o.startsAt,
              ...(o.endsAt ? { endsAt: o.endsAt } : {}),
            })),
            closesAt,
          }
        : undefined;
      const result = await onSubmit({
        ...parsed.data,
        coverPath,
        guestListVisible,
        ...(poll ? { poll } : {}),
        ...(repeating
          ? {
              repeat: {
                frequency: frequency as RepeatFrequency,
                endsOn: endsOn ? localDate(endsOn) : null,
                groupId: newGroupName !== null ? null : seriesGroupId,
                newGroupName: newGroupName !== null ? newGroupName.trim() : null,
              },
            }
          : groups
            ? { groupId: voting ? null : inviteGroupId }
            : {}),
      });
      if (result) setErrors({ _: result });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAwareScrollView
      ref={scroll}
      bottomOffset={24}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled"
    >
      {renderHeader?.({ submit: () => void submit(), busy, dirty })}
      <Cover coverPath={coverPath} theme={theme} height={140} />
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {EVENT_THEMES.map((th) => {
          const selected = theme === th.id && !coverPath;
          return (
            <Pressable
              key={th.id}
              testID={`theme-${th.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t('events.theme_label', { name: t(`events.themes.${th.id}`) })}
              onPress={() => {
                setTheme(th.id);
                setCoverPath(null);
              }}
              // 44pt touch target around a 36pt swatch.
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundImage: `linear-gradient(135deg, ${th.colors[0]}, ${th.colors[1]})`,
                  borderWidth: selected ? 3 : 0,
                  borderColor: c.text,
                }}
              />
            </Pressable>
          );
        })}
        {onPickCover ? (
          <Pressable
            testID="upload-cover"
            accessibilityRole="button"
            accessibilityState={{ busy: pickingCover, disabled: pickingCover }}
            disabled={pickingCover}
            onPress={() => void pickCover()}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}
          >
            {pickingCover ? <ActivityIndicator size="small" color={c.accent} /> : null}
            <Text style={{ color: pickingCover ? c.muted : c.accent, fontWeight: '600' }}>
              {pickingCover ? t('events.opening_photos') : t('events.upload_cover')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Field
        testID="title"
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          clearErrors('title');
        }}
        placeholder={t('events.title_placeholder')}
        style={{ fontSize: 22, fontWeight: '700' }}
        maxLength={100}
        error={err('title')}
      />

      {allowPoll ? (
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
          {(['fixed', 'vote'] as const).map((m) => (
            <View key={m} style={{ flex: 1 }}>
              <Button
                testID={`mode-${m}`}
                variant={mode === m ? 'primary' : 'secondary'}
                title={t(m === 'fixed' ? 'polls.mode_fixed' : 'polls.mode_vote')}
                onPress={() => setMode(m)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {datePending ? null : allowPoll && mode === 'vote' ? (
        <PollOptionsEditor
          options={pollOptions}
          onChange={(o) => {
            setPollOptions(o);
            setPollErrs(null);
          }}
          closesAt={closesAt}
          onChangeClosesAt={(d) => {
            setClosesAt(d);
            setPollErrs(null);
          }}
          errors={pollErrs}
          now={now}
        />
      ) : (
        <>
          <DateField
            testID="starts-at"
            label={t('events.starts')}
            value={startsAt}
            onChange={(d) => {
              setStartsAt(d);
              clearErrors('startsAt', 'endsAt');
            }}
            error={err('startsAt')}
          />
          {endsAt ? (
            <DateField
              testID="ends-at"
              label={t('events.ends')}
              value={endsAt}
              onChange={(d) => {
                setEndsAt(d);
                clearErrors('endsAt');
              }}
              onClear={() => {
                setEndsAt(undefined);
                clearErrors('endsAt');
              }}
              clearLabel={t('events.remove_end')}
              error={err('endsAt')}
            />
          ) : (
            <Button
              testID="add-end"
              variant="ghost"
              title={t('events.add_end')}
              onPress={() => setEndsAt(new Date(startsAt.getTime() + 3 * 60 * 60 * 1000))}
            />
          )}
        </>
      )}

      {allowRepeat && mode === 'fixed' && !datePending ? (
        <View style={{ gap: 10 }} testID="repeat-section">
          <Label>{t('series.repeat')}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {(['never', ...REPEAT_FREQUENCIES] as const).map((f) => (
              <Chip
                key={f}
                testID={`repeat-${f}`}
                label={t(`series.${f}`)}
                selected={frequency === f}
                onPress={() => {
                  setFrequency(f);
                  clearErrors('group', 'endsOn');
                }}
              />
            ))}
          </View>
          {frequency !== 'never' ? (
            <>
              <Text testID="repeat-rule" style={{ color: c.muted, fontSize: 15 }}>
                {formatRepeatRule(frequency, localDate(startsAt), locale)}
              </Text>
              <Label>{t('series.group_label')}</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                {(groups ?? []).map((g) => (
                  <Chip
                    key={g.id}
                    testID={`series-group-${g.id}`}
                    label={g.name}
                    selected={newGroupName === null && seriesGroupId === g.id}
                    onPress={() => {
                      setSeriesGroupId(g.id);
                      setNewGroupName(null);
                      clearErrors('group');
                    }}
                  />
                ))}
                <Chip
                  testID="series-new-group"
                  label={t('series.new_group_inline')}
                  selected={newGroupName !== null}
                  onPress={() => {
                    setNewGroupName(newGroupName ?? '');
                    clearErrors('group');
                  }}
                />
              </View>
              {newGroupName !== null ? (
                <Field
                  testID="series-new-group-name"
                  label={t('groups.name_label')}
                  value={newGroupName}
                  onChangeText={(v) => {
                    setNewGroupName(v);
                    clearErrors('group');
                  }}
                  placeholder={t('groups.name_placeholder')}
                  maxLength={50}
                />
              ) : null}
              <ErrorText testID="series-group-error">{err('group')}</ErrorText>
              {endsOn ? (
                <DateField
                  testID="series-ends-on"
                  label={t('series.ends_on')}
                  value={endsOn}
                  onChange={(d) => {
                    setEndsOn(d);
                    clearErrors('endsOn');
                  }}
                  onClear={() => setEndsOn(null)}
                  clearLabel={t('series.remove_end_date')}
                  error={err('endsOn')}
                />
              ) : (
                <Button
                  testID="series-add-end"
                  variant="ghost"
                  title={t('series.add_end_date')}
                  onPress={() => setEndsOn(new Date(startsAt.getTime() + 90 * 24 * 60 * 60 * 1000))}
                />
              )}
            </>
          ) : null}
        </View>
      ) : null}

      {groups && groups.length > 0 && !(allowRepeat && frequency !== 'never') && mode === 'fixed' && !datePending ? (
        <View style={{ gap: 10 }} testID="invite-group-section">
          <Label>{t('series.invite_group')}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            <Chip testID="invite-group-none" label={t('series.no_group')} selected={inviteGroupId === null} onPress={() => setInviteGroupId(null)} />
            {groups.map((g) => (
              <Chip
                key={g.id}
                testID={`invite-group-${g.id}`}
                label={g.name}
                selected={inviteGroupId === g.id}
                onPress={() => setInviteGroupId(g.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View onLayout={(e) => (locationY.current = e.nativeEvent.layout.y)}>
        <LocationField
          label={t('events.location')}
          placeholder={t('events.location_placeholder')}
          value={location}
          onChange={(v) => {
            setLocation(v);
            clearErrors('locationText', 'latitude', 'longitude');
          }}
          // Bring the field near the top so the suggestions below it are not under the keyboard.
          onFocus={() =>
            setTimeout(() => scroll.current?.scrollTo({ y: Math.max(locationY.current - 12, 0), animated: true }), 350)
          }
          error={err('locationText') ?? err('latitude')}
        />
      </View>

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
        <Switch
          value={guestListVisible}
          onValueChange={setGuestListVisible}
          trackColor={{ true: c.accent }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={{ gap: 14 }}>
        <Pressable
          testID="guests-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded: guestsOpen }}
          onPress={() => setGuestsOpen((o) => !o)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Label>{t('events.guests_section')}</Label>
            <Text testID="guests-summary" style={{ color: c.muted, fontSize: 15 }}>
              {t('events.guests_summary', {
                plus: allowPlusOnes
                  ? t('events.plus_ones_up_to', { count: maxPlusOnes })
                  : t('events.plus_ones_off'),
                limit: capacityText.trim()
                  ? t('events.limit_of', { count: capacityText.trim() })
                  : t('events.no_limit'),
              })}
            </Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 18 }}>{guestsOpen ? '⌃' : '⌄'}</Text>
        </Pressable>
        {guestsOpen ? (
          <View style={{ gap: 14 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1 }}>
                <Body>{t('events.allow_plus_ones')}</Body>
              </View>
              <Switch
                testID="allow-plus-ones"
                value={allowPlusOnes}
                onValueChange={setAllowPlusOnes}
                trackColor={{ true: c.accent }}
                thumbColor="#FFFFFF"
              />
            </View>
            {allowPlusOnes ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Body>{t('events.max_plus_ones')}</Body>
                <Stepper
                  testID="max-plus-ones"
                  value={maxPlusOnes}
                  min={1}
                  max={MAX_PLUS_ONES}
                  onChange={(n) => {
                    setMaxPlusOnes(n);
                    clearErrors('maxPlusOnes');
                  }}
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
              // Whole numbers only: some Android keyboards offer "." and "," even on a number pad.
              onChangeText={(text) => {
                setCapacityText(text.replace(/\D/g, ''));
                clearErrors('capacity');
              }}
              placeholder={t('events.capacity_placeholder')}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={4}
              error={err('capacity')}
            />
            <Text style={{ color: c.muted, fontSize: 13 }}>{t('events.capacity_hint')}</Text>
          </View>
        ) : null}
      </View>

      <ErrorText testID="form-error">
        {errors._ ? t(`errors.${errors._}`, t('common.error')) : null}
      </ErrorText>
      <Button testID="submit" title={submitLabel} loading={busy} onPress={submit} />
    </KeyboardAwareScrollView>
  );
}

/** Small selectable pill (repeat frequency, group). */
function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        justifyContent: 'center',
        backgroundColor: selected ? c.accent : c.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: selected ? c.accentText : c.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
