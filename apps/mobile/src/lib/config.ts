export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
export const INVITE_BASE_URL = process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? 'http://localhost:3000';
/** Facebook App ID required by Instagram's "share to Stories". Unset → Instagram is not offered. */
export const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? '';
/** Snap Kit (Creative Kit) client ID; also read at prebuild by plugins/with-story-share. Unset → Snapchat is not offered. */
export const SNAP_CLIENT_ID = process.env.EXPO_PUBLIC_SNAP_CLIENT_ID ?? '';
