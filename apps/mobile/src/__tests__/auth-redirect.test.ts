jest.mock('@/lib/supabase', () => ({ supabase: { auth: { exchangeCodeForSession: jest.fn() } } }));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-web-browser', () => ({}));

import { completeAuthRedirect, parseAuthRedirect } from '@/lib/auth-actions';

describe('auth redirect', () => {
  it('reads params from query and fragment', () => {
    expect(parseAuthRedirect('checkin://auth/callback?code=abc#x=1')).toEqual({ code: 'abc', x: '1' });
  });
  it('treats an expired magic link as invalid', async () => {
    await expect(
      completeAuthRedirect('checkin://auth/callback#error=access_denied&error_code=otp_expired'),
    ).resolves.toBe('invalid');
  });
});
