import {
  formatOption,
  formatRepeatRule,
  formatTimeRange,
  hasEventEnded,
  headCount,
  inviteUrl,
  mapsUrl,
  pickOutcome,
  tally,
} from '@check-in/shared';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, Share, Text, View } from 'react-native';
import type { KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';

import { AnnouncementComposer, AnnouncementList, AnnouncementsCard, type AnnouncementItem } from '@/components/announcements';
import { Cover } from '@/components/cover';
import { GuestList, promoteGuest, type GuestRow } from '@/components/guest-list';
import { HostsCard } from '@/components/hosts-card';
import { KeyboardScroll } from '@/components/keyboard-scroll';
import { PollResults } from '@/components/poll-results';
import { StoryShareButton } from '@/components/story-share-button';
import { Toast } from '@/components/toast';
import { Body, Button, Card, HeaderButton, Label, Screen, Spinner, Title, Toggle, useColors } from '@/components/ui';
import { showActionSheet } from '@/lib/action-sheet';
import { useAuth } from '@/lib/auth';
import { INVITE_BASE_URL } from '@/lib/config';
import { errorKey, fetchActiveInvite } from '@/lib/events';
import { locale } from '@/lib/i18n';
import { allVotes, loadHostPoll, type HostPoll, type PollOptionRow, type PollVoterRow } from '@/lib/polls';
import { supabase, type EventRow, type RsvpRow } from '@/lib/supabase';
import { wallApi, wallErrorKey } from '@/lib/wall';

/** While the screen is focused, re-check access this often so a removed co-host is told promptly. */
const ACCESS_CHECK_MS = 30_000;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function EventDetail() {
  const { t } = useTranslation();
  const c = useColors();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [event, setEvent] = useState<EventRow | null>(null);
  // RLS returns no row once you are no longer the owner or a co-host (removed, left, event deleted).
  const [gone, setGone] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [rsvps, setRsvps] = useState<RsvpRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  // Date poll (add-date-polls): only while the event's date is pending.
  const [poll, setPoll] = useState<HostPoll | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  // "Your event is ready" banner: until dismissed, the first share, or leaving the screen.
  const [showCreated, setShowCreated] = useState(!!created);
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const guestsY = useRef(0);
  // Groups and repeating events (add-groups-and-recurring-events): owner rights (the host, or a group admin
  // on a series date), the series rule, and who in the invited group has not answered.
  const [ownerRights, setOwnerRights] = useState(false);
  const [seriesAdmin, setSeriesAdmin] = useState(false);
  const [series, setSeries] = useState<{ frequency: 'weekly' | 'biweekly' | 'monthly'; anchor_local_date: string; ends_on: string | null } | null>(null);
  const [groupInfo, setGroupInfo] = useState<{ group_name: string; not_answered: number; member_user_ids: string[] } | null>(null);

  const loadAnnouncements = useCallback(async () => {
    const { data } = await supabase
      .from('event_announcements')
      .select('id, body, created_at')
      .eq('event_id', id)
      .order('created_at', { ascending: false });
    setAnnouncements((data ?? []).filter((a): a is AnnouncementItem => a.body !== null));
  }, [id]);

  const loadRsvps = useCallback(async () => {
    const { data } = await supabase.from('rsvps').select('*').eq('event_id', id).order('created_at');
    setRsvps(data ?? []);
  }, [id]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (!data) {
      if (!error) setGone(true);
      return;
    }
    // Event and invite link appear together, so the share buttons don't pop in and shift the page.
    const [nextToken, owner, admin, rule, summary] = await Promise.all([
      fetchActiveInvite(id),
      supabase.rpc('is_event_owner', { p_event_id: id }),
      data.series_id ? supabase.rpc('is_series_admin', { p_series_id: data.series_id }) : Promise.resolve({ data: false }),
      data.series_id
        ? supabase.from('event_series').select('frequency, anchor_local_date, ends_on').eq('id', data.series_id).maybeSingle()
        : Promise.resolve({ data: null }),
      data.group_id ? supabase.rpc('group_event_summary', { p_event_id: id }) : Promise.resolve({ data: null }),
    ]);
    setToken(nextToken);
    setOwnerRights(!!owner?.data);
    setSeriesAdmin(!!admin?.data);
    setSeries((rule?.data as typeof series) ?? null);
    setGroupInfo((summary?.data as unknown as typeof groupInfo) ?? null);
    setEvent(data);
    await Promise.all([
      loadRsvps(),
      loadAnnouncements(),
      data.starts_at === null ? loadHostPoll(id).then(setPoll) : Promise.resolve(setPoll(null)),
    ]);
  }, [id, loadRsvps, loadAnnouncements]);

  const checkAccess = useCallback(async () => {
    const { data, error } = await supabase.from('events').select('id').eq('id', id).maybeSingle();
    if (!data && !error) setGone(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void checkAccess(), ACCESS_CHECK_MS);
      return () => {
        clearInterval(timer);
        setShowCreated(false);
      };
    }, [load, checkAccess]),
  );

  useEffect(() => {
    if (!gone) return;
    Alert.alert(t('co_hosts.no_longer'), undefined, [{ text: t('common.ok'), onPress: goBack }]);
  }, [gone, t]);

  // Live guest list (Realtime respects RLS, so only the host receives these rows).
  useEffect(() => {
    const channel = supabase
      // Unique per mount: the same event screen can be on the stack twice (e.g. opened from a notification).
      .channel(`rsvps:${id}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps', filter: `event_id=eq.${id}` }, () => {
        void loadRsvps();
        void checkAccess();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, loadRsvps, checkAccess]);

  // Live poll results: a ballot touches its voter row, so voters + options cover every change. A pick by
  // another manager deletes the voters, which reloads the event as a dated one.
  const datePending = event?.starts_at === null;
  useEffect(() => {
    if (!datePending) return;
    const channel = supabase
      .channel(`poll:${id}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'date_poll_voters', filter: `event_id=eq.${id}` }, () => {
        void load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'date_poll_options', filter: `event_id=eq.${id}` }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, datePending, load]);

  if (gone) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Stack.Screen options={{ headerRight: undefined }} />
        <Title>{t('co_hosts.no_longer')}</Title>
        <Button testID="no-longer-back" title={t('common.back')} onPress={goBack} />
      </Screen>
    );
  }

  if (!event) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Spinner />
      </Screen>
    );
  }

  const link = token ? inviteUrl(INVITE_BASE_URL, token) : null;
  const pending = event.starts_at === null;
  const when = event.starts_at
    ? formatTimeRange(new Date(event.starts_at), event.ends_at ? new Date(event.ends_at) : null, locale, event.time_zone)
    : t('polls.date_tbd');
  const ended = hasEventEnded(event.starts_at ? new Date(event.starts_at) : null, event.ends_at ? new Date(event.ends_at) : null);
  const editable = !ended && !event.cancelled_at;
  // Owner-only actions (cancel, co-host management) are also enforced server-side. A group admin has them
  // on a date of the group's series too.
  const isOwner = ownerRights || (!!userId && event.host_id === userId);
  const ruleText = series ? formatRepeatRule(series.frequency, series.anchor_local_date, locale) : null;

  async function repeatSettings() {
    const options = (['weekly', 'biweekly', 'monthly'] as const).map((f) => ({ label: t(`series.${f}`), f }));
    const index = await showActionSheet(options, { title: t('series.settings'), cancelLabel: t('common.cancel') });
    if (index === null || !event?.series_id) return;
    const { error } = await supabase.rpc('update_series_rule', {
      p_series_id: event.series_id,
      p_frequency: options[index]!.f,
      // Null keeps the series open-ended (the generated type doesn't know the column is nullable).
      p_ends_on: (series?.ends_on ?? null) as unknown as string,
    });
    setToast(error ? t(`errors.${errorKey(error)}`, t('common.error')) : t('series.rule_saved'));
    await load();
  }

  async function endSeries() {
    const index = await showActionSheet(
      [{ label: t('series.end_keep') }, { label: t('series.end_cancel'), destructive: true }],
      { title: `${t('series.end_title', { title: event?.title ?? '' })}\n${t('series.end_body')}`, cancelLabel: t('common.cancel') },
    );
    if (index === null || !event?.series_id) return;
    const { error } = await supabase.rpc('end_series', { p_series_id: event.series_id, p_cancel_upcoming: index === 1 });
    setToast(error ? t(`errors.${errorKey(error)}`, t('common.error')) : t('series.ended_toast'));
    await load();
  }

  async function share() {
    if (!link || !event) return;
    setShowCreated(false);
    const shareWhen = pending ? t('polls.date_tbd_vote') : when;
    await Share.share({ message: `${t('events.share_message', { title: event.title, when: shareWhen })}\n${link}`, url: link });
  }

  function confirmPick(o: PollOptionRow) {
    if (!poll) return;
    const outcome = pickOutcome(tally(allVotes(poll), o.id), event?.capacity);
    const body = outcome.waitlisted > 0 ? 'polls.pick_confirm_body_waitlist' : 'polls.pick_confirm_body';
    Alert.alert(t('polls.pick_confirm_title', { when: formatOption(o, locale, event?.time_zone) }), t(body, outcome), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('polls.pick'),
        onPress: async () => {
          const { error } = await supabase.rpc('pick_poll_option', { p_option_id: o.id });
          if (error) setToast(t(`errors.${errorKey(error)}`, t('common.error')));
          else setToast(t('polls.picked', { when: formatOption(o, locale, event?.time_zone) }));
          await load();
        },
      },
    ]);
  }

  function removeVoter(v: PollVoterRow) {
    Alert.alert(v.display_name, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('polls.remove_voter'),
        style: 'destructive',
        onPress: async () => {
          await supabase.from('date_poll_voters').delete().eq('id', v.id);
          await load();
        },
      },
    ]);
  }

  async function copy() {
    if (!link) return;
    setShowCreated(false);
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function confirmCancel() {
    Alert.alert(t('events.cancel_confirm_title'), t('events.cancel_confirm_body'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('events.cancel_event'),
        style: 'destructive',
        onPress: async () => {
          await supabase.from('events').update({ cancelled_at: new Date().toISOString() }).eq('id', id);
          await load();
        },
      },
    ]);
  }

  function confirmRegenerate() {
    Alert.alert(t('events.regenerate_link'), t('events.regenerate_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('events.regenerate_link'),
        onPress: async () => {
          const { data } = await supabase.rpc('regenerate_invite', { p_event_id: id });
          if (data) setToken(data);
          else await load();
        },
      },
    ]);
  }

  // Event wall on/off (add-event-wall): through the API, allowed for the owner and co-hosts at any time,
  // including after the event ended or was cancelled.
  async function toggleWall(on: boolean) {
    setEvent({ ...event!, wall_enabled: on });
    try {
      await wallApi.setEnabled(id, on);
    } catch (e) {
      setToast(t(wallErrorKey(e)));
      setEvent({ ...event!, wall_enabled: !on });
    }
  }

  async function toggleGuestList(visible: boolean) {
    setEvent({ ...event!, guest_list_visible: visible });
    await supabase.from('events').update({ guest_list_visible: visible }).eq('id', id);
    await checkAccess();
  }

  function confirmLeave() {
    Alert.alert(t('co_hosts.leave_confirm_title'), t('co_hosts.leave_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('co_hosts.leave'),
        style: 'destructive',
        onPress: async () => {
          await supabase.rpc('leave_event', { p_event_id: id });
          goBack();
        },
      },
    ]);
  }

  function deleteAnnouncement(a: AnnouncementItem) {
    Alert.alert(t('announcements.delete_confirm'), t('announcements.delete_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await supabase.rpc('delete_announcement', { p_id: a.id });
          await loadAnnouncements();
        },
      },
    ]);
  }

  function removeGuest(r: GuestRow) {
    // Freeing a "going" spot on a full event moves the first waitlisted guest in.
    const promotes = r.status === 'going' && rsvps.some((x) => x.status === 'waitlisted');
    Alert.alert(
      t('rsvp.remove_guest_title', { name: r.display_name }),
      t(promotes ? 'rsvp.remove_guest_body_waitlist' : 'rsvp.remove_guest_body', { name: r.display_name }),
      [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('rsvp.remove_guest'),
        style: 'destructive',
        onPress: async () => {
          // An RPC, not a table DELETE: it locks the event and fills freed spots from the waitlist.
          const { error } = await supabase.rpc('remove_rsvp', { p_rsvp_id: r.id });
          if (error) setToast(t(`errors.${errorKey(error)}`, t('common.error')));
          await loadRsvps();
        },
      },
      ],
    );
  }

  const goingHeads = headCount(rsvps);
  const maybeCount = rsvps.filter((r) => r.status === 'maybe').length;
  const waitlistHeads = headCount(rsvps, 'waitlisted');
  const summary = [
    event.capacity != null
      ? t('events.going_of_capacity', { count: goingHeads, capacity: event.capacity })
      : t('events.going_count', { count: goingHeads }),
    t('events.maybe_count', { count: maybeCount }),
    ...(waitlistHeads > 0 ? [t('events.waitlist_count', { count: waitlistHeads })] : []),
    ...(groupInfo && groupInfo.not_answered > 0 ? [t('groups.not_answered_count', { count: groupInfo.not_answered })] : []),
  ].join(' · ');

  function scrollToGuests() {
    scrollRef.current?.scrollTo({ y: Math.max(0, guestsY.current - 12), animated: true });
  }

  async function promote(r: GuestRow) {
    const failed = await promoteGuest(
      (fn, args) => supabase.rpc(fn, args),
      t,
      r,
      rsvps,
      event?.capacity ?? null,
    );
    if (failed) setToast(t(`errors.${errorKey({ message: failed })}`, t('common.error')));
    await loadRsvps();
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: editable
            ? () => (
                <HeaderButton testID="edit-event" title={t('events.edit_event')} onPress={() => router.push(`/events/${id}/edit`)} />
              )
            : undefined,
        }}
      />
      <KeyboardScroll ref={scrollRef} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>
        {showCreated && editable ? (
          <Card style={{ backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, flex: 1 }}>{t('events.created')}</Text>
            <Pressable
              testID="dismiss-created"
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={() => setShowCreated(false)}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </Card>
        ) : null}

        <Cover coverPath={event.cover_path} theme={event.theme} height={200} />
        <Text style={{ fontSize: 28, fontWeight: '800', color: c.text }}>{event.title}</Text>
        {groupInfo || ruleText ? (
          <Text testID="event-group-line" style={{ color: c.muted, fontSize: 16, fontWeight: '600' }}>
            {[groupInfo?.group_name, ruleText].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {event.cancelled_at ? <Text style={{ color: c.danger, fontWeight: '700' }}>{t('events.cancelled')}</Text> : null}
        <Body>{when}</Body>
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            Linking.openURL(mapsUrl({ latitude: event.latitude, longitude: event.longitude, query: event.location_text }))
          }
        >
          <Text style={{ color: c.accent, fontSize: 16 }}>📍 {event.location_text}</Text>
        </Pressable>
        {event.description ? <Body muted>{event.description}</Body> : null}

        {/* Compact head count; tapping jumps to the guest list further down. */}
        {pending ? null : (
          <Pressable
            testID="guest-summary"
            accessibilityRole="button"
            onPress={scrollToGuests}
            style={({ pressed }) => ({
              backgroundColor: c.surface,
              borderRadius: 12,
              paddingVertical: 12,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '600', flex: 1 }}>{summary}</Text>
            <Text style={{ color: c.muted, fontSize: 18 }}>›</Text>
          </Pressable>
        )}

        {editable && link ? (
          <View style={{ gap: 10 }}>
            <Button testID="share" title={t('events.share')} onPress={share} />
            {token ? <StoryShareButton token={token} link={link} title={event.title} notify={setToast} /> : null}
            <Button variant="secondary" title={copied ? t('events.copied') : t('events.copy_link')} onPress={copy} />
            <Text selectable style={{ color: c.muted, textAlign: 'center' }} testID="invite-link">
              {link}
            </Text>
          </View>
        ) : null}

        {/* Date-pending events: the poll is the main thing to manage, right under the share actions. */}
        {pending && poll ? (
          <PollResults
            poll={poll}
            timeZone={event.time_zone}
            closesAt={event.poll_closes_at}
            editable={editable}
            onPick={confirmPick}
            onRemoveVoter={removeVoter}
            onEdit={() => router.push(`/events/${id}/poll`)}
          />
        ) : null}

        {editable || announcements.length > 0 ? (
          <AnnouncementsCard title={t('announcements.title')}>
            {editable ? <AnnouncementComposer eventId={id} onPosted={loadAnnouncements} /> : null}
            {announcements.length > 0 ? (
              <AnnouncementList items={announcements} onDelete={deleteAnnouncement} />
            ) : (
              <Body muted>{t('announcements.empty')}</Body>
            )}
          </AnnouncementsCard>
        ) : null}

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Label>{t('wall.title')}</Label>
              <Body muted>{event.wall_enabled ? t('wall.toggle_hint') : t('wall.off_host')}</Body>
            </View>
            <Toggle testID="wall-toggle" value={event.wall_enabled} onValueChange={(on) => void toggleWall(on)} />
          </View>
          <Button
            testID="open-wall"
            variant="secondary"
            title={t('wall.open')}
            onPress={() => router.push({ pathname: '/wall', params: { eventId: id, title: event.title } })}
          />
        </Card>

        <View
          testID="guests-section"
          style={{ gap: 16 }}
          onLayout={(e) => {
            guestsY.current = e.nativeEvent.layout.y;
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Label>{t('events.show_guest_list')}</Label>
            </View>
            <Toggle value={event.guest_list_visible} onValueChange={toggleGuestList} disabled={!editable} />
          </View>

          {pending ? null : (
            <GuestList
              memberIds={groupInfo ? new Set(groupInfo.member_user_ids) : undefined}
              rsvps={rsvps}
              capacity={event.capacity}
              editable={editable}
              onRemove={removeGuest}
              onPromote={(r) => void promote(r)}
            />
          )}
        </View>

        <HostsCard
          eventId={id}
          eventTitle={event.title}
          timeZone={event.time_zone}
          userId={userId}
          isOwner={isOwner}
          canInvite={editable}
          onAccessLost={checkAccess}
        />

        {editable ? (
          <View style={{ gap: 10, marginTop: 12 }}>
            <Button variant="secondary" title={t('events.regenerate_link')} onPress={confirmRegenerate} />
            {seriesAdmin ? (
              <>
                <Button testID="repeat-settings" variant="secondary" title={t('series.settings')} onPress={() => void repeatSettings()} />
                <Button testID="end-series" variant="secondary" title={t('series.end')} onPress={() => void endSeries()} />
              </>
            ) : null}
            {isOwner ? (
              <Button testID="cancel-event" variant="danger" title={t('events.cancel_event')} onPress={confirmCancel} />
            ) : null}
          </View>
        ) : null}
        {!isOwner && !seriesAdmin ? (
          <Button testID="leave-co-host" variant="ghost" title={t('co_hosts.leave')} onPress={confirmLeave} />
        ) : null}
      </KeyboardScroll>
      <Toast message={toast} onHide={hideToast} topOffset={64} />
    </>
  );
}
