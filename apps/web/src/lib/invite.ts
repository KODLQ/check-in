import 'server-only';

import { isValidInviteToken, type RsvpStatus } from '@check-in/shared';
import { cache } from 'react';

import { publicClient } from './supabase';

export interface InviteEvent {
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  time_zone: string;
  location_text: string;
  place_name: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_path: string | null;
  theme: string;
  time_changed_at: string | null;
  guest_list_visible: boolean;
}

export type Invite =
  | { state: 'not_found' }
  | { state: 'cancelled'; event: { title: string } }
  | {
      state: 'active' | 'past';
      event: InviteEvent;
      host: { display_name: string | null; avatar_path: string | null };
      counts: { going: number; maybe: number };
      guests: { display_name: string; status: RsvpStatus }[] | null;
      my_rsvp: { status: RsvpStatus; display_name: string } | null;
    };

export const GUEST_COOKIE = 'ci_guest';

/** Memoized per request so generateMetadata and the page share one call. */
export const getInvite = cache(async (token: string, guestToken?: string): Promise<Invite> => {
  if (!isValidInviteToken(token)) return { state: 'not_found' };
  const { data, error } = await publicClient().rpc('get_invite', {
    p_token: token,
    p_guest_token: guestToken,
  });
  if (error || !data) return { state: 'not_found' };
  return data as unknown as Invite;
});
