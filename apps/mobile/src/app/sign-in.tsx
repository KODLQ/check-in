import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Body, Button, ErrorText, Field, Screen, Title, useColors } from '@/components/ui';
import { sendMagicLink, signInWithApple, signInWithGoogle } from '@/lib/auth-actions';

/** Seconds before "Send a new link" can be used again (the auth server rate-limits magic links). */
export const RESEND_COOLDOWN_S = 30;

/**
 * Opens the mail app's inbox where the platform allows it: `message:` (Mail) on iOS. Android has no
 * URL for "inbox" without a native intent module, so it opens the default mail app via `mailto:`.
 */
export async function openMailApp() {
  const url = Platform.OS === 'ios' ? 'message://' : 'mailto:';
  try {
    await Linking.openURL(url);
  } catch {
    if (url !== 'mailto:') await Linking.openURL('mailto:').catch(() => {});
  }
}

export default function SignIn() {
  const { t } = useTranslation();
  const c = useColors();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const { code, status } = e as { code?: string; status?: number };
      if (__DEV__) console.warn('sign-in failed', e);
      if (status === 429 || code === 'over_email_send_rate_limit') setError(t('errors.rate_limited'));
      else if (code !== 'ERR_REQUEST_CANCELED') setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  const send = () =>
    run(async () => {
      await sendMagicLink(email);
      setResent(false);
      setSentTo(email.trim());
      setCooldown(RESEND_COOLDOWN_S);
    });

  const resend = () =>
    run(async () => {
      if (!sentTo) return;
      await sendMagicLink(sentTo);
      setResent(true);
      setCooldown(RESEND_COOLDOWN_S);
    });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen style={{ justifyContent: 'center', paddingTop: 80 }}>
        <Title>{t('auth.welcome')}</Title>
        <Body muted>{t('auth.tagline')}</Body>

        {sentTo ? (
          <View style={{ gap: 12 }}>
            <Body>{t(resent ? 'auth.link_resent' : 'auth.link_sent', { email: sentTo })}</Body>
            <Button testID="open-mail" title={t('auth.open_mail')} onPress={() => void openMailApp()} />
            <Button
              testID="resend-link"
              variant="secondary"
              title={cooldown > 0 ? t('auth.resend_in', { seconds: cooldown }) : t('auth.send_new_link')}
              disabled={cooldown > 0}
              loading={busy}
              onPress={() => void resend()}
            />
            <Button
              testID="other-email"
              variant="ghost"
              title={t('auth.use_other_email')}
              onPress={() => {
                setSentTo(null);
                setResent(false);
                setError(null);
              }}
            />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Field
              testID="email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                // A failed attempt's message would otherwise sit under the new address.
                setError(null);
              }}
              placeholder={t('auth.email_placeholder')}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCorrect={false}
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              // Done/Go on the keyboard sends the link.
              onSubmitEditing={() => {
                if (valid && !busy) void send();
              }}
            />
            <Button
              testID="send-link"
              title={t('auth.send_link')}
              disabled={!valid}
              loading={busy}
              onPress={() => void send()}
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
        <Button
          variant="secondary"
          title={t('auth.continue_google')}
          onPress={() => run(signInWithGoogle)}
        />

        <ErrorText>{error}</ErrorText>
      </Screen>
    </KeyboardAvoidingView>
  );
}
