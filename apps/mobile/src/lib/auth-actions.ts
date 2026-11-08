import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

export const authRedirectUrl = () => Linking.createURL('auth/callback');

export async function sendMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) throw error;
}

/** Parses both ?query and #fragment params from an auth redirect URL. */
export function parseAuthRedirect(url: string) {
  const out: Record<string, string> = {};
  const [beforeHash, hash] = url.split('#');
  const query = beforeHash?.split('?')[1];
  for (const part of [query, hash]) {
    if (!part) continue;
    for (const [k, v] of new URLSearchParams(part)) out[k] = v;
  }
  return out;
}

export async function completeAuthRedirect(url: string): Promise<'ok' | 'invalid'> {
  const params = parseAuthRedirect(url);
  if (params.error || params.error_code) return 'invalid';
  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    return error ? 'invalid' : 'ok';
  }
  return 'invalid';
}

export async function signInWithApple() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) throw new Error('No identity token from Apple');
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
  // Apple only shares the name on the very first sign-in; keep it as a starting display name.
  const name = credential.fullName
    ? AppleAuthentication.formatFullName(credential.fullName).trim()
    : '';
  if (name && data.user) {
    await supabase
      .from('profiles')
      .update({ display_name: name.slice(0, 50) })
      .eq('id', data.user.id)
      .is('display_name', null);
  }
}

export async function signInWithGoogle() {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'success') {
    const status = await completeAuthRedirect(result.url);
    if (status !== 'ok') throw new Error('Google sign-in failed');
  }
}
