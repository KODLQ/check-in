import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Body, Button, ErrorText, Screen, Title } from '@/components/ui';
import { accessArea } from '@/lib/access';
import { useAuth } from '@/lib/auth';
import { errorKey } from '@/lib/events';
import { savePendingGroupLink, type GroupLinkPreview } from '@/lib/groups';
import { supabase } from '@/lib/supabase';

/**
 * Group link (checkin://g/<token> or https://…/g/<token>), spec: groups "Join with the group link".
 * Signed-out or not-yet-onboarded users go through sign-in / onboarding and resume from the home screen.
 */
export default function JoinGroup() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, profile, loading } = useAuth();
  const area = loading ? null : accessArea(!!session, profile);
  const [preview, setPreview] = useState<GroupLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (area === 'signed-out' || area === 'onboarding') {
      void savePendingGroupLink(token).then(() => router.replace(area === 'signed-out' ? '/sign-in' : '/onboarding'));
    }
  }, [area, token]);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_group_link_preview', { p_token: token });
    const result = (data as unknown as GroupLinkPreview | null) ?? { state: 'invalid' };
    // Members just get the group; nothing to join.
    if (result.state === 'valid' && result.is_member && result.group_id) router.replace(`/groups/${result.group_id}`);
    setPreview(result);
  }, [token]);

  useEffect(() => {
    if (area === 'app') void load();
  }, [area, load]);

  async function join() {
    setError(null);
    setBusy(true);
    const { data: groupId, error: rpcError } = await supabase.rpc('join_group_by_link', { p_token: token });
    setBusy(false);
    if (rpcError || !groupId) {
      if (rpcError?.message === 'invalid') setPreview({ state: 'invalid' });
      else setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
      return;
    }
    router.replace(`/groups/${groupId as string}`);
  }

  if (area !== 'app' || !preview) {
    return (
      <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator testID="group-link-loading" />
      </Screen>
    );
  }

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (preview.state === 'invalid') {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Title>{t('groups.invalid_title')}</Title>
        <Body muted>{t('groups.invalid_body')}</Body>
        <Button variant="secondary" title={t('common.back')} onPress={leave} />
      </Screen>
    );
  }

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Title>{t('groups.join_title', { group: preview.name })}</Title>
      <Body muted>{t('groups.join_body', { owner: preview.owner_name ?? '', count: preview.member_count })}</Body>
      <Body>{t('groups.join_disclosure', { name: profile?.display_name ?? '' })}</Body>
      <View style={{ gap: 10 }}>
        <Button testID="join-group" title={t('groups.join')} loading={busy} onPress={() => void join()} />
        <Button variant="ghost" title={t('groups.not_now')} onPress={leave} />
      </View>
      <ErrorText testID="join-error">{error}</ErrorText>
    </Screen>
  );
}
