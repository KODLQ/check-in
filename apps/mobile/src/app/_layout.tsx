import '@/lib/i18n';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { accessArea } from '@/lib/access';
import { AuthProvider, useAuth } from '@/lib/auth';
import { configureNotificationHandler, registerForPush } from '@/lib/push';
import { useNotificationRouting } from '@/lib/use-notification-routing';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

function RootStack() {
  const { session, profile, loading } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  // Refresh this device's push registration on start/sign-in, only if already allowed (never prompts).
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void registerForPush();
  }, [userId]);

  useNotificationRouting(!loading);

  if (loading) return null;

  const area = accessArea(!!session, profile);

  return (
    <Stack screenOptions={{ headerBackTitle: t('common.back') }}>
      {/* Invite links work whether or not you're signed in. */}
      <Stack.Screen name="i/[token]" options={{ title: '' }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />

      <Stack.Protected guard={area === 'signed-out'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={area === 'onboarding'}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={area === 'app'}>
        <Stack.Screen name="index" options={{ title: t('events.my_events') }} />
        <Stack.Screen name="events/new" options={{ title: t('events.new_event'), presentation: 'modal' }} />
        <Stack.Screen name="events/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="events/[id]/edit" options={{ title: t('events.edit_event'), presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ title: '' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootStack />
    </AuthProvider>
  );
}
