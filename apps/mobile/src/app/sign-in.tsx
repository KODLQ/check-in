import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Body, Button, ErrorText, Field, Screen, Title, useColors } from '@/components/ui';
import { sendMagicLink, signInWithApple, signInWithGoogle } from '@/lib/auth-actions';

export default function SignIn() {
  const { t } = useTranslation();
  const c = useColors();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (__DEV__) console.warn('sign-in failed', e);
      if (code !== 'ERR_REQUEST_CANCELED') setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen style={{ justifyContent: 'center', paddingTop: 80 }}>
        <Title>{t('auth.welcome')}</Title>
        <Body muted>{t('auth.tagline')}</Body>

        {sentTo ? (
          <View style={{ gap: 12 }}>
            <Body>{t('auth.link_sent', { email: sentTo })}</Body>
            <Button variant="ghost" title={t('auth.send_new_link')} onPress={() => setSentTo(null)} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Field
              testID="email"
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.email_placeholder')}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Button
              testID="send-link"
              title={t('auth.send_link')}
              disabled={!valid}
              loading={busy}
              onPress={() =>
                run(async () => {
                  await sendMagicLink(email);
                  setSentTo(email.trim());
                })
              }
            />
          </View>
        )}

        <Body muted center>
          {t('auth.or')}
        </Body>

        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              c.bg === '#FFFFFF'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            }
            cornerRadius={14}
            style={{ height: 50 }}
            onPress={() => run(signInWithApple)}
          />
        ) : null}
        <Button variant="secondary" title={t('auth.continue_google')} onPress={() => run(signInWithGoogle)} />

        <ErrorText>{error}</ErrorText>
      </Screen>
    </KeyboardAvoidingView>
  );
}
