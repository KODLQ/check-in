import { supabase } from './supabase';

/**
 * Event id behind an invite token, but only for the event's owner and co-hosts: event_invites is readable
 * by managers only (RLS), so guests get null. Any failure also gives null (the guest view still works).
 */
/** True when the signed-in user is the event's owner or a co-host (events are readable by managers only). */
export async function managesEvent(eventId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('events').select('id').eq('id', eventId).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function managedEventIdForToken(token: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('event_invites').select('event_id').eq('token', token).maybeSingle();
    return data?.event_id ?? null;
  } catch {
    return null;
  }
}
