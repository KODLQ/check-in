import { coHostInviteUrl, formatEventTime } from '@check-in/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { Body, Button, Card, ErrorText, Label, useColors } from '@/components/ui';
import { INVITE_BASE_URL } from '@/lib/config';
import { errorKey } from '@/lib/events';
import { locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export interface EventHost {
  user_id: string;
  display_name: string | null;
  role: 'owner' | 'co_host';
  added_at: string;
}

interface PendingLink {
  token: string;
  expires_at: string;
}

/**
 * Owner and co-hosts of an event (spec: co-hosts / Co-host list). The owner also manages co-hosts here:
 * invite (single-use link → share sheet), revoke pending links, remove co-hosts. Every action is
 * enforced server-side; this only decides what to offer.
 */
export function HostsCard({
  eventId,
  eventTitle,
  timeZone,
  userId,
  isOwner,
  canInvite,
  onAccessLost,
}: {
  eventId: string;
  eventTitle: string;
  timeZone: string;
  userId: string | undefined;
  isOwner: boolean;
  /** Upcoming, non-cancelled events only. */
  canInvite: boolean;
  /** Called when a request fails in a way that may mean we lost access (e.g. removed as co-host). */
  onAccessLost?: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [hosts, setHosts] = useState<EventHost[]>([]);
  const [pending, setPending] = useState<PendingLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('list_event_hosts', { p_event_id: eventId });
    setHosts((data as EventHost[] | null) ?? []);
    if (isOwner) {
      const { data: links } = await supabase
        .from('co_host_invites')
        .select('token, expires_at')
        .eq('event_id', eventId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at');
      setPending(links ?? []);
    } else {
      setPending([]);
    }
  }, [eventId, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    setError(null);
    setBusy(true);
    const { data: token, error: rpcError } = await supabase.rpc('create_co_host_invite', {
      p_event_id: eventId,
    });
    setBusy(false);
    if (rpcError || !token) {
      setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
      if (errorKey(rpcError) === 'unknown') onAccessLost?.();
      return;
    }
    await load();
    const url = coHostInviteUrl(INVITE_BASE_URL, token);
    await Share.share({ message: t('co_hosts.share_message', { title: eventTitle, url }), url });
  }

  function revoke(link: PendingLink) {
    Alert.alert(t('co_hosts.revoke_confirm_title'), t('co_hosts.revoke_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('co_hosts.revoke'),
        style: 'destructive',
        onPress: async () => {
          await supabase.rpc('revoke_co_host_invite', { p_token: link.token });
          await load();
        },
      },
    ]);
  }

  function remove(host: EventHost) {
    const name = host.display_name ?? '';
    Alert.alert(t('co_hosts.remove_confirm_title', { name }), t('co_hosts.remove_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('co_hosts.remove'),
        style: 'destructive',
        onPress: async () => {
          await supabase.rpc('remove_co_host', { p_event_id: eventId, p_user_id: host.user_id });
          await load();
        },
      },
    ]);
  }

  return (
    <Card>
      <Label>{t('co_hosts.title')}</Label>
      {hosts.map((h) => (
        <View
          key={h.user_id}
          testID={`host-${h.role}-${h.display_name ?? ''}`}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}
        >
          <Body>
            {h.user_id === userId ? t('co_hosts.you', { name: h.display_name ?? '' }) : (h.display_name ?? '')}
          </Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: c.muted }}>{h.role === 'owner' ? t('co_hosts.owner') : t('co_hosts.co_host')}</Text>
            {isOwner && h.role === 'co_host' ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('co_hosts.remove')} ${h.display_name ?? ''}`}
                testID={`remove-co-host-${h.display_name ?? ''}`}
                onPress={() => remove(h)}
              >
                <Text style={{ color: c.muted }}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      {pending.map((l) => (
        <View
          key={l.token}
          testID="pending-co-host-link"
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}
        >
          <Body muted>
            {t('co_hosts.pending', { when: formatEventTime(new Date(l.expires_at), locale, timeZone) })}
          </Body>
          <Pressable hitSlop={8} accessibilityRole="button" onPress={() => revoke(l)} testID="revoke-co-host-link">
            <Text style={{ color: c.danger, fontWeight: '600' }}>{t('co_hosts.revoke')}</Text>
          </Pressable>
        </View>
      ))}
      {isOwner && canInvite ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Button
            testID="invite-co-host"
            variant="secondary"
            title={t('co_hosts.invite')}
            loading={busy}
            onPress={invite}
          />
          <Body muted>{t('co_hosts.invite_hint')}</Body>
        </View>
      ) : null}
      <ErrorText testID="co-host-error">{error}</ErrorText>
    </Card>
  );
}
