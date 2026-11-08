import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Body, Button, ErrorText, Screen, Title } from '@/components/ui';
import { accessArea } from '@/lib/access';
import { useAuth } from '@/lib/auth';
import { errorKey } from '@/lib/events';
import { savePendingCoHostInvite } from '@/lib/pending-co-host';
import { supabase } from '@/lib/supabase';

type CoHostInvite =
  | { state: 'invalid' }
  | { state: 'valid'; event: { title: string }; owner: { display_name: string | null } }
  | { state: 'owner' | 'already_co_host'; event: { id: string; title: string }; owner: { display_name: string | null } };

/**
 * Co-host invite link (checkin://c/<token> or https://…/c/<token>), spec: co-hosts / Accept co-host invite.
 * Signed-out or not-yet-onboarded users are sent through sign-in / onboarding and resumed from the home
 * screen (pending-co-host). Accepting needs a signed-in user with a display name.
 */
export default function AcceptCoHost() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, profile, loading } = useAuth();
  const area = loading ? null : accessArea(!!session, profile);
  const [invite, setInvite] = useState<CoHostInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (area === 'signed-out' || area === 'onboarding') {
      void savePendingCoHostInvite(token).then(() =>
        router.replace(area === 'signed-out' ? '/sign-in' : '/onboarding'),
      );
    }
  }, [area, token]);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_co_host_invite', { p_token: token });
    const result = (data as unknown as CoHostInvite | null) ?? { state: 'invalid' };
    // An existing co-host just gets the event; the link stays unused.
    if (result.state === 'already_co_host') router.replace(`/events/${result.event.id}`);
    setInvite(result);
  }, [token]);

  useEffect(() => {
    if (area === 'app') void load();
  }, [area, load]);

  async function accept() {
    setError(null);
    setBusy(true);
    const { data: eventId, error: rpcError } = await supabase.rpc('accept_co_host_invite', { p_token: token });
    setBusy(false);
    if (rpcError || !eventId) {
      const key = errorKey(rpcError);
      if (key === 'invalid_invite') setInvite({ state: 'invalid' });
      else setError(t(`errors.${key}`, t('common.error')));
      return;
    }
    router.replace(`/events/${eventId}`);
  }

  if (area !== 'app' || !invite) {
    return (
      <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator testID="co-host-loading" />
      </Screen>
    );
  }

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (invite.state === 'invalid') {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Title>{t('co_hosts.invalid_title')}</Title>
        <Body muted>{t('co_hosts.invalid_body')}</Body>
        <Button variant="secondary" title={t('common.back')} onPress={leave} />
      </Screen>
    );
  }

  if (invite.state === 'owner' || invite.state === 'already_co_host') {
    const id = invite.event.id;
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Title>{invite.event.title}</Title>
        <Body muted>{invite.state === 'owner' ? t('co_hosts.owner_body') : t('co_hosts.already_body')}</Body>
        <Button testID="open-event" title={t('co_hosts.open_event')} onPress={() => router.replace(`/events/${id}`)} />
      </Screen>
    );
  }

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Body muted>{t('co_hosts.accept_title', { owner: invite.owner.display_name ?? '' })}</Body>
      <Title>{invite.event.title}</Title>
      <Body>{t('co_hosts.accept_disclosure', { name: profile?.display_name ?? '' })}</Body>
      <View style={{ gap: 10 }}>
        <Button testID="accept-co-host" title={t('co_hosts.accept')} loading={busy} onPress={accept} />
        <Button variant="ghost" title={t('co_hosts.not_now')} onPress={leave} />
      </View>
      <ErrorText testID="accept-error">{error}</ErrorText>
    </Screen>
  );
}
