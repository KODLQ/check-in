import { formatHostNames, formatTimeRange, hostedByKey, type RsvpStatus } from '@check-in/shared';
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
import { answerLine, CountsLine, RsvpControls, rsvpErrorText, type RsvpInvite } from '@/components/rsvp-controls';
import { Body, Button, ErrorText, Screen, Title, useColors } from '@/components/ui';
import { locale } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { wallApi } from '@/lib/wall';
import { withdrawChoices } from '@/components/wall';

interface MyInviteDetail extends RsvpInvite {
  state: 'not_found' | 'cancelled' | 'past' | 'active';
  event?: RsvpInvite['event'] & {
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
  co_hosts?: { display_name: string | null }[];
  guests?: { display_name: string; status: RsvpStatus; plus_ones?: number }[] | null;
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

  async function respond(status: RsvpStatus, plusOnes?: number) {
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('set_my_rsvp', {
      p_event_id: eventId,
      p_status: status,
      p_plus_ones: plusOnes,
    });
    setBusy(false);
    if (rpcError) setError(rsvpErrorText(t, rpcError, e.max_plus_ones));
    await load();
  }

  async function withdraw() {
    // Wall posts are kept unless the guest picks "also delete" (spec: event-rsvp "Change or withdraw RSVP").
    const wall = await wallApi.feed({ eventId }).catch(() => null);
    const hasPosts = wall?.state === 'ok' && wall.has_own_posts;
    Alert.alert(t('invites.withdraw_confirm_title'), t('invites.withdraw_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      ...withdrawChoices(hasPosts, t).map((choice) => ({
        text: choice.label,
        style: 'destructive' as const,
        onPress: () => void withdrawWith(choice.key === 'delete_posts'),
      })),
    ]);
  }

  async function withdrawWith(deletePosts: boolean) {
    setError(null);
    if (deletePosts) {
      // Posts first, while the RSVP still links this account to posts made from a claimed browser.
      try {
        await wallApi.deleteMine({ eventId });
      } catch {
        setError(t('common.error'));
        return;
      }
    }
    // Withdrawing goes through remove_rsvp (not a table DELETE) so a freed spot is passed on to
    // the waitlist (spec: my-invites "Withdraw frees a spot").
    const { data: own } = await supabase
      .from('rsvps')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', session?.user.id ?? '')
      .maybeSingle();
    const { data: removed, error: delError } = own
      ? await supabase.rpc('remove_rsvp', { p_rsvp_id: own.id })
      : { data: false, error: null };
    if (delError || !removed) setError(t('common.error'));
    else router.back();
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 14 }}
    >
      <Cover coverPath={e.cover_path} theme={e.theme} height={200} />
      <Title>{e.title}</Title>
      <Body muted>{t(`invite.${hostedByKey(invite.host?.display_name, (invite.co_hosts ?? []).map((h) => h.display_name))}`, {
          name: formatHostNames(invite.host?.display_name, (invite.co_hosts ?? []).map((h) => h.display_name), locale),
        })}</Body>
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

      {open ? (
        <>
          <RsvpControls invite={invite} busy={busy} onRespond={(s, n) => void respond(s, n)} />
          <Button testID="withdraw" variant="ghost" title={t('rsvp.remove')} onPress={() => void withdraw()} />
        </>
      ) : invite.my_rsvp ? (
        <Text testID="my-answer" style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
          {answerLine(t, invite.my_rsvp)}
        </Text>
      ) : null}
      <ErrorText>{error}</ErrorText>

      <Button
        testID="open-wall"
        variant="secondary"
        title={t('wall.open')}
        onPress={() => router.push({ pathname: '/wall', params: { eventId, title: e.title } })}
      />

      <CountsLine counts={invite.counts} />
      {invite.guests?.length ? (
        <View testID="guest-list" style={{ gap: 4 }}>
          {invite.guests.map((g, i) => (
            <Body key={i}>
              {g.display_name}
              {g.status === 'going' && (g.plus_ones ?? 0) > 0 ? ` +${g.plus_ones}` : ''}
              {g.status === 'maybe' ? ` · ${t('rsvp.maybe')}` : ''}
            </Body>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
