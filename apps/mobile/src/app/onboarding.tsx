import { displayNameSchema, fieldErrors } from '@check-in/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Body, Button, Field, Screen, Title, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { publicUrl, supabase } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';

export default function Onboarding() {
  const { t } = useTranslation();
  const c = useColors();
  const { session, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [avatarPath, setAvatarPath] = useState<string | null>(profile?.avatar_path ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userId = session?.user.id;

  async function save() {
    const errs = fieldErrors(displayNameSchema.safeParse(name));
    if (errs) {
      setError(t(`errors.${errs._}`));
      return;
    }
    if (!userId) return;
    setBusy(true);
    const { error: dbError } = await supabase
      .from('profiles')
      .update({ display_name: name.trim(), avatar_path: avatarPath })
      .eq('id', userId);
    setBusy(false);
    if (dbError) setError(t('common.error'));
    else await refreshProfile();
  }

  async function pickAvatar() {
    if (!userId) return;
    try {
      const path = await pickAndUpload('avatars', userId, [1, 1]);
      if (path) setAvatarPath(path);
    } catch {
      setError(t('common.error'));
    }
  }

  const avatarUrl = publicUrl('avatars', avatarPath);

  return (
    <Screen style={{ paddingTop: 100 }}>
      <Title>{t('profile.title')}</Title>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Pressable onPress={pickAvatar} accessibilityRole="button" accessibilityLabel={t('profile.add_photo')}>
          <View
            style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.surface, overflow: 'hidden' }}
          >
            {avatarUrl ? <Image source={avatarUrl} style={{ flex: 1 }} contentFit="cover" /> : null}
          </View>
        </Pressable>
        <Body muted>
          {avatarUrl ? t('profile.change_photo') : `${t('profile.add_photo')} (${t('common.optional')})`}
        </Body>
      </View>
      <Field
        testID="display-name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        placeholder={t('profile.name_placeholder')}
        autoFocus
        maxLength={50}
        textContentType="givenName"
        error={error}
      />
      <Button testID="save-name" title={t('common.continue')} loading={busy} onPress={save} />
    </Screen>
  );
}
