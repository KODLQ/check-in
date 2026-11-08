import type { ProfileRow } from './supabase';

export type Area = 'signed-out' | 'onboarding' | 'app';

/** Which part of the app a user may use. Event creation requires a display name (spec: user-accounts). */
export function accessArea(signedIn: boolean, profile: Pick<ProfileRow, 'display_name'> | null): Area {
  if (!signedIn) return 'signed-out';
  if (!profile?.display_name?.trim()) return 'onboarding';
  return 'app';
}
