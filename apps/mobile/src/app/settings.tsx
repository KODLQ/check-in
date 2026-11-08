import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';

import { Body, Button, Title, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { forgetLocalPushToken, signOut } from '@/lib/push';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { t } = useTranslation();
  const { profile, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const c = useColors();

  function confirmDelete() {
    Alert.alert(t('profile.delete_confirm_title'), t('profile.delete_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
          setBusy(false);
          if (error) Alert.alert(t('common.error'));
          else {
            await forgetLocalPushToken();
            await supabase.auth.signOut({ scope: 'local' });
          }
        },
      },
    ]);
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      <Title>{profile?.display_name}</Title>
      <Body muted>{session?.user.email}</Body>
      <Button variant="secondary" title={t('auth.sign_out')} onPress={() => void signOut()} />
      <Button variant="danger" title={t('profile.delete_account')} loading={busy} onPress={confirmDelete} />
    </ScrollView>
  );
}
