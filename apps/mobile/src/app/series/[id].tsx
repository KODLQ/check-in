import { formatEventTime, formatRepeatRule, hasEventEnded, headCount, type MyInvite } from '@check-in/shared';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Body, Card, Spinner, useColors } from '@/components/ui';
import { locale } from '@/lib/i18n';
import { supabase, type EventRow } from '@/lib/supabase';

type ManagedDate = EventRow & {
  rsvps: { status: string; plus_ones: number }[];
  event_series: { frequency: 'weekly' | 'biweekly' | 'monthly'; anchor_local_date: string } | null;
  groups: { name: string } | null;
};

interface Row {
  id: string;
  starts_at: string;
  time_zone: string;
  cancelled: boolean;
  detail: string;
  onPress: () => void;
}

const upcoming = (e: { starts_at: string | null; ends_at: string | null }) =>
  !!e.starts_at && !hasEventEnded(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, new Date());

/**
 * Every upcoming date of one series (spec: private-events "Series in the host list", my-invites "Series
 * invites grouped in the list"). Managers see counts and open the host view; guests see their answer.
 */
export default function SeriesDates() {
  const { t } = useTranslation();
  const c = useColors();
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const [title, setTitle] = useState('');
  const [rule, setRule] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    if (kind === 'invite') {
      const { data } = await supabase.rpc('list_my_invites');
      const dates = ((data as unknown as MyInvite[] | null) ?? []).filter((e) => e.series?.id === id && upcoming(e));
      const first = dates[0];
      setTitle(first?.title ?? '');
      setRule(first?.series ? formatRepeatRule(first.series.frequency, first.series.anchor_local_date, locale) : null);
      setRows(
        dates.map((e) => ({
          id: e.id,
          starts_at: e.starts_at,
          time_zone: e.time_zone,
          cancelled: e.state === 'cancelled',
          detail: e.my_rsvp ? t(`rsvp.${e.my_rsvp.status}`) : t('series.not_answered'),
          onPress: () => router.push(`/invites/${e.id}`),
        })),
      );
      return;
    }
    const { data } = await supabase
      .from('events')
      .select('*, rsvps(status, plus_ones), event_series(frequency, anchor_local_date), groups(name)')
      .eq('series_id', id)
      .order('starts_at');
    const dates = ((data as ManagedDate[] | null) ?? []).filter(upcoming);
    const first = dates[0];
    setTitle(first?.title ?? '');
    setRule(
      first?.event_series
        ? [first.groups?.name, formatRepeatRule(first.event_series.frequency, first.event_series.anchor_local_date, locale)]
            .filter(Boolean)
            .join(' · ')
        : null,
    );
    setRows(
      dates.map((e) => ({
        id: e.id,
        starts_at: e.starts_at!,
        time_zone: e.time_zone,
        cancelled: !!e.cancelled_at,
        detail: `${t('events.going_count', { count: headCount(e.rsvps) })} · ${t('events.maybe_count', {
          count: e.rsvps.filter((r) => r.status === 'maybe').length,
        })}`,
        onPress: () => router.push(`/events/${e.id}`),
      })),
    );
  }, [id, kind, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!rows) return <Spinner style={{ flex: 1, backgroundColor: c.bg }} />;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 60 }}
      >
        {rule ? (
          <Text testID="series-rule" style={{ color: c.muted, fontSize: 16, fontWeight: '600' }}>
            {rule}
          </Text>
        ) : null}
        {rows.map((r) => (
          <Pressable key={r.id} testID={`series-date-${r.id}`} accessibilityRole="button" onPress={r.onPress}>
            <Card style={{ opacity: r.cancelled ? 0.6 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', flex: 1 }}>
                  {formatEventTime(new Date(r.starts_at), locale, r.time_zone)}
                </Text>
                <Text style={{ color: c.muted, fontSize: 18 }}>›</Text>
              </View>
              <Body muted>{r.cancelled ? t('events.cancelled') : r.detail}</Body>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}
