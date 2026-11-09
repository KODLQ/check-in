import type { EventFormValues } from '@/components/event-form';
import { supabase } from './supabase';

/** Every event column the form edits except the time (a date-pending event's time is set by a pick). */
export function toEventDetailsRow(v: EventFormValues) {
  return {
    title: v.title,
    location_text: v.locationText,
    place_name: v.placeName ?? null,
    latitude: v.latitude ?? null,
    longitude: v.longitude ?? null,
    description: v.description ?? null,
    theme: v.theme ?? 'sunset',
    cover_path: v.coverPath ?? null,
    guest_list_visible: v.guestListVisible,
    allow_plus_ones: v.allowPlusOnes ?? false,
    max_plus_ones: v.maxPlusOnes ?? 1,
    capacity: v.capacity ?? null,
  };
}

export function toEventRow(v: EventFormValues) {
  return {
    ...toEventDetailsRow(v),
    starts_at: v.startsAt.toISOString(),
    ends_at: v.endsAt ? v.endsAt.toISOString() : null,
  };
}

/** create_poll_event arguments for a "Let guests vote" event (add-date-polls). */
export function toPollEventArgs(v: EventFormValues & { poll: NonNullable<EventFormValues['poll']> }) {
  return {
    p_event: toEventDetailsRow(v),
    p_options: v.poll.options.map((o) => ({
      starts_at: o.startsAt.toISOString(),
      ends_at: o.endsAt ? o.endsAt.toISOString() : null,
    })),
    p_closes_at: v.poll.closesAt ? v.poll.closesAt.toISOString() : undefined,
  };
}

/** Maps server-side rule violations (raised by triggers/functions) to i18n error keys. */
export function errorKey(error: { message?: string } | null | undefined): string {
  const known = [
    'start_in_past',
    'event_ended',
    'event_closed',
    'name_required',
    'rate_limited',
    'owner_only',
    'co_host_limit',
    'invalid_invite',
    'already_host',
    'invalid_cover',
    // Guest capacity (add-guest-capacity).
    'capacity_exceeded',
    'too_many_plus_ones',
    'plus_ones_not_allowed',
    'invalid_status',
    'not_waitlisted',
    // Date polls (add-date-polls).
    'poll_closed',
    'option_passed',
    'already_picked',
    'date_pending',
    'poll_option_count',
    'option_in_past',
    'option_duplicate',
    'deadline_invalid',
    'no_votes',
    'option_not_found',
    'invalid_choice',
  ];
  return known.find((k) => error?.message?.includes(k)) ?? 'unknown';
}

export async function fetchActiveInvite(eventId: string): Promise<string | null> {
  const { data } = await supabase
    .from('event_invites')
    .select('token')
    .eq('event_id', eventId)
    .is('revoked_at', null)
    .maybeSingle();
  return data?.token ?? null;
}
