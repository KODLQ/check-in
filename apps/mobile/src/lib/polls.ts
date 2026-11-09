import type { VoteChoice } from '@check-in/shared';

import { supabase } from './supabase';

/** A candidate time of a date poll, as the host reads it (RLS: owner and co-hosts). */
export interface PollOptionRow {
  id: string;
  starts_at: string;
  ends_at: string | null;
}

/** A voter and their ballot. */
export interface PollVoterRow {
  id: string;
  display_name: string;
  user_id: string | null;
  created_at: string;
  date_poll_votes: { option_id: string; choice: VoteChoice }[];
}

export interface HostPoll {
  options: PollOptionRow[];
  voters: PollVoterRow[];
}

/** Every option and every voter with their answers (add-date-polls). */
export async function loadHostPoll(eventId: string): Promise<HostPoll> {
  const [options, voters] = await Promise.all([
    supabase.from('date_poll_options').select('id, starts_at, ends_at').eq('event_id', eventId).order('starts_at'),
    supabase
      .from('date_poll_voters')
      .select('id, display_name, user_id, created_at, date_poll_votes(option_id, choice)')
      .eq('event_id', eventId)
      .order('created_at'),
  ]);
  return {
    options: (options.data as PollOptionRow[] | null) ?? [],
    voters: (voters.data as PollVoterRow[] | null) ?? [],
  };
}

/** All votes of a poll, flattened. */
export function allVotes(poll: HostPoll): { voter_id: string; option_id: string; choice: VoteChoice }[] {
  return poll.voters.flatMap((v) => v.date_poll_votes.map((x) => ({ voter_id: v.id, ...x })));
}
