import '@/lib/i18n';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/components/ui';
import { accessArea } from '@/lib/access';
import { AuthProvider, useAuth } from '@/lib/auth';
import { configureNotificationHandler, registerForPush } from '@/lib/push';
import { useNotificationRouting } from '@/lib/use-notification-routing';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

/** Navigation theme from the app palette, so native headers follow light/dark mode on iOS and Android. */
function useNavTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  const c = useColors();
  return useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.accent,
        background: c.bg,
        card: c.bg,
        text: c.text,
        border: c.border,
        notification: c.accent,
      },
    };
  }, [dark, c]);
}

function RootStack() {
  const { session, profile, loading } = useAuth();
  const { t } = useTranslation();
  const c = useColors();

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
    <Stack
      screenOptions={{
        headerBackTitle: t('common.back'),
        // An explicit background keeps the header opaque (iOS 26 makes it transparent otherwise), so
        // scrolled content never shows through between the header buttons.
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      {/* Invite links work whether or not you're signed in. */}
      <Stack.Screen name="i/[token]" options={{ title: '' }} />
      {/* Co-host links handle signed-out / onboarding users themselves (pending-co-host). */}
      <Stack.Screen name="c/[token]" options={{ title: '' }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      <Stack.Screen name="claim" options={{ headerShown: false }} />

      <Stack.Protected guard={area === 'signed-out'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={area === 'onboarding'}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={area === 'app'}>
        <Stack.Screen name="index" options={{ title: t('events.title') }} />
        <Stack.Screen name="invites/[eventId]" options={{ title: '' }} />
        <Stack.Screen
          name="events/new"
          options={{ title: t('events.new_event'), presentation: 'modal' }}
        />
        <Stack.Screen name="events/[id]/index" options={{ title: '' }} />
        <Stack.Screen
          name="events/[id]/edit"
          options={{ title: t('events.edit_event'), presentation: 'modal' }}
        />
        {/* Edit times of a date poll (add-date-polls). */}
        <Stack.Screen
          name="events/[id]/poll"
          options={{ title: t('polls.edit_options'), presentation: 'modal' }}
        />
        <Stack.Screen name="settings" options={{ title: t('profile.settings') }} />
        {/* Event wall (add-event-wall): /wall?eventId=… or /wall?token=… */}
        <Stack.Screen name="wall" options={{ title: '' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const theme = useNavTheme();
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      <KeyboardProvider>
        <AuthProvider>
          <RootStack />
        </AuthProvider>
      </KeyboardProvider>
    </ThemeProvider>
  );
}
