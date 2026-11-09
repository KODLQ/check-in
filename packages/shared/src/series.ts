import { z } from 'zod';

/** add-groups-and-recurring-events: how a group's series repeats. */
export const REPEAT_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type RepeatFrequency = (typeof REPEAT_FREQUENCIES)[number];

export const MAX_GROUP_NAME = 50;
export const MAX_GROUP_MEMBERS = 50;
/** Dates of a series that always exist ahead (spec: recurring-events "Upcoming dates always available"). */
export const SERIES_UPCOMING_DATES = 4;

const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  sv: ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'],
} as const;
// Swedish month positions take the definite form: "första fredagen".
const WEEKDAYS_DEFINITE_SV = ['söndagen', 'måndagen', 'tisdagen', 'onsdagen', 'torsdagen', 'fredagen', 'lördagen'] as const;
const ORDINALS = {
  en: ['First', 'Second', 'Third', 'Fourth'],
  sv: ['Första', 'Andra', 'Tredje', 'Fjärde'],
} as const;

/** Parses a local calendar date (YYYY-MM-DD) without time-zone shifts. */
function parseLocalDate(date: string): { weekday: number; day: number; lastWeek: boolean } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { weekday: utc.getUTCDay(), day: d, lastWeek: d > daysInMonth - 7 };
}

/**
 * The repeat rule in words, matching how the database computes dates: weekly and every 2 weeks keep the
 * weekday; monthly keeps the weekday position (first to fourth), or "last" when the first date is in the
 * last seven days of its month. `anchorLocalDate` is the series' anchor date (YYYY-MM-DD, local).
 */
export function formatRepeatRule(frequency: RepeatFrequency, anchorLocalDate: string, locale: string): string {
  const sv = locale === 'sv';
  const { weekday, day, lastWeek } = parseLocalDate(anchorLocalDate);
  if (frequency === 'weekly') return sv ? `Varje ${WEEKDAYS.sv[weekday]}` : `Every ${WEEKDAYS.en[weekday]}`;
  if (frequency === 'biweekly') return sv ? `Varannan ${WEEKDAYS.sv[weekday]}` : `Every other ${WEEKDAYS.en[weekday]}`;
  if (lastWeek) {
    return sv ? `Sista ${WEEKDAYS_DEFINITE_SV[weekday]} i månaden` : `Last ${WEEKDAYS.en[weekday]} of the month`;
  }
  const n = Math.ceil(day / 7) - 1;
  return sv
    ? `${ORDINALS.sv[n]} ${WEEKDAYS_DEFINITE_SV[weekday]} i månaden`
    : `${ORDINALS.en[n]} ${WEEKDAYS.en[weekday]} of the month`;
}

export const groupNameSchema = z.string().trim().min(1).max(MAX_GROUP_NAME);

/** Repeat settings sent with create_series / update_series_rule. */
export const seriesRuleSchema = z.object({
  frequency: z.enum(REPEAT_FREQUENCIES),
  ends_on: z.iso.date().nullable().optional(),
});
export type SeriesRule = z.infer<typeof seriesRuleSchema>;

export const seriesInputSchema = seriesRuleSchema.extend({ group_id: z.uuid() });
export type SeriesInput = z.infer<typeof seriesInputSchema>;

/** Validates the end date against the first date (both local YYYY-MM-DD). */
export function endsOnError(endsOn: string | null | undefined, firstLocalDate: string): 'before_start' | null {
  return endsOn && endsOn < firstLocalDate ? 'before_start' : null;
}
