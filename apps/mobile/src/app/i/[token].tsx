import { formatTimeRange, inviteUrl, type RsvpStatus } from '@check-in/shared';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { Body, Button, ErrorText, Screen, Title, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { INVITE_BASE_URL } from '@/lib/config';
import { errorKey } from '@/lib/events';
import { locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

interface Invite {
  state: 'not_found' | 'cancelled' | 'past' | 'active';
  event?: {
    title: string;
    description?: string | null;
    starts_at: string;
    ends_at?: string | null;
    time_zone: string;
    location_text: string;
    cover_path?: string | null;
    theme?: string;
  };
  host?: { display_name: string | null };
  counts?: { going: number; maybe: number };
  my_rsvp?: { status: RsvpStatus } | null;
}

/** In-app view of an invite link (opened via universal link or checkin://i/<token>). */
export default function InviteInApp() {
  const { t } = useTranslation();
  const c = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, profile } = useAuth();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_invite', { p_token: token });
    setInvite((data as unknown as Invite) ?? { state: 'not_found' });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <Title>{invite.state === 'cancelled' ? invite.event?.title : t('invite.not_found_title')}</Title>
        <Body muted>{invite.state === 'cancelled' ? t('invite.cancelled_body') : t('invite.not_found_body')}</Body>
      </Screen>
    );
  }

  const e = invite.event;
  const canRsvp = invite.state === 'active' && !!session && !!profile?.display_name;

  async function respond(status: RsvpStatus) {
    setError(null);
    const { error: rpcError } = await supabase.rpc('rsvp_as_user', { p_token: token, p_status: status });
    if (rpcError) setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
    else await load();
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Cover coverPath={e.cover_path} theme={e.theme} height={200} />
      <Title>{e.title}</Title>
      <Body muted>{t('invite.hosted_by', { name: invite.host?.display_name ?? '' })}</Body>
      <Body>{formatTimeRange(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, locale, e.time_zone)}</Body>
      <Body>📍 {e.location_text}</Body>
      {e.description ? <Body muted>{e.description}</Body> : null}
      {invite.state === 'past' ? <Body muted>{t('invite.past_body')}</Body> : null}

      {canRsvp ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['going', 'maybe', 'declined'] as const).map((s) => (
            <View key={s} style={{ flex: 1 }}>
              <Button
                variant={invite.my_rsvp?.status === s ? 'primary' : 'secondary'}
                title={t(`rsvp.${s}`)}
                onPress={() => respond(s)}
              />
            </View>
          ))}
        </View>
      ) : invite.state === 'active' ? (
        <Button
          title={t('rsvp.going')}
          onPress={() => WebBrowser.openBrowserAsync(inviteUrl(INVITE_BASE_URL, token))}
        />
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Text style={{ color: c.muted }}>{t('rsvp.people_going', { count: invite.counts?.going ?? 0 })}</Text>
      {!session ? <Button variant="ghost" title={t('invite.get_app')} onPress={() => router.replace('/sign-in')} /> : null}
    </ScrollView>
  );
}
