import { z } from 'zod';

export const RSVP_STATUSES = ['going', 'maybe', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

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

/**
 * Guest RSVP from the web invite page.
 * `email`: omitted (or blank) = keep the current subscription, `null` = remove it, string = set/replace it.
 * A non-empty email requires `emailConsent === true` (error key `consent_required`).
 */
export const rsvpInputSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9]{12}$/),
    guestToken: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
    displayName: displayNameSchema,
    status: z.enum(RSVP_STATUSES),
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
