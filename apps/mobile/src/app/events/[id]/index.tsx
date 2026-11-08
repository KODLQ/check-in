import { formatTimeRange, hasEventEnded, inviteUrl, mapsUrl, type RsvpStatus } from '@check-in/shared';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { Body, Button, Card, Label, Screen, useColors } from '@/components/ui';
import { INVITE_BASE_URL } from '@/lib/config';
import { fetchActiveInvite } from '@/lib/events';
import { locale } from '@/lib/i18n';
import { supabase, type EventRow, type RsvpRow } from '@/lib/supabase';

const GROUPS: RsvpStatus[] = ['going', 'maybe', 'declined'];

export default function EventDetail() {
  const { t } = useTranslation();
  const c = useColors();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [rsvps, setRsvps] = useState<RsvpRow[]>([]);
  const [copied, setCopied] = useState(false);

  const loadRsvps = useCallback(async () => {
    const { data } = await supabase.from('rsvps').select('*').eq('event_id', id).order('created_at');
    setRsvps(data ?? []);
  }, [id]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').eq('id', id).single();
    setEvent(data);
    setToken(await fetchActiveInvite(id));
    await loadRsvps();
  }, [id, loadRsvps]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Live guest list (Realtime respects RLS, so only the host receives these rows).
  useEffect(() => {
    const channel = supabase
      .channel(`rsvps:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps', filter: `event_id=eq.${id}` }, () => {
        void loadRsvps();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, loadRsvps]);

  if (!event) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <ActivityIndicator />
      </Screen>
    );
  }

  const link = token ? inviteUrl(INVITE_BASE_URL, token) : null;
  const when = formatTimeRange(new Date(event.starts_at), event.ends_at ? new Date(event.ends_at) : null, locale, event.time_zone);
  const ended = hasEventEnded(new Date(event.starts_at), event.ends_at ? new Date(event.ends_at) : null);
  const editable = !ended && !event.cancelled_at;

  async function share() {
    if (!link || !event) return;
    await Share.share({ message: `${t('events.share_message', { title: event.title, when })}\n${link}`, url: link });
  }

  async function copy() {
    if (!link) return;
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
        },
      },
    ]);
  }

  async function toggleGuestList(visible: boolean) {
    setEvent({ ...event!, guest_list_visible: visible });
    await supabase.from('events').update({ guest_list_visible: visible }).eq('id', id);
  }

  function removeGuest(r: RsvpRow) {
    Alert.alert(r.display_name, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('rsvp.remove_guest'),
        style: 'destructive',
        onPress: async () => {
          await supabase.from('rsvps').delete().eq('id', r.id);
          await loadRsvps();
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: editable
            ? () => (
                <Pressable hitSlop={12} onPress={() => router.push(`/events/${id}/edit`)}>
                  <Text style={{ color: c.accent, fontSize: 17, fontWeight: '600' }}>{t('events.edit_event')}</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>
        {created && editable ? (
          <Card style={{ backgroundColor: c.accent }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{t('events.created')}</Text>
          </Card>
        ) : null}

        <Cover coverPath={event.cover_path} theme={event.theme} height={200} />
        <Text style={{ fontSize: 28, fontWeight: '800', color: c.text }}>{event.title}</Text>
        {event.cancelled_at ? <Text style={{ color: c.danger, fontWeight: '700' }}>{t('events.cancelled')}</Text> : null}
        <Body>{when}</Body>
        <Pressable
          onPress={() =>
            Linking.openURL(mapsUrl({ latitude: event.latitude, longitude: event.longitude, query: event.location_text }))
          }
        >
          <Text style={{ color: c.accent, fontSize: 16 }}>📍 {event.location_text}</Text>
        </Pressable>
        {event.description ? <Body muted>{event.description}</Body> : null}

        {editable && link ? (
          <View style={{ gap: 10 }}>
            <Button testID="share" title={t('events.share')} onPress={share} />
            <Button variant="secondary" title={copied ? t('events.copied') : t('events.copy_link')} onPress={copy} />
            <Text selectable style={{ color: c.muted, textAlign: 'center' }} testID="invite-link">
              {link}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>{t('events.show_guest_list')}</Label>
          <Switch value={event.guest_list_visible} onValueChange={toggleGuestList} disabled={!editable} />
        </View>

        {GROUPS.map((status) => {
          const group = rsvps.filter((r) => r.status === status);
          return (
            <Card key={status}>
              <Label>
                {t(`rsvp.${status}`)} · {group.length}
              </Label>
              {group.map((r) => (
                <Pressable key={r.id} onLongPress={() => removeGuest(r)} testID={`guest-${r.display_name}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Body>{r.display_name}</Body>
                    <Pressable hitSlop={8} onPress={() => removeGuest(r)}>
                      <Text style={{ color: c.muted }}>✕</Text>
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </Card>
          );
        })}

        {editable ? (
          <View style={{ gap: 10, marginTop: 12 }}>
            <Button variant="secondary" title={t('events.regenerate_link')} onPress={confirmRegenerate} />
            <Button variant="danger" title={t('events.cancel_event')} onPress={confirmCancel} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
