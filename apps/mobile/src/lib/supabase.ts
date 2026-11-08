import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@check-in/shared';
import { AppState, Platform } from 'react-native';

import { SUPABASE_KEY, SUPABASE_URL } from './config';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Only refresh tokens while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export type EventRow = Omit<Database['public']['Tables']['events']['Row'], 'event_ended_at'>;
export type RsvpRow = Database['public']['Tables']['rsvps']['Row'];
export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function publicUrl(bucket: 'covers' | 'avatars', path: string | null | undefined) {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
