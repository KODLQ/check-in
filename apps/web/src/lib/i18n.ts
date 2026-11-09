import 'server-only';

import { parseAcceptLanguage, pickLocale, translations, WALL_ERRORS, type Locale } from '@check-in/shared';
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
    withdrawDeletePosts: t('wall.withdraw_delete_posts'),
  };
}
export type ClientStrings = ReturnType<typeof clientStrings>;

/** Strings for the date-poll client component (add-date-polls). Placeholders are filled on the client. */
export function pollStrings(t: T) {
  return {
    yes: t('polls.yes'),
    ifNeeded: t('polls.if_needed'),
    no: t('polls.no'),
    passed: t('polls.passed'),
    tallies: t('polls.tallies', { yes: '{{yes}}', if_needed: '{{if_needed}}', no: '{{no}}' }),
    saveVotes: t('polls.save_votes'),
    removeVotes: t('polls.remove_votes'),
    yourVotes: t('polls.your_votes', { name: '{{name}}' }),
    nameLabel: t('rsvp.name_label'),
    namePlaceholder: t('profile.name_placeholder'),
    nameRequired: t('errors.name_required'),
    noVotes: t('errors.no_votes'),
    rateLimited: t('errors.rate_limited'),
    pollChanged: t('errors.poll_closed'),
    optionPassed: t('errors.option_passed'),
    optionsChanged: t('errors.option_not_found'),
    eventClosed: t('errors.event_closed'),
    error: t('common.error'),
  };
}
export type PollStrings = ReturnType<typeof pollStrings>;

/** Strings for the event wall client component (add-event-wall). Placeholders are filled on the client. */
export function wallStrings(t: T) {
  const keys = [
    'title', 'placeholder', 'post', 'posting', 'add_photos', 'remove_photo', 'host_label', 'empty', 'load_more',
    'delete', 'delete_confirm', 'your_posts', 'delete_all', 'delete_all_confirm', 'device_note', 'close', 'refresh',
  ] as const;
  const s = Object.fromEntries(keys.map((k) => [k, t(`wall.${k}`)])) as Record<(typeof keys)[number], string>;
  return {
    ...s,
    counter: t('wall.counter', { count: '{{count}}' }),
    uploading: t('wall.uploading', { done: '{{done}}', total: '{{total}}' }),
    photoAlt: t('wall.photo_alt', { name: '{{name}}' }),
    photosLeft: t('wall.photos_left', { count: '{{count}}' }),
    photosLeftOne: t('wall.photos_left_one'),
    reasons: Object.fromEntries(
      ['not_attending', 'blocked', 'disabled', 'closed', 'cancelled'].map((r) => [r, t(`wall.reason.${r}`)]),
    ) as Record<string, string>,
    errors: Object.fromEntries(WALL_ERRORS.map((e) => [e, t(`wall.errors.${e}`)])) as Record<string, string>,
  };
}
export type WallStrings = ReturnType<typeof wallStrings>;
