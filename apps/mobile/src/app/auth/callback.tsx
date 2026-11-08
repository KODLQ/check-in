import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native';

import { Body, Button, Screen, Title } from '@/components/ui';
import { completeAuthRedirect } from '@/lib/auth-actions';

/** Landing route for magic links and OAuth redirects (checkin://auth/callback). */
export default function AuthCallback() {
  const { t } = useTranslation();
  const url = Linking.useLinkingURL();
  const [state, setState] = useState<'working' | 'invalid'>('working');

  useEffect(() => {
    if (!url) return;
    completeAuthRedirect(url).then((result) => {
      if (result === 'ok') router.replace('/');
      else setState('invalid');
    });
  }, [url]);

  if (state === 'working') {
    return (
      <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen style={{ justifyContent: 'center' }}>
      <Title>{t('auth.link_invalid')}</Title>
      <Body muted> </Body>
      <Button title={t('auth.send_new_link')} onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
