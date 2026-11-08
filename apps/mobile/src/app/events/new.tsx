import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EventForm } from '@/components/event-form';
import { useAuth } from '@/lib/auth';
import { errorKey, toEventRow } from '@/lib/events';
import { supabase } from '@/lib/supabase';
import { maybeAskForPush } from '@/lib/push';
import { pickAndUpload } from '@/lib/upload';

export default function NewEvent() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session!.user.id;

  return (
    <EventForm
      submitLabel={t('events.create')}
      onPickCover={() => pickAndUpload('covers', userId, [16, 9])}
      onSubmit={async (values) => {
        const { data, error } = await supabase
          .from('events')
          .insert({ ...toEventRow(values), host_id: userId })
          .select('id')
          .single();
        if (error || !data) return errorKey(error);
        router.replace({ pathname: '/events/[id]', params: { id: data.id, created: '1' } });
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
