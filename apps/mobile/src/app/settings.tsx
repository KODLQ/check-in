import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { Body, Button, Screen, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { t } = useTranslation();
  const { profile, session } = useAuth();
  const [busy, setBusy] = useState(false);

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
          else await supabase.auth.signOut({ scope: 'local' });
        },
      },
    ]);
  }

  return (
    <Screen>
      <Title>{profile?.display_name}</Title>
      <Body muted>{session?.user.email}</Body>
      <Button variant="secondary" title={t('auth.sign_out')} onPress={() => supabase.auth.signOut()} />
      <Button variant="danger" title={t('profile.delete_account')} loading={busy} onPress={confirmDelete} />
    </Screen>
  );
}
