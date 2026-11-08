import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { notificationRoute } from './notification-routing';

/** Opens the related event when a notification is tapped, including the tap that launched the app. */
export function useNotificationRouting(enabled: boolean) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let active = true;
    const open = (response: Notifications.NotificationResponse | null | undefined) => {
      const route = notificationRoute(response?.notification.request.content.data);
      if (!route) return;
      router.push(route);
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (active) open(r);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      active = false;
      sub.remove();
    };
  }, [enabled]);
}
