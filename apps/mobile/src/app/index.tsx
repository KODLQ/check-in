import {
  buildHomeSections,
  formatEventTime,
  headCount,
  hostingNudge,
  pollNeedsPick,
  type HomeItem,
  type MyInvite,
} from '@check-in/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';

import { Cover } from '@/components/cover';
import { Body, Button, Card, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { locale } from '@/lib/i18n';
import { consumePendingCoHostInvite } from '@/lib/pending-co-host';
import { onInvitesClaimed } from '@/lib/pending-claim';
import { supabase, type EventRow } from '@/lib/supabase';

type HostedEvent = EventRow & {
  rsvps: { status: string; plus_ones: number }[];
  /** Date polls (add-date-polls): voter count and option times, only meaningful while starts_at is null. */
  date_poll_voters: { count: number }[];
  date_poll_options: { starts_at: string }[];
};
type Item = HomeItem<HostedEvent, MyInvite>;

/** "Plan your own" card dismissal is remembered on this device for 7 days. */
const PLAN_CARD_DISMISSED_KEY = 'ci_plan_card_dismissed_at';
const PLAN_CARD_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function PlanYourOwnCard({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <View testID="plan-own-card" style={{ marginBottom: 14 }}>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>{t('events.plan_own_title')}</Text>
        <Body muted>{t('events.plan_own_body')}</Body>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              testID="plan-own-cta"
              title={t('events.plan_own_cta')}
              onPress={() => router.push('/events/new')}
            />
          </View>
          <Button
            testID="plan-own-dismiss"
            variant="ghost"
            title={t('events.dismiss')}
            onPress={onDismiss}
          />
        </View>
      </Card>
    </View>
  );
}

function Badge({ label, testID }: { label: string; testID?: string }) {
  return (
    <Text
      testID={testID}
      style={{
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
        textTransform: 'uppercase',
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {label}
    </Text>
  );
}

export default function Events() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [hosted, setHosted] = useState<HostedEvent[] | null>(null);
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [cardDismissed, setCardDismissed] = useState(true);

  const load = useCallback(async () => {
    const [events, mine] = await Promise.all([
      supabase
        .from('events')
        .select('*, rsvps(status, plus_ones), date_poll_voters(count), date_poll_options(starts_at)')
        .order('starts_at', { ascending: true, nullsFirst: true }),
      supabase.rpc('list_my_invites'),
    ]);
    setHosted((events.data as HostedEvent[] | null) ?? []);
    setInvites((mine.data as unknown as MyInvite[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      // A co-host link opened before signing in / onboarding continues here (everyone lands on home).
      void consumePendingCoHostInvite().then((token) => {
        if (token) router.push(`/c/${token}`);
      });
    }, [load]),
  );
  // Web RSVPs claimed while this screen is open.
  useEffect(() => onInvitesClaimed(() => void load()), [load]);

  useEffect(() => {
    void AsyncStorage.getItem(PLAN_CARD_DISMISSED_KEY).then((at) => {
      setCardDismissed(!!at && Date.now() - Number(at) < PLAN_CARD_SNOOZE_MS);
    });
  }, []);

  const dismissCard = useCallback(() => {
    setCardDismissed(true);
    void AsyncStorage.setItem(PLAN_CARD_DISMISSED_KEY, String(Date.now()));
  }, []);

  const home = useMemo(
    () => buildHomeSections(hosted ?? [], invites, new Date()),
    [hosted, invites],
  );
  const nudge = hosted ? hostingNudge(home) : null;
  const sections = [
    { title: t('events.upcoming'), data: home.upcoming },
    { title: t('events.past'), data: home.past },
  ].filter((s) => s.data.length > 0);

  const renderItem = ({ item }: { item: Item }) => {
    const e = item.event;
    const when = e.starts_at ? formatEventTime(new Date(e.starts_at), locale, e.time_zone) : t('polls.date_tbd');
    let detail: string;
    let onPress: () => void;
    let needsPick = false;
    if (item.kind === 'hosted' && item.event.starts_at === null) {
      // Date pending: "Date TBD · N voted", marked when the poll waits for the host to pick (add-date-polls).
      const voters = item.event.date_poll_voters?.[0]?.count ?? 0;
      needsPick =
        !item.cancelled &&
        pollNeedsPick({ closes_at: item.event.poll_closes_at, options: item.event.date_poll_options ?? [] });
      detail = needsPick
        ? `${t('polls.voted_count', { count: voters })} · ${t('polls.needs_pick')}`
        : t('polls.voted_count', { count: voters });
      onPress = () => router.push(`/events/${item.id}`);
    } else if (item.kind === 'hosted') {
      // Going counts heads (guests + plus-ones), against the capacity when there is one.
      const going = headCount(item.event.rsvps);
      const maybe = item.event.rsvps.filter((r) => r.status === 'maybe').length;
      const goingText =
        item.event.capacity != null
          ? t('events.going_of_capacity', { count: going, capacity: item.event.capacity })
          : t('events.going_count', { count: going });
      detail = `${goingText} · ${t('events.maybe_count', { count: maybe })}`;
      onPress = () => router.push(`/events/${item.id}`);
    } else {
      const mine = item.event.my_rsvp;
      detail = t('events.hosted_by_answer', {
        name: item.event.host.display_name ?? '',
        status:
          mine.status === 'going' && (mine.plus_ones ?? 0) > 0
            ? t('rsvp.going_plus', { count: mine.plus_ones })
            : t(`rsvp.${mine.status}`),
      });
      onPress = () => router.push(`/invites/${item.id}`);
    }
    return (
      <Pressable
        testID={`${item.kind === 'hosted' ? 'event' : 'invite'}-${item.id}`}
        onPress={onPress}
      >
        <Cover
          coverPath={e.cover_path}
          theme={e.theme}
          height={150}
          style={{ opacity: item.past || item.cancelled ? 0.6 : 1 }}
        >
          <View style={{ position: 'absolute', top: 12, left: 12, flexDirection: 'row', gap: 6 }}>
            {item.kind === 'invite' ? (
              <Badge label={t('events.invited')} />
            ) : item.event.host_id === userId ? (
              <Badge label={t('events.hosting')} />
            ) : (
              // Hosted list = events RLS lets you manage: your own plus those you co-host.
              <Badge testID={`cohost-${item.id}`} label={t('events.co_host_badge')} />
            )}
            {item.cancelled ? (
              <Badge testID={`cancelled-${item.id}`} label={t('events.cancelled')} />
            ) : null}
            {item.past && !item.cancelled ? (
              <Badge testID={`past-${item.id}`} label={t('events.past_badge')} />
            ) : null}
            {needsPick ? <Badge testID={`needs-pick-${item.id}`} label={t('polls.needs_pick')} /> : null}
          </View>
          <View style={{ padding: 14, backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }} numberOfLines={1}>
              {e.title}
            </Text>
            <Text testID={`when-${item.id}`} style={{ color: '#fff' }}>{when}</Text>
            <Text style={{ color: '#fff' }} numberOfLines={1}>
              {detail}
            </Text>
          </View>
        </Cover>
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={12}>
                <Text style={{ fontSize: 22 }}>⚙︎</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 120 }}
        sections={sections}
        keyExtractor={(i) => `${i.kind}:${i.id}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          nudge === 'card' && !cardDismissed ? <PlanYourOwnCard onDismiss={dismissCard} /> : undefined
        }
        renderSectionHeader={({ section }) => (
          <Text
            style={{ color: c.muted, fontWeight: '700', textTransform: 'uppercase', marginTop: 8 }}
          >
            {section.title}
          </Text>
        )}
        ListEmptyComponent={
          hosted ? (
            <View testID="events-empty" style={{ paddingTop: 40, gap: 16 }}>
              <Body muted center>
                {t('events.empty')}
              </Body>
              <Button
                testID="empty-plan-own"
                title={t('events.plan_own_title')}
                onPress={() => router.push('/events/new')}
              />
            </View>
          ) : (
            <ActivityIndicator style={{ paddingTop: 40 }} />
          )
        }
        renderItem={renderItem}
      />
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 40 }}>
        <Button
          testID="new-event"
          title={`+ ${t('events.new_event')}`}
          onPress={() => router.push('/events/new')}
        />
      </View>
    </>
  );
}
