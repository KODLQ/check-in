import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

import { Screen } from '@/components/ui';
import { accessArea } from '@/lib/access';
import { useAuth } from '@/lib/auth';
import { savePendingClaim } from '@/lib/pending-claim';

/**
 * checkin://claim?t=<ticket> from the web hand-off page. Stores the ticket, then continues to sign-in,
 * onboarding or the home list; the ticket is redeemed once the user reaches the app (usePendingClaim).
 */
export default function Claim() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const { session, profile, loading } = useAuth();
  const area = loading ? null : accessArea(!!session, profile);

  useEffect(() => {
    if (!area) return;
    let active = true;
    void (async () => {
      if (typeof t === 'string') await savePendingClaim(t);
      if (!active) return;
      // Warm start while signed in: go back to where the user was instead of stacking a second home.
      if (area === 'app' && router.canGoBack()) router.back();
      else
        router.replace(
          area === 'signed-out' ? '/sign-in' : area === 'onboarding' ? '/onboarding' : '/',
        );
    })();
    return () => {
      active = false;
    };
  }, [area, t]);

  return (
    <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator />
    </Screen>
  );
}
