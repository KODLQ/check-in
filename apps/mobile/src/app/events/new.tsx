import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EventForm, type EventFormValues, type FormGroup } from '@/components/event-form';
import { FormHeader } from '@/components/form-header';
import { Spinner, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorKey, toEventRow, toPollEventArgs } from '@/lib/events';
import { loadManagedGroups } from '@/lib/groups';
import { supabase } from '@/lib/supabase';
import { maybeAskForPush } from '@/lib/push';
import { pickAndUpload } from '@/lib/upload';
import { useDiscardGuard } from '@/lib/use-discard-guard';

/** Creates the series (and its group first, when new). Returns the first date's id or an error key. */
async function createSeries(values: EventFormValues & { repeat: NonNullable<EventFormValues['repeat']> }) {
  let groupId = values.repeat.groupId;
  if (values.repeat.newGroupName) {
    const { data, error } = await supabase.rpc('create_group', { p_name: values.repeat.newGroupName });
    if (error || !data) return { error: errorKey(error) };
    groupId = data as string;
  }
  const { data, error } = await supabase.rpc('create_series', {
    p_group_id: groupId!,
    p_event: toEventRow(values),
    p_frequency: values.repeat.frequency,
    p_ends_on: values.repeat.endsOn ?? undefined,
  });
  const created = data as { event_id?: string } | null;
  if (error || !created?.event_id) return { error: errorKey(error) };
  return { id: created.event_id };
}

export default function NewEvent() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session!.user.id;
  // From a group's "New repeating event": start as a weekly series of that group.
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const [groups, setGroups] = useState<FormGroup[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const allowLeave = useDiscardGuard(dirty);

  useEffect(() => {
    void loadManagedGroups().then(setGroups);
  }, []);

  if (!groups) return <Spinner style={{ flex: 1, backgroundColor: c.bg }} />;

  return (
    <EventForm
      submitLabel={t('events.create')}
      allowPoll
      allowRepeat
      groups={groups}
      initial={
        groupId && groups.some((g) => g.id === groupId)
          ? { repeat: { frequency: 'weekly', groupId, endsOn: null, newGroupName: null } }
          : undefined
      }
      onDirtyChange={setDirty}
      renderHeader={({ submit, busy }) => (
        <FormHeader saveLabel={t('events.create_short')} onSave={submit} busy={busy} />
      )}
      onPickCover={() => pickAndUpload('covers', userId, [16, 9])}
      onSubmit={async (values) => {
        let id: string;
        if (values.repeat) {
          // Repeating (add-groups-and-recurring-events): the series and its first dates, for a group.
          const result = await createSeries({ ...values, repeat: values.repeat });
          if ('error' in result) return result.error;
          id = result.id;
        } else if (values.poll) {
          // "Let guests vote" (add-date-polls): a date-pending event with its options, in one transaction.
          const { data, error } = await supabase.rpc('create_poll_event', toPollEventArgs({ ...values, poll: values.poll }));
          const created = data as { event_id?: string } | null;
          if (error || !created?.event_id) return errorKey(error);
          id = created.event_id;
        } else {
          const { data, error } = await supabase
            .from('events')
            .insert({ ...toEventRow(values), host_id: userId, group_id: values.groupId ?? null })
            .select('id')
            .single();
          if (error || !data) return errorKey(error);
          id = data.id;
        }
        allowLeave();
        router.replace({ pathname: '/events/[id]', params: { id, created: '1' } });
        // Ask for notifications only after the host's first event (spec: push permission timing).
        const { count } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('host_id', userId);
        if (count === 1) void maybeAskForPush('first_event');
      }}
    />
  );
}
