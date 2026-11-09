import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert } from 'react-native';

import { EventForm, localDate, type EventFormValues, type FormGroup } from '@/components/event-form';
import { FormHeader } from '@/components/form-header';
import { Screen, useColors } from '@/components/ui';
import { showActionSheet } from '@/lib/action-sheet';
import { useAuth } from '@/lib/auth';
import { errorKey, toEventDetailsRow, toEventRow } from '@/lib/events';
import { loadManagedGroups } from '@/lib/groups';
import { supabase, type EventRow } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { useDiscardGuard } from '@/lib/use-discard-guard';

/**
 * Which dates a group admin's edit of a series date applies to (spec: recurring-events "Edit this date or
 * all following"). Moving to another day is a single-date change.
 */
async function pickScope(
  t: (k: string) => string,
  dayChanged: boolean,
): Promise<'this' | 'following' | null> {
  if (dayChanged) {
    return new Promise((resolve) =>
      Alert.alert(t('series.edit_scope_title'), t('series.day_change_hint'), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
        { text: t('series.this_date'), onPress: () => resolve('this') },
      ]),
    );
  }
  const index = await showActionSheet(
    [{ label: t('series.this_date') }, { label: t('series.this_and_following') }],
    { title: `${t('series.edit_scope_title')}\n${t('series.following_hint')}`, cancelLabel: t('common.cancel') },
  );
  return index === null ? null : index === 0 ? 'this' : 'following';
}

export default function EditEvent() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { session } = useAuth();
  const [event, setEvent] = useState<EventRow | null>(null);
  // Series date managed as a group admin: the edit can apply to following dates.
  const [seriesAdmin, setSeriesAdmin] = useState(false);
  // One-off event owned by the user: the invited group can be changed (add-groups-and-recurring-events).
  const [groups, setGroups] = useState<FormGroup[] | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const allowLeave = useDiscardGuard(dirty);

  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (!data) {
          // No row: no longer allowed to manage this event (e.g. removed as co-host).
          if (!error) Alert.alert(t('co_hosts.no_longer'), undefined, [{ text: 'OK', onPress: () => router.back() }]);
          return;
        }
        if (data.series_id) {
          const { data: admin } = await supabase.rpc('is_series_admin', { p_series_id: data.series_id });
          setSeriesAdmin(!!admin);
        } else if (data.host_id === session?.user.id && data.starts_at) {
          const managed = await loadManagedGroups();
          // Keep a group the owner no longer administers visible, so saving doesn't silently drop it.
          setGroups(managed);
        }
        setEvent(data);
      });
  }, [id, t, session?.user.id]);

  if (!event) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <ActivityIndicator color={c.accent} />
      </Screen>
    );
  }

  // Date pending (add-date-polls): the time is set by picking an option; times are edited on the poll screen.
  const pending = event.starts_at === null;
  const originalStart = event.starts_at ? new Date(event.starts_at) : new Date();

  async function save(values: EventFormValues): Promise<string | void> {
    const row = pending ? toEventDetailsRow(values) : toEventRow(values);
    if (event!.series_id && seriesAdmin) {
      const scope = await pickScope(t, localDate(values.startsAt) !== localDate(originalStart));
      if (!scope) return;
      if (scope === 'following') {
        const { error } = await supabase.rpc('update_series_from', { p_event_id: id, p_patch: row });
        if (error) return errorKey(error);
        allowLeave();
        router.back();
        return;
      }
    }
    const withGroup = groups !== undefined ? { ...row, group_id: values.groupId ?? null } : row;
    const { data, error } = await supabase.from('events').update(withGroup).eq('id', id).select('id');
    if (error) return errorKey(error);
    if (!data?.length) return 'no_access';
    allowLeave();
    router.back();
  }

  return (
    <EventForm
      submitLabel={t('common.save')}
      datePending={pending}
      groups={groups}
      onDirtyChange={setDirty}
      renderHeader={({ submit, busy }) => (
        <FormHeader saveLabel={t('common.save')} onSave={submit} busy={busy} />
      )}
      // Past start times are only a problem if the host changes them.
      now={() => new Date(Math.min(Date.now(), originalStart.getTime() - 1))}
      initial={{
        title: event.title,
        startsAt: pending ? undefined : originalStart,
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
        groupId: event.group_id,
      }}
      onPickCover={() => pickAndUpload('covers', `e/${id}`, [16, 9])}
      onSubmit={save}
    />
  );
}
