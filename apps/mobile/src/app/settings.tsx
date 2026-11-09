import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { KeyboardScroll } from '@/components/keyboard-scroll';
import { Toast } from '@/components/toast';
import { Body, Button, Field, Label, Title, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { displayNameErrorKey } from '@/lib/profile';
import { forgetLocalPushToken, signOut } from '@/lib/push';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { t } = useTranslation();
  const { profile, session, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  // Event wall default for new events (add-event-wall). The events insert trigger copies it.
  const [wallDefault, setWallDefault] = useState(profile?.wall_default_enabled ?? true);
  // Display name editing (same rules as onboarding).
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);

  async function toggleWallDefault(on: boolean) {
    setWallDefault(on);
    const { error } = await supabase.from('profiles').update({ wall_default_enabled: on }).eq('id', session?.user.id ?? '');
    if (error) setWallDefault(!on);
    else await refreshProfile();
  }

  async function saveName() {
    const key = displayNameErrorKey(name);
    if (key) {
      setNameError(t(key));
      return;
    }
    setSavingName(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name.trim() })
      .eq('id', session?.user.id ?? '');
    setSavingName(false);
    if (error) {
      setNameError(t('common.error'));
      return;
    }
    await refreshProfile();
    setEditingName(false);
    setToast(t('profile.name_saved'));
  }

  function confirmSignOut() {
    Alert.alert(t('auth.sign_out_confirm_title'), t('auth.sign_out_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.sign_out'), style: 'destructive', onPress: () => void signOut() },
    ]);
  }

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
    <>
      <KeyboardScroll contentContainerStyle={{ padding: 20, gap: 16 }}>
        {editingName ? (
          <View style={{ gap: 10 }}>
            <Field
              testID="settings-name"
              label={t('profile.name_label')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setNameError(null);
              }}
              placeholder={t('profile.name_placeholder')}
              autoFocus
              maxLength={50}
              textContentType="givenName"
              returnKeyType="done"
              onSubmitEditing={() => void saveName()}
              error={nameError}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="secondary"
                  title={t('common.cancel')}
                  onPress={() => {
                    setEditingName(false);
                    setName(profile?.display_name ?? '');
                    setNameError(null);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button testID="settings-save-name" title={t('common.save')} loading={savingName} onPress={() => void saveName()} />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <Title>{profile?.display_name}</Title>
            <Body muted>{session?.user.email}</Body>
          </View>
        )}
        {editingName ? null : (
          <Button
            testID="settings-edit-name"
            variant="secondary"
            title={t('profile.edit_name')}
            onPress={() => {
              setName(profile?.display_name ?? '');
              setEditingName(true);
            }}
          />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Label>{t('wall.default_toggle')}</Label>
          </View>
          <Toggle testID="wall-default-toggle" value={wallDefault} onValueChange={(on) => void toggleWallDefault(on)} />
        </View>
        <Button testID="sign-out" variant="secondary" title={t('auth.sign_out')} onPress={confirmSignOut} />
        <Button variant="danger" title={t('profile.delete_account')} loading={busy} onPress={confirmDelete} />
      </KeyboardScroll>
      <Toast message={toast} onHide={hideToast} topOffset={64} />
    </>
  );
}
