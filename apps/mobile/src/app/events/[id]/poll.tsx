import {
  deletedVoteCount,
  makeDatePollInputSchema,
  pollErrors,
  unchangedOptionIds,
  type EditedOption,
  type PollErrors,
} from '@check-in/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { PollOptionsEditor } from '@/components/poll-options-editor';
import { Body, Button, ErrorText, Screen, useColors } from '@/components/ui';
import { errorKey } from '@/lib/events';
import { allVotes, loadHostPoll, type HostPoll } from '@/lib/polls';
import { supabase } from '@/lib/supabase';

/** Number of votes an edit would delete, given the poll as loaded (spec: edit options after votes exist). */
function votesToDelete(poll: HostPoll, edited: readonly EditedOption[]): number {
  return deletedVoteCount(poll.options, edited, allVotes(poll));
}

/** Edit times of an unpicked date poll (add-date-polls): add, change, remove options and the deadline. */
export default function EditPoll() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [poll, setPoll] = useState<HostPoll | null>(null);
  const [previousClosesAt, setPreviousClosesAt] = useState<Date | null>(null);
  const [options, setOptions] = useState<EditedOption[]>([]);
  const [closesAt, setClosesAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<PollErrors | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, ev] = await Promise.all([
        loadHostPoll(id),
        supabase.from('events').select('poll_closes_at').eq('id', id).maybeSingle(),
      ]);
      const deadline = ev.data?.poll_closes_at ? new Date(ev.data.poll_closes_at) : null;
      setPoll(p);
      setOptions(
        p.options.map((o) => ({
          id: o.id,
          startsAt: new Date(o.starts_at),
          endsAt: o.ends_at ? new Date(o.ends_at) : null,
        })),
      );
      setPreviousClosesAt(deadline);
      setClosesAt(deadline);
    })();
  }, [id]);

  if (!poll) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </Screen>
    );
  }

  async function save(confirmed: boolean) {
    if (!poll) return;
    setFormError(null);
    const now = () => new Date();
    const keepIds = unchangedOptionIds(poll.options, options);
    const parsed = makeDatePollInputSchema(now, { keepIds, previousClosesAt }).safeParse({
      options: options.map((o) => ({
        id: o.id,
        startsAt: o.startsAt,
        ...(o.endsAt ? { endsAt: o.endsAt } : {}),
      })),
      closesAt,
    });
    const pe = pollErrors(parsed);
    setErrors(pe);
    if (pe) return;

    const lost = votesToDelete(poll, options);
    if (lost > 0 && !confirmed) {
      Alert.alert(t('polls.delete_votes_title', { count: lost }), t('polls.delete_votes_body'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('polls.delete_votes_confirm'),
          style: 'destructive',
          onPress: () => void save(true),
        },
      ]);
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc('set_poll_options', {
      p_event_id: id,
      p_options: options.map((o) => ({
        id: o.id ?? null,
        starts_at: o.startsAt.toISOString(),
        ends_at: o.endsAt ? o.endsAt.toISOString() : null,
      })),
      p_closes_at: closesAt ? closesAt.toISOString() : undefined,
    });
    setBusy(false);
    if (error) {
      setFormError(t(`errors.${errorKey(error)}`, t('common.error')));
      return;
    }
    router.back();
  }

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 60 }}
    >
      <Body muted>{t('polls.delete_votes_body')}</Body>
      <PollOptionsEditor
        options={options}
        onChange={setOptions}
        closesAt={closesAt}
        onChangeClosesAt={setClosesAt}
        errors={errors}
        now={() => new Date()}
      />
      <ErrorText testID="form-error">{formError}</ErrorText>
      <Button
        testID="save-poll"
        title={t('polls.save_options')}
        loading={busy}
        onPress={() => void save(false)}
      />
    </KeyboardAwareScrollView>
  );
}
