import {
  formatHostNames,
  formatTimeRange,
  hostedByKey,
  inviteUrl,
  mapsUrl,
  type InvitePoll,
  type MyVotes,
  type RsvpStatus,
  type VoteChoice,
} from '@check-in/shared';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text } from 'react-native';

import { AnnouncementList, AnnouncementsCard, type AnnouncementItem } from '@/components/announcements';
import { Cover } from '@/components/cover';
import { KeyboardScroll } from '@/components/keyboard-scroll';
import { PollVoting } from '@/components/poll-voting';
import { CountsLine, RsvpControls, rsvpErrorText, type RsvpInvite } from '@/components/rsvp-controls';
import { Body, Button, ErrorText, Screen, Spinner, Title, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { INVITE_BASE_URL } from '@/lib/config';
import { locale } from '@/lib/i18n';
import { managedEventIdForToken } from '@/lib/invite-access';
import { errorKey } from '@/lib/events';
import { maybeAskForPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';

interface Invite extends RsvpInvite {
  state: 'not_found' | 'cancelled' | 'past' | 'active' | 'date_pending';
  event?: RsvpInvite['event'] & {
    title: string;
    description?: string | null;
    /** Null while a date poll is open. */
    starts_at: string | null;
    ends_at?: string | null;
    time_zone: string;
    location_text: string;
    latitude?: number | null;
    longitude?: number | null;
    cover_path?: string | null;
    theme?: string;
  };
  host?: { display_name: string | null };
  co_hosts?: { display_name: string | null }[];
  announcements?: AnnouncementItem[];
  /** Date poll (add-date-polls), state 'date_pending' only. */
  poll?: InvitePoll;
  my_votes?: MyVotes | null;
}

/** In-app view of an invite link (opened via universal link or checkin://i/<token>). */
export default function InviteInApp() {
  const { t } = useTranslation();
  const c = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, profile } = useAuth();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const userId = session?.user.id;
  const load = useCallback(async () => {
    const [{ data }, managedId] = await Promise.all([
      supabase.rpc('get_invite', { p_token: token }),
      userId ? managedEventIdForToken(token) : Promise.resolve(null),
    ]);
    // Hosts and co-hosts opening their own invite link get the host view, not the guest RSVP form.
    if (managedId) {
      router.replace(`/events/${managedId}`);
      return;
    }
    setInvite((data as unknown as Invite) ?? { state: 'not_found' });
  }, [token, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!invite) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Spinner />
      </Screen>
    );
  }

  if (invite.state === 'not_found' || invite.state === 'cancelled' || !invite.event) {
    return (
      <Screen>
        <Title>{invite.state === 'cancelled' ? invite.event?.title : t('invite.not_found_title')}</Title>
        <Body muted>{invite.state === 'cancelled' ? t('invite.cancelled_body') : t('invite.not_found_body')}</Body>
        {/* Cancelled events keep a read-only wall (add-event-wall). */}
        {invite.state === 'cancelled' && session && profile?.display_name ? (
          <Button
            testID="open-wall"
            variant="secondary"
            title={t('wall.open')}
            onPress={() => router.push({ pathname: '/wall', params: { token } })}
          />
        ) : null}
      </Screen>
    );
  }

  const e = invite.event;
  const signedIn = !!session && !!profile?.display_name;
  const canRsvp = invite.state === 'active' && signedIn;

  async function vote(votes: { option_id: string; choice: VoteChoice }[]) {
    setError(null);
    if (votes.length === 0) {
      setError(t('errors.no_votes'));
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('vote_as_user', { p_token: token, p_votes: votes });
    setBusy(false);
    if (rpcError) setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
    else void maybeAskForPush('rsvp');
    // Always reload: a rejected ballot means the poll changed (picked, closed or edited).
    await load();
  }

  async function withdrawVotes() {
    setError(null);
    setBusy(true);
    await supabase.rpc('withdraw_votes_as_user', { p_token: token });
    setBusy(false);
    await load();
  }

  async function respond(status: RsvpStatus, plusOnes?: number) {
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('rsvp_as_user', {
      p_token: token,
      p_status: status,
      p_plus_ones: plusOnes,
    });
    setBusy(false);
    if (rpcError) setError(rsvpErrorText(t, rpcError, e.max_plus_ones));
    else {
      await load();
      void maybeAskForPush('rsvp');
    }
  }

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }}>
      <Cover coverPath={e.cover_path} theme={e.theme} height={200} />
      <Title>{e.title}</Title>
      <Body muted>{t(`invite.${hostedByKey(invite.host?.display_name, (invite.co_hosts ?? []).map((h) => h.display_name))}`, {
          name: formatHostNames(invite.host?.display_name, (invite.co_hosts ?? []).map((h) => h.display_name), locale),
        })}</Body>
      <Body>
        {e.starts_at
          ? formatTimeRange(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, locale, e.time_zone)
          : t('polls.date_tbd')}
      </Body>
      <Pressable
        testID="invite-location"
        accessibilityRole="link"
        onPress={() => Linking.openURL(mapsUrl({ latitude: e.latitude, longitude: e.longitude, query: e.location_text }))}
      >
        <Text style={{ color: c.accent, fontSize: 16 }}>📍 {e.location_text}</Text>
      </Pressable>
      {e.description ? <Body muted>{e.description}</Body> : null}
      {invite.state === 'past' ? <Body muted>{t('invite.past_body')}</Body> : null}
      {invite.announcements?.length ? (
        <AnnouncementsCard title={t('announcements.title')}>
          <AnnouncementList items={invite.announcements} />
        </AnnouncementsCard>
      ) : null}

      {invite.state === 'date_pending' && invite.poll ? (
        <>
          <PollVoting
            poll={invite.poll}
            myVotes={invite.my_votes ?? null}
            timeZone={e.time_zone}
            busy={busy}
            onSave={signedIn ? (v) => void vote(v) : undefined}
            onWithdraw={signedIn ? () => void withdrawVotes() : undefined}
          />
          {!signedIn && invite.poll.voting_open ? (
            <Button
              testID="vote-in-browser"
              title={t('polls.vote_in_browser')}
              onPress={() => WebBrowser.openBrowserAsync(inviteUrl(INVITE_BASE_URL, token))}
            />
          ) : null}
        </>
      ) : canRsvp ? (
        <RsvpControls invite={invite} busy={busy} onRespond={(s, n) => void respond(s, n)} />
      ) : invite.state === 'active' ? (
        <Button
          title={t('rsvp.going')}
          onPress={() => WebBrowser.openBrowserAsync(inviteUrl(INVITE_BASE_URL, token))}
        />
      ) : null}
      <ErrorText>{error}</ErrorText>
      {invite.state === 'date_pending' ? null : <CountsLine counts={invite.counts} />}
      {signedIn ? (
        <Button
          testID="open-wall"
          variant="secondary"
          title={t('wall.open')}
          onPress={() => router.push({ pathname: '/wall', params: { token, title: e.title } })}
        />
      ) : null}
      {!session ? <Button variant="ghost" title={t('invite.get_app')} onPress={() => router.replace('/sign-in')} /> : null}
    </KeyboardScroll>
  );
}
