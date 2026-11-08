import { formatTimeRange, type RsvpStatus } from '@check-in/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import {
  AnnouncementList,
  AnnouncementsCard,
  type AnnouncementItem,
} from '@/components/announcements';
import { Cover } from '@/components/cover';
import { Body, Button, ErrorText, Screen, Title, useColors } from '@/components/ui';
import { errorKey } from '@/lib/events';
import { locale } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const STATUSES: RsvpStatus[] = ['going', 'maybe', 'declined'];

interface MyInviteDetail {
  state: 'not_found' | 'cancelled' | 'past' | 'active';
  event?: {
    title: string;
    description?: string | null;
    starts_at: string;
    ends_at?: string | null;
    time_zone: string;
    location_text?: string;
    cover_path?: string | null;
    theme?: string;
  };
  host?: { display_name: string | null };
  counts?: { going: number; maybe: number };
  guests?: { display_name: string; status: RsvpStatus }[] | null;
  my_rsvp?: { status: RsvpStatus; display_name: string } | null;
  announcements?: AnnouncementItem[];
}

/** An invite from the home list (keyed by event id), using get_my_invite / set_my_rsvp (spec: my-invites). */
export default function MyInviteScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const [invite, setInvite] = useState<MyInviteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_my_invite', { p_event_id: eventId });
    setInvite((data as unknown as MyInviteDetail | null) ?? { state: 'not_found' });
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!invite) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (invite.state === 'not_found' || !invite.event) {
    return (
      <Screen>
        <Title>{t('invite.not_found_title')}</Title>
      </Screen>
    );
  }

  const e = invite.event;
  const open = invite.state === 'active';

  async function respond(status: RsvpStatus) {
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('set_my_rsvp', {
      p_event_id: eventId,
      p_status: status,
    });
    setBusy(false);
    if (rpcError) setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
    await load();
  }

  function withdraw() {
    Alert.alert(t('invites.withdraw_confirm_title'), t('invites.withdraw_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('rsvp.remove'),
        style: 'destructive',
        onPress: async () => {
          setError(null);
          // RLS lets a user delete their own response (user_id = auth.uid()).
          const { error: delError } = await supabase
            .from('rsvps')
            .delete()
            .eq('event_id', eventId)
            .eq('user_id', session?.user.id ?? '');
          if (delError) setError(t('common.error'));
          else router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 14 }}
    >
      <Cover coverPath={e.cover_path} theme={e.theme} height={200} />
      <Title>{e.title}</Title>
      <Body muted>{t('invite.hosted_by', { name: invite.host?.display_name ?? '' })}</Body>
      <Body>
        {formatTimeRange(
          new Date(e.starts_at),
          e.ends_at ? new Date(e.ends_at) : null,
          locale,
          e.time_zone,
        )}
      </Body>
      {e.location_text ? <Body>📍 {e.location_text}</Body> : null}
      {e.description ? <Body muted>{e.description}</Body> : null}
      {invite.state === 'cancelled' ? <Body muted>{t('invites.closed_cancelled')}</Body> : null}
      {invite.state === 'past' ? <Body muted>{t('invites.closed_past')}</Body> : null}
      {invite.announcements?.length ? (
        <AnnouncementsCard title={t('announcements.title')}>
          <AnnouncementList items={invite.announcements} />
        </AnnouncementsCard>
      ) : null}

      {invite.my_rsvp ? (
        <Text testID="my-answer" style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
          {t('rsvp.your_answer', { status: t(`rsvp.${invite.my_rsvp.status}`) })}
        </Text>
      ) : null}

      {open ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {STATUSES.map((s) => (
              <View key={s} style={{ flex: 1 }}>
                <Button
                  testID={`answer-${s}`}
                  variant={invite.my_rsvp?.status === s ? 'primary' : 'secondary'}
                  title={t(`rsvp.${s}`)}
                  disabled={busy}
                  onPress={() => respond(s)}
                />
              </View>
            ))}
          </View>
          <Button testID="withdraw" variant="ghost" title={t('rsvp.remove')} onPress={withdraw} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>

      {invite.counts ? (
        <Text style={{ color: c.muted }}>
          {invite.counts.going === 1
            ? t('rsvp.people_going_one')
            : t('rsvp.people_going', { count: invite.counts.going })}
        </Text>
      ) : null}
      {invite.guests?.length ? (
        <View testID="guest-list" style={{ gap: 4 }}>
          {invite.guests.map((g, i) => (
            <Body key={i}>
              {g.display_name}
              {g.status === 'maybe' ? ` · ${t('rsvp.maybe')}` : ''}
            </Body>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
