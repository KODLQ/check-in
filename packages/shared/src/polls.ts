import type { VoteChoice } from './schemas';

/** Answer counts of one option. */
export interface PollTallies {
  yes: number;
  if_needed: number;
  no: number;
}

/** The poll part of the guest invite payload (get_invite / get_my_invite, state 'date_pending'). */
export interface InvitePoll {
  closes_at: string | null;
  /** Every option's time has passed: the event was never scheduled. */
  expired: boolean;
  /** Not expired and before the deadline. */
  voting_open: boolean;
  voter_count: number;
  options: {
    id: string;
    starts_at: string;
    ends_at: string | null;
    passed: boolean;
    tallies: PollTallies;
    /** Yes and If needed names; null when the host hides the guest list. Never No. */
    voters: { display_name: string; choice: Exclude<VoteChoice, 'no'> }[] | null;
  }[];
}

/** The caller's own ballot: option id -> choice. */
export interface MyVotes {
  display_name: string;
  votes: Record<string, VoteChoice>;
}

/** Tallies of an option from individual votes (host app, which reads the votes). */
export function tally(votes: readonly { option_id: string; choice: VoteChoice }[], optionId: string): PollTallies {
  const t: PollTallies = { yes: 0, if_needed: 0, no: 0 };
  for (const v of votes) if (v.option_id === optionId) t[v.choice] += 1;
  return t;
}

/**
 * The option to highlight: most Yes answers, If needed breaking ties. Null while nobody answered Yes or
 * If needed, or when the top two are still tied.
 */
export function leadingOptionId(options: readonly { id: string; tallies: PollTallies }[]): string | null {
  const ranked = [...options].sort(
    (a, b) => b.tallies.yes - a.tallies.yes || b.tallies.if_needed - a.tallies.if_needed,
  );
  const [first, second] = ranked;
  if (!first || first.tallies.yes + first.tallies.if_needed === 0) return null;
  if (second && second.tallies.yes === first.tallies.yes && second.tallies.if_needed === first.tallies.if_needed) {
    return null;
  }
  return first.id;
}

/**
 * What picking an option will do (pick confirmation), mirroring public.pick_poll_option(): Yes voters
 * become Going in the order they first voted while they fit the capacity (each counts as one head, no
 * plus-ones), the rest are waitlisted; If needed voters become Maybe.
 */
export function pickOutcome(
  tallies: Pick<PollTallies, 'yes' | 'if_needed'>,
  capacity: number | null | undefined,
): { going: number; waitlisted: number; maybe: number } {
  const going = capacity == null ? tallies.yes : Math.min(tallies.yes, Math.max(capacity, 0));
  return { going, waitlisted: tallies.yes - going, maybe: tallies.if_needed };
}

/** An option of a poll being edited: its id (when it already exists) and times. */
export interface EditedOption {
  id?: string;
  startsAt: Date;
  endsAt?: Date | null;
}

const sameTime = (a?: Date | string | null, b?: Date | string | null) =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** Ids of existing options that the edit leaves unchanged (same id and times): they keep their votes. */
export function unchangedOptionIds(
  original: readonly { id: string; starts_at: string; ends_at: string | null }[],
  edited: readonly EditedOption[],
): string[] {
  return edited
    .filter((e) => {
      const o = e.id ? original.find((x) => x.id === e.id) : undefined;
      return !!o && sameTime(o.starts_at, e.startsAt) && sameTime(o.ends_at, e.endsAt);
    })
    .map((e) => e.id!);
}

/**
 * How many votes an edit deletes ("N votes will be deleted"), mirroring public.set_poll_options(): every
 * vote on an option that is removed or whose times change.
 */
export function deletedVoteCount(
  original: readonly { id: string; starts_at: string; ends_at: string | null }[],
  edited: readonly EditedOption[],
  votes: readonly { option_id: string }[],
): number {
  const keep = new Set(unchangedOptionIds(original, edited));
  return votes.filter((v) => !keep.has(v.option_id)).length;
}

/** The host list marker: voting closed (deadline passed) or every option passed, and still no pick. */
export function pollNeedsPick(
  poll: { closes_at: string | null; options: readonly { starts_at: string }[] },
  now: Date = new Date(),
): boolean {
  const t = now.getTime();
  const allPassed = poll.options.length > 0 && poll.options.every((o) => new Date(o.starts_at).getTime() <= t);
  const closed = poll.closes_at !== null && new Date(poll.closes_at).getTime() <= t;
  return allPassed || closed;
}
