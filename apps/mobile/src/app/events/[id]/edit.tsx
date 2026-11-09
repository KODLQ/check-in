import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert } from 'react-native';

import { EventForm } from '@/components/event-form';
import { Screen } from '@/components/ui';
import { errorKey, toEventRow } from '@/lib/events';
import { supabase, type EventRow } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';

export default function EditEvent() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventRow | null>(null);

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (data) setEvent(data);
        // No row: no longer allowed to manage this event (e.g. removed as co-host).
        else if (!error) Alert.alert(t('co_hosts.no_longer'), undefined, [{ text: 'OK', onPress: () => router.back() }]);
      });
  }, [id, t]);

  if (!event) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <ActivityIndicator />
      </Screen>
    );
  }

  const originalStart = new Date(event.starts_at);

  return (
    <EventForm
      submitLabel={t('common.save')}
      // Past start times are only a problem if the host changes them.
      now={() => new Date(Math.min(Date.now(), originalStart.getTime() - 1))}
      initial={{
        title: event.title,
        startsAt: originalStart,
        endsAt: event.ends_at ? new Date(event.ends_at) : undefined,
        locationText: event.location_text,
        placeName: event.place_name ?? undefined,
        latitude: event.latitude ?? undefined,
        longitude: event.longitude ?? undefined,
        description: event.description ?? undefined,
        theme: event.theme,
        coverPath: event.cover_path,
        guestListVisible: event.guest_list_visible,
        allowPlusOnes: event.allow_plus_ones,
        maxPlusOnes: event.max_plus_ones,
        capacity: event.capacity,
      }}
      onPickCover={() => pickAndUpload('covers', `e/${id}`, [16, 9])}
      onSubmit={async (values) => {
        const { data, error } = await supabase.from('events').update(toEventRow(values)).eq('id', id).select('id');
        if (error) return errorKey(error);
        if (!data?.length) return 'no_access';
        router.back();
      }}
    />
  );
}
