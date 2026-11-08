import { formatEventTime, hasEventEnded } from '@check-in/shared';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { Body, Button, useColors } from '@/components/ui';
import { locale } from '@/lib/i18n';
import { supabase, type EventRow } from '@/lib/supabase';

type ListEvent = EventRow & { rsvps: { status: string }[] };

export default function MyEvents() {
  const { t } = useTranslation();
  const c = useColors();
  const [events, setEvents] = useState<ListEvent[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('*, rsvps(status)')
      .order('starts_at', { ascending: true });
    setEvents((data as ListEvent[]) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const now = new Date();
  const ended = (e: EventRow) => hasEventEnded(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, now);
  const upcoming = (events ?? []).filter((e) => !ended(e));
  const past = (events ?? []).filter(ended).reverse();
  const sections = [
    { title: t('events.upcoming'), data: upcoming },
    { title: t('events.past'), data: past },
  ].filter((s) => s.data.length > 0);

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
        keyExtractor={(e) => e.id}
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
        renderSectionHeader={({ section }) => (
          <Text style={{ color: c.muted, fontWeight: '700', textTransform: 'uppercase', marginTop: 8 }}>
            {section.title}
          </Text>
        )}
        ListEmptyComponent={
          events ? (
            <View testID="events-empty" style={{ paddingTop: 40 }}>
              <Body muted center>
                {t('events.empty')}
              </Body>
            </View>
          ) : (
            <ActivityIndicator style={{ paddingTop: 40 }} />
          )
        }
        renderItem={({ item }) => {
          const going = item.rsvps.filter((r) => r.status === 'going').length;
          const maybe = item.rsvps.filter((r) => r.status === 'maybe').length;
          return (
            <Pressable testID={`event-${item.id}`} onPress={() => router.push(`/events/${item.id}`)}>
              <Cover coverPath={item.cover_path} theme={item.theme} height={150} style={{ opacity: ended(item) ? 0.6 : 1 }}>
                <View style={{ padding: 14, backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ color: '#fff' }}>
                    {item.cancelled_at ? `${t('events.cancelled')} · ` : ''}
                    {formatEventTime(new Date(item.starts_at), locale, item.time_zone)} ·{' '}
                    {t('events.going_count', { count: going })} · {t('events.maybe_count', { count: maybe })}
                  </Text>
                </View>
              </Cover>
            </Pressable>
          );
        }}
      />
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 40 }}>
        <Button testID="new-event" title={`+ ${t('events.new_event')}`} onPress={() => router.push('/events/new')} />
      </View>
    </>
  );
}
