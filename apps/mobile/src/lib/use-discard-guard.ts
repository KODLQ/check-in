import { usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

/**
 * Asks "Discard changes?" before a screen with unsaved changes is left (back gesture, swipe-down of a
 * modal, Android back, Cancel). Returns `allowLeave`: call it right before navigating away after a save.
 */
export function useDiscardGuard(dirty: boolean): () => void {
  const { t } = useTranslation();
  const [leaving, setLeaving] = useState(false);
  const disablePrevention = usePreventRemove(dirty && !leaving, ({ repeat }) => {
    Alert.alert(t('events.discard_title'), t('events.discard_body'), [
      { text: t('events.keep_editing'), style: 'cancel' },
      {
        text: t('events.discard'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          repeat();
        },
      },
    ]);
  });
  return () => {
    setLeaving(true);
    disablePrevention();
  };
}
