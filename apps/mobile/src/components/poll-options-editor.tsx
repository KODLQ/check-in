import { MAX_POLL_OPTIONS, MIN_POLL_OPTIONS, type EditedOption, type PollErrors } from '@check-in/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { DateField } from './date-field';
import { Button, ErrorText, Label, useColors } from './ui';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Two options to start from: the usual default start and the same time a day later (create < 30 s). */
export function defaultPollOptions(firstStart: Date): EditedOption[] {
  return [{ startsAt: firstStart }, { startsAt: new Date(firstStart.getTime() + DAY) }];
}

/** A deadline that is valid by default: a day before the earliest option, or halfway there if sooner. */
export function defaultDeadline(options: readonly EditedOption[], now: Date): Date {
  const earliest = Math.min(...options.map((o) => o.startsAt.getTime()));
  const dayBefore = earliest - DAY;
  return new Date(dayBefore > now.getTime() ? dayBefore : now.getTime() + Math.max((earliest - now.getTime()) / 2, 0));
}

/**
 * 2-4 candidate start times (each with an optional end) and an optional voting deadline (add-date-polls).
 * Used by the event form's "Let guests vote" mode and the Edit times screen.
 */
export function PollOptionsEditor({
  options,
  onChange,
  closesAt,
  onChangeClosesAt,
  errors,
  now,
}: {
  options: EditedOption[];
  onChange: (options: EditedOption[]) => void;
  closesAt: Date | null;
  onChangeClosesAt: (d: Date | null) => void;
  errors: PollErrors | null;
  now: () => Date;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const err = (key?: string) => (key ? t(`errors.${key}`) : null);
  const update = (i: number, patch: Partial<EditedOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <View style={{ gap: 14 }} testID="poll-options">
      {options.map((o, i) => (
        <View
          key={o.id ?? `new-${i}`}
          // Outlined (not filled) so the grey date fields inside stand out from the card.
          style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label>{t('polls.option_n', { n: i + 1 })}</Label>
            {options.length > MIN_POLL_OPTIONS ? (
              <Pressable
                testID={`option-${i}-remove`}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => onChange(options.filter((_, j) => j !== i))}
              >
                <Text style={{ color: c.danger, fontWeight: '600' }}>{t('polls.remove_option')}</Text>
              </Pressable>
            ) : null}
          </View>
          <DateField
            testID={`option-${i}-start`}
            label={t('events.starts')}
            value={o.startsAt}
            onChange={(d) => update(i, { startsAt: d })}
            error={err(errors?.byOption[i]?.startsAt)}
          />
          {o.endsAt ? (
            <DateField
              testID={`option-${i}-end`}
              label={t('events.ends')}
              value={o.endsAt}
              onChange={(d) => update(i, { endsAt: d })}
              onClear={() => update(i, { endsAt: null })}
              clearLabel={t('events.remove_end')}
              error={err(errors?.byOption[i]?.endsAt)}
            />
          ) : (
            <Pressable
              testID={`option-${i}-add-end`}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => update(i, { endsAt: new Date(o.startsAt.getTime() + 3 * HOUR) })}
            >
              <Text style={{ color: c.accent, fontWeight: '600' }}>{t('polls.add_end')}</Text>
            </Pressable>
          )}
        </View>
      ))}
      <ErrorText testID="poll-error">{err(errors?.options)}</ErrorText>
      {options.length < MAX_POLL_OPTIONS ? (
        <Button
          testID="add-option"
          variant="ghost"
          title={t('polls.add_option')}
          onPress={() => {
            const last = options[options.length - 1]?.startsAt ?? now();
            onChange([...options, { startsAt: new Date(last.getTime() + DAY) }]);
          }}
        />
      ) : null}
      {closesAt ? (
        <View style={{ gap: 6 }}>
          <DateField
            testID="deadline"
            label={t('polls.deadline')}
            value={closesAt}
            onChange={onChangeClosesAt}
            error={err(errors?.closesAt)}
          />
          <Pressable testID="remove-deadline" accessibilityRole="button" onPress={() => onChangeClosesAt(null)}>
            <Text style={{ color: c.muted }}>{t('polls.remove_deadline')}</Text>
          </Pressable>
        </View>
      ) : (
        <Button
          testID="add-deadline"
          variant="ghost"
          title={t('polls.add_deadline')}
          onPress={() => onChangeClosesAt(defaultDeadline(options, now()))}
        />
      )}
    </View>
  );
}
