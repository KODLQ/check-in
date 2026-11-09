import 'server-only';

import {
  formatHostNames,
  hostedByKey,
  isValidInviteToken,
  type InvitePoll,
  type Locale,
  type MyVotes,
  type RsvpState,
  type RsvpStatus, type RepeatFrequency } from '@check-in/shared';
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
  /** Guests (add-guest-capacity). */
  allow_plus_ones: boolean;
  max_plus_ones: number;
  capacity: number | null;
}

export interface EmailUpdates {
  state: 'on' | 'off' | 'rate_limited';
  /** e.g. "a•••@gmail.com". Only ever returned to the guest's own device. */
  masked: string | null;
}

export interface MyRsvp {
  status: RsvpState;
  display_name: string;
  plus_ones: number;
  /** 1-based, only while waitlisted. */
  waitlist_position: number | null;
  /** Promoted from the waitlist and hasn't changed the answer since ("You got a spot!"). */
  promoted: boolean;
  email_updates?: EmailUpdates;
}

/** Head-based counts: Going and waitlist count guests plus their plus-ones. */
export interface InviteCounts {
  going: number;
  maybe: number;
  waitlist: number;
  /** null when the event has no capacity. */
  spots_left: number | null;
  full: boolean;
}

export interface Announcement {
  id: string;
  body: string;
  created_at: string;
}

/** A date of a group's repeating event (add-groups-and-recurring-events). */
export interface InviteSeries {
  frequency: RepeatFrequency;
  anchor_local_date: string;
  /** The next date that isn't cancelled, with its own invite link. */
  next: { event_id: string; starts_at: string; token: string | null } | null;
}

/** Host names shown to guests (add-co-hosts). */
interface InviteHosts {
  host: { display_name: string | null; avatar_path: string | null };
  /** Co-host display names, in the order they joined (add-co-hosts). */
  co_hosts?: { display_name: string | null }[];
  /** Series dates are hosted by the group (add-groups-and-recurring-events). */
  group?: { name: string } | null;
  series?: InviteSeries | null;
}

export type Invite =
  | { state: 'not_found' }
  | { state: 'cancelled'; event: { title: string } }
  | (InviteHosts & {
      /** Date poll still open (add-date-polls): no time, counts, guest list or RSVP yet. */
      state: 'date_pending';
      event: Omit<InviteEvent, 'starts_at' | 'ends_at'> & { starts_at: null; ends_at: null };
      poll: InvitePoll;
      /** This browser's (or signed-in user's) ballot. */
      my_votes: MyVotes | null;
      announcements: Announcement[];
    })
  | {
      state: 'active' | 'past';
      event: InviteEvent;
      host: { display_name: string | null; avatar_path: string | null };
      /** Co-host display names, in the order they joined (add-co-hosts). */
      co_hosts?: { display_name: string | null }[];
      group?: { name: string } | null;
      series?: InviteSeries | null;
      counts: InviteCounts;
      /** Going and Maybe only; waitlisted guests are never listed. */
      guests: { display_name: string; status: RsvpStatus; plus_ones: number }[] | null;
      my_rsvp: MyRsvp | null;
      announcements: Announcement[];
    };

export const GUEST_COOKIE = 'ci_guest';

/**
 * "Hosted by Anna & Erik" — owner first, then co-hosts in join order (spec: co-hosts). A series date is
 * hosted by its group: "Hosted by AW crew · Anna" (spec: recurring-events "Group shown as host").
 */
export function hostedByLine(
  invite: {
    host: { display_name: string | null };
    co_hosts?: { display_name: string | null }[];
    group?: { name: string } | null;
  },
  locale: Locale,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  if (invite.group) {
    return t('invite.hosted_by', {
      name: t('series.hosted_by_group', { group: invite.group.name, name: invite.host.display_name ?? '' }),
    });
  }
  const coHosts = (invite.co_hosts ?? []).map((h) => h.display_name);
  const key = hostedByKey(invite.host.display_name, coHosts);
  return t(`invite.${key}`, { name: formatHostNames(invite.host.display_name, coHosts, locale) });
}

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
