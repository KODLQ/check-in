import type { EventFormValues } from '@/components/event-form';
import { supabase } from './supabase';

export function toEventRow(v: EventFormValues) {
  return {
    title: v.title,
    starts_at: v.startsAt.toISOString(),
    ends_at: v.endsAt ? v.endsAt.toISOString() : null,
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
