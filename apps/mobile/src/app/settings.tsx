import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Switch, View } from 'react-native';

import { Body, Button, Label, Title, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { forgetLocalPushToken, signOut } from '@/lib/push';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { t } = useTranslation();
  const { profile, session, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  // Event wall default for new events (add-event-wall). The events insert trigger copies it.
  const [wallDefault, setWallDefault] = useState(profile?.wall_default_enabled ?? true);

  async function toggleWallDefault(on: boolean) {
    setWallDefault(on);
    const { error } = await supabase.from('profiles').update({ wall_default_enabled: on }).eq('id', session?.user.id ?? '');
    if (error) setWallDefault(!on);
    else await refreshProfile();
  }
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Label>{t('wall.default_toggle')}</Label>
        </View>
        <Switch testID="wall-default-toggle" value={wallDefault} onValueChange={(on) => void toggleWallDefault(on)} />
      </View>
      <Button variant="secondary" title={t('auth.sign_out')} onPress={() => void signOut()} />
      <Button variant="danger" title={t('profile.delete_account')} loading={busy} onPress={confirmDelete} />
    </ScrollView>
  );
}
