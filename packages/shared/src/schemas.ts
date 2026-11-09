import { z } from 'zod';

/** Answers a guest can give. */
export const RSVP_STATUSES = ['going', 'maybe', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
/** Stored response status: an answer, or Going put on the waitlist by the system (add-guest-capacity). */
export type RsvpState = RsvpStatus | 'waitlisted';

/** Plus-ones per guest: the host picks a maximum of 1..5 (mirrors the DB check constraints). */
export const MAX_PLUS_ONES = 5;
/** Largest capacity an event can have: 500 responses x (1 + 5 plus-ones). */
export const MAX_CAPACITY = 3000;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'name_required')
  .max(50, 'name_too_long');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Input for creating or editing an event. `now` is injectable for tests.
 * Error messages are i18n keys under `errors.*`.
 */
export const makeEventInputSchema = (now: () => Date = () => new Date()) =>
  z
    .object({
      title: z.string().trim().min(1, 'title_required').max(100, 'title_too_long'),
      startsAt: z.date({ error: 'start_required' }),
      endsAt: z.date().optional(),
      locationText: z.string().trim().min(1, 'location_required').max(200),
      placeName: optionalText(200),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      description: optionalText(2000),
      theme: z.string().default('sunset'),
      // Guests (add-guest-capacity): optional, off / unlimited by default.
      allowPlusOnes: z.boolean().default(false),
      maxPlusOnes: z
        .int('max_plus_ones_invalid')
        .min(1, 'max_plus_ones_invalid')
        .max(MAX_PLUS_ONES, 'max_plus_ones_invalid')
        .default(1),
      /** null/undefined = no limit. */
      capacity: z
        .int('capacity_invalid')
        .min(1, 'capacity_invalid')
        .max(MAX_CAPACITY, 'capacity_invalid')
        .nullable()
        .optional(),
    })
    .refine((e) => e.startsAt.getTime() > now().getTime(), {
      path: ['startsAt'],
      message: 'start_in_past',
    })
    .refine((e) => !e.endsAt || e.endsAt.getTime() > e.startsAt.getTime(), {
      path: ['endsAt'],
      message: 'end_before_start',
    })
    .refine((e) => (e.latitude === undefined) === (e.longitude === undefined), {
      path: ['latitude'],
      message: 'invalid_location',
    });

export const eventInputSchema = makeEventInputSchema();
export type EventInput = z.input<ReturnType<typeof makeEventInputSchema>>;

/** Trimmed, lower-cased email address (max 254 chars). Error key: `invalid_email`. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'invalid_email')
  .pipe(z.email('invalid_email'));

/** Browser guest token: random, base64url. Only its hash is stored. */
export const guestTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

/** Single-use claim ticket for handing a browser's RSVPs to the app (128 bits, base64url). */
export const CLAIM_TICKET_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const claimTicketSchema = z.string().regex(CLAIM_TICKET_PATTERN);

/** POST /api/claim-ticket body. The guest token travels in the body, never in a URL. */
export const claimTicketInputSchema = z.object({ guestToken: guestTokenSchema }).strict();

/**
 * Guest RSVP from the web invite page.
 * `email`: omitted (or blank) = keep the current subscription, `null` = remove it, string = set/replace it.
 * A non-empty email requires `emailConsent === true` (error key `consent_required`).
 */
export const rsvpInputSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9]{12}$/),
    guestToken: guestTokenSchema,
    displayName: displayNameSchema,
    status: z.enum(RSVP_STATUSES),
    /**
     * Plus-ones with a Going answer (0..5; the event's own maximum is enforced by the database).
     * Omitted = keep the current number (e.g. when only the email changes). Ignored for Maybe/Can't go.
     */
    plusOnes: z.int('too_many_plus_ones').min(0, 'too_many_plus_ones').max(MAX_PLUS_ONES, 'too_many_plus_ones').optional(),
    email: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      emailSchema.nullable().optional(),
    ),
    emailConsent: z.boolean().optional(),
    locale: z.enum(['en', 'sv']).optional(),
  })
  .refine((v) => !v.email || v.emailConsent === true, {
    path: ['emailConsent'],
    message: 'consent_required',
  });
export type RsvpInput = z.infer<typeof rsvpInputSchema>;

export const ANNOUNCEMENT_MAX_LENGTH = 500;

export const announcementInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'announcement_required')
    .max(ANNOUNCEMENT_MAX_LENGTH, 'announcement_too_long'),
});
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

// ---- Date polls (add-date-polls) ----------------------------------------------------------------

/** A guest's answer to one candidate time. Mirrors the `vote_choice` enum. */
export const VOTE_CHOICES = ['yes', 'if_needed', 'no'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/** A poll has 2 to 4 candidate start times (mirrors public.min/max_poll_options()). */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 4;

export const pollOptionSchema = z.object({
  /** Existing option (editing). Omitted for new options. */
  id: z.string().optional(),
  startsAt: z.date({ error: 'start_required' }),
  endsAt: z.date().optional(),
});
export type PollOptionInput = z.infer<typeof pollOptionSchema>;

/**
 * Candidate times and optional voting deadline, with the same rules as the database
 * (public.validate_poll_options): 2-4 options, starts in the future and distinct, end after start,
 * deadline in the future and no later than the earliest future option.
 * Editing: options whose id is in `keepIds` are unchanged and may already have passed, and an unchanged
 * deadline (`previousClosesAt`) that has already passed is accepted.
 * Errors: `options` -> poll_option_count; `options.<i>.startsAt|endsAt` -> option_in_past,
 * option_duplicate, end_before_start; `closesAt` -> deadline_invalid. Read them with pollErrors().
 */
export const makeDatePollInputSchema = (
  now: () => Date = () => new Date(),
  opts: { keepIds?: readonly string[]; previousClosesAt?: Date | null } = {},
) =>
  z
    .object({
      options: z.array(pollOptionSchema),
      closesAt: z.date().nullable().optional(),
    })
    .superRefine((v, ctx) => {
      const t = now().getTime();
      const keep = new Set(opts.keepIds ?? []);
      if (v.options.length < MIN_POLL_OPTIONS || v.options.length > MAX_POLL_OPTIONS) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'poll_option_count' });
      }
      const seen = new Set<number>();
      let earliestOpen: number | null = null;
      v.options.forEach((o, i) => {
        const s = o.startsAt.getTime();
        if (s <= t && !(o.id && keep.has(o.id))) {
          ctx.addIssue({ code: 'custom', path: ['options', i, 'startsAt'], message: 'option_in_past' });
        } else if (seen.has(s)) {
          ctx.addIssue({ code: 'custom', path: ['options', i, 'startsAt'], message: 'option_duplicate' });
        }
        seen.add(s);
        if (o.endsAt && o.endsAt.getTime() <= s) {
          ctx.addIssue({ code: 'custom', path: ['options', i, 'endsAt'], message: 'end_before_start' });
        }
        if (s > t && (earliestOpen === null || s < earliestOpen)) earliestOpen = s;
      });
      if (v.closesAt) {
        const c = v.closesAt.getTime();
        const unchangedPassed = opts.previousClosesAt?.getTime() === c && c <= t;
        if (!unchangedPassed && (c <= t || earliestOpen === null || c > earliestOpen)) {
          ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'deadline_invalid' });
        }
      }
    });
export type DatePollInput = z.infer<ReturnType<typeof makeDatePollInputSchema>>;

export interface PollErrors {
  /** Whole-poll error (poll_option_count). */
  options?: string;
  closesAt?: string;
  /** Per option index: { startsAt?, endsAt? }. */
  byOption: Record<number, { startsAt?: string; endsAt?: string }>;
}

/** Splits date-poll schema issues into whole-poll, deadline and per-option error keys (first one wins). */
export function pollErrors<T>(result: z.ZodSafeParseResult<T>): PollErrors | null {
  if (result.success) return null;
  const out: PollErrors = { byOption: {} };
  for (const issue of result.error.issues) {
    const [root, index, field] = issue.path;
    if (root === 'closesAt') out.closesAt ??= issue.message;
    else if (root === 'options' && typeof index === 'number' && (field === 'startsAt' || field === 'endsAt')) {
      const slot = (out.byOption[index] ??= {});
      slot[field] ??= issue.message;
    } else if (root === 'options') out.options ??= issue.message;
  }
  return out;
}

/** One answer in a ballot. */
export const voteSchema = z.object({
  optionId: z.uuid(),
  choice: z.enum(VOTE_CHOICES),
});

/** POST /api/votes body: a guest's whole ballot (options left out are unanswered). */
export const ballotInputSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9]{12}$/),
  guestToken: guestTokenSchema,
  displayName: displayNameSchema,
  votes: z
    .array(voteSchema)
    .min(1, 'no_votes')
    .max(MAX_POLL_OPTIONS, 'option_not_found')
    .refine((votes) => new Set(votes.map((v) => v.optionId)).size === votes.length, 'option_not_found'),
});
export type BallotInput = z.infer<typeof ballotInputSchema>;

/** Returns a map of field -> first error key, or null when valid. */
export function fieldErrors<T>(
  result: z.ZodSafeParseResult<T>,
): Record<string, string> | null {
  if (result.success) return null;
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
