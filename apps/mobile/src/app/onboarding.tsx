import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { KeyboardScroll } from '@/components/keyboard-scroll';
import { Body, Button, Field, Title, useColors } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { displayNameErrorKey } from '@/lib/profile';
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
    const key = displayNameErrorKey(name);
    if (key) {
      setError(t(key));
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
    <KeyboardScroll contentContainerStyle={{ padding: 20, paddingTop: 100, gap: 16 }}>
      <Title>{t('profile.title')}</Title>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Pressable onPress={pickAvatar} accessibilityRole="button" accessibilityLabel={t('profile.add_photo')}>
          <View
            testID="avatar"
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: c.surface,
              borderWidth: avatarUrl ? 0 : 1,
              borderColor: c.border,
              borderStyle: 'dashed',
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarUrl ? (
              <Image source={avatarUrl} style={{ width: 96, height: 96 }} contentFit="cover" />
            ) : (
              <Text testID="avatar-placeholder" style={{ fontSize: 30 }}>📷</Text>
            )}
          </View>
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: c.accent,
              borderWidth: 2,
              borderColor: c.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: c.accentText, fontSize: 18, fontWeight: '800', lineHeight: 20 }}>{avatarUrl ? '✎' : '+'}</Text>
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
    </KeyboardScroll>
  );
}
