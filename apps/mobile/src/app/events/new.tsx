import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EventForm } from '@/components/event-form';
import { FormHeader } from '@/components/form-header';
import { useAuth } from '@/lib/auth';
import { errorKey, toEventRow, toPollEventArgs } from '@/lib/events';
import { supabase } from '@/lib/supabase';
import { maybeAskForPush } from '@/lib/push';
import { pickAndUpload } from '@/lib/upload';
import { useDiscardGuard } from '@/lib/use-discard-guard';

export default function NewEvent() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session!.user.id;
  const [dirty, setDirty] = useState(false);
  const allowLeave = useDiscardGuard(dirty);

  return (
    <EventForm
      submitLabel={t('events.create')}
      allowPoll
      onDirtyChange={setDirty}
      renderHeader={({ submit, busy }) => (
        <FormHeader saveLabel={t('events.create_short')} onSave={submit} busy={busy} />
      )}
      onPickCover={() => pickAndUpload('covers', userId, [16, 9])}
      onSubmit={async (values) => {
        let id: string;
        if (values.poll) {
          // "Let guests vote" (add-date-polls): a date-pending event with its options, in one transaction.
          const { data, error } = await supabase.rpc('create_poll_event', toPollEventArgs({ ...values, poll: values.poll }));
          const created = data as { event_id?: string } | null;
          if (error || !created?.event_id) return errorKey(error);
          id = created.event_id;
        } else {
          const { data, error } = await supabase
            .from('events')
            .insert({ ...toEventRow(values), host_id: userId })
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
