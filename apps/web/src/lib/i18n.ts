import 'server-only';

import { parseAcceptLanguage, pickLocale, translations, type Locale } from '@check-in/shared';
import { headers } from 'next/headers';

export async function getLocale(): Promise<Locale> {
  const h = await headers();
  return pickLocale(parseAcceptLanguage(h.get('accept-language')));
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): T {
  return (key, vars) => {
    let node: unknown = translations[locale];
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    let str = typeof node === 'string' ? node : key;
    for (const [k, v] of Object.entries(vars ?? {})) str = str.replaceAll(`{{${k}}}`, String(v));
    return str;
  };
}

/** Subset of strings the client RSVP component needs. */
export function clientStrings(t: T) {
  return {
    going: t('rsvp.going'),
    maybe: t('rsvp.maybe'),
    declined: t('rsvp.declined'),
    nameLabel: t('rsvp.name_label'),
    namePlaceholder: t('profile.name_placeholder'),
    remove: t('rsvp.remove'),
    yourAnswer: t('rsvp.your_answer', { status: '{{status}}' }),
    nameRequired: t('errors.name_required'),
    rateLimited: t('errors.rate_limited'),
    eventClosed: t('errors.event_closed'),
    error: t('common.error'),
    emailLabel: t('rsvp.email_label'),
    emailPlaceholder: t('rsvp.email_placeholder'),
    emailConsent: t('rsvp.email_consent'),
    emailHelper: t('rsvp.email_helper'),
    emailOn: t('rsvp.email_on', { email: '{{email}}' }),
    emailTurnOff: t('rsvp.email_turn_off'),
    emailAdd: t('rsvp.email_add'),
    emailSave: t('rsvp.email_save'),
    emailRateLimited: t('rsvp.email_rate_limited'),
    consentRequired: t('errors.consent_required'),
    invalidEmail: t('errors.invalid_email'),
    planYourOwn: t('invite.plan_your_own'),
    planYourOwnBody: t('invite.plan_your_own_body'),
    // Guest capacity. Placeholders stay in the string and are filled on the client.
    waitlisted: t('rsvp.waitlisted'),
    goingPlus: t('rsvp.going_plus', { count: '{{count}}' }),
    plusOnesLabel: t('rsvp.plus_ones_label'),
    plusOnesHint: t('rsvp.plus_ones_hint', { max: '{{max}}' }),
    plusOnesDecrease: t('rsvp.plus_ones_decrease'),
    plusOnesIncrease: t('rsvp.plus_ones_increase'),
    fullJoinWaitlist: t('rsvp.full_join_waitlist'),
    waitlistPosition: t('rsvp.waitlist_position', { position: '{{position}}' }),
    gotASpot: t('rsvp.got_a_spot'),
    capacityExceeded: t('errors.capacity_exceeded', { count: '{{count}}' }),
    capacityExceededOne: t('errors.capacity_exceeded_one'),
    tooManyPlusOnes: t('errors.too_many_plus_ones', { max: '{{max}}' }),
    plusOnesNotAllowed: t('errors.plus_ones_not_allowed'),
    invalidStatus: t('errors.invalid_status'),
  };
}
export type ClientStrings = ReturnType<typeof clientStrings>;
