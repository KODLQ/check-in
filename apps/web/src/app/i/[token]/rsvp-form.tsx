'use client';

import type { RsvpStatus } from '@check-in/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import {
  getGuestToken,
  GUEST_NAME_KEY,
  GUEST_STORAGE_KEY,
  readGuestCookie as readCookie,
  safeStorage,
  writeGuestCookie as writeCookie,
} from '@/lib/guest-device';
import type { ClientStrings } from '@/lib/i18n';
import type { MyRsvp } from '@/lib/invite';

const STORAGE_KEY = GUEST_STORAGE_KEY;
const NAME_KEY = GUEST_NAME_KEY;
const STATUSES: RsvpStatus[] = ['going', 'maybe', 'declined'];

/**
 * Post-RSVP "Plan your own" prompt. Creates a claim ticket for this browser's RSVPs (guest token in the
 * POST body) and opens the hand-off page with the ticket in the URL fragment, which browsers never
 * send to a server or in a Referer header.
 */
function PlanYourOwn({ strings }: { strings: ClientStrings }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    let hash = '';
    try {
      const res = await fetch('/api/claim-ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guestToken: getGuestToken() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ticket?: string };
      if (res.ok && body.ticket) hash = `#t=${body.ticket}`;
    } catch {
      // Without a ticket the hand-off page still shows the store links.
    }
    window.location.assign(`/get-app${hash}`);
  }

  return (
    <button
      type="button"
      className="card plan-own"
      data-testid="plan-your-own"
      disabled={busy}
      onClick={go}
    >
      <strong>{strings.planYourOwn}</strong>
      <span className="muted">{strings.planYourOwnBody}</span>
    </button>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "+ friends" stepper (0..max), sent with a Going answer. */
function PlusOnes({
  value,
  max,
  disabled,
  onChange,
  strings,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (n: number) => void;
  strings: ClientStrings;
}) {
  return (
    <div className="stepper" data-testid="plus-ones">
      <span>
        {strings.plusOnesLabel}{' '}
        <span className="muted">({strings.plusOnesHint.replace('{{max}}', String(max))})</span>
      </span>
      <span className="stepper-controls">
        <button
          type="button"
          className="btn"
          aria-label={strings.plusOnesDecrease}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <output aria-live="polite" data-testid="plus-ones-value">
          {value}
        </output>
        <button
          type="button"
          className="btn"
          aria-label={strings.plusOnesIncrease}
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </span>
    </div>
  );
}

/** The guest's own answer line: "Going +2", "You're on the waitlist — #3", "You got a spot!". */
function answerText(current: MyRsvp, strings: ClientStrings): string {
  if (current.status === 'waitlisted') {
    return strings.waitlistPosition.replace('{{position}}', String(current.waitlist_position ?? ''));
  }
  const label =
    current.status === 'going' && current.plus_ones > 0
      ? strings.goingPlus.replace('{{count}}', String(current.plus_ones))
      : strings[current.status];
  return strings.yourAnswer.replace('{{status}}', label);
}

export function RsvpForm({
  token,
  current,
  strings,
  locale,
  emailUpdates,
  plusOnes,
  full,
}: {
  token: string;
  current: MyRsvp | null;
  strings: ClientStrings;
  locale: 'en' | 'sv';
  /** Email opt-in is offered (feature flag). */
  emailUpdates: boolean;
  /** The host's plus-one setting (null = not allowed). */
  plusOnes: { max: number } | null;
  /** No spot left: Going joins the waitlist. */
  full: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(current?.display_name ?? '');
  // Never pre-filled or pre-ticked (spec: consent not pre-ticked).
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const subscribed = current?.email_updates?.state === 'on';
  const wantsToGo = current?.status === 'going' || current?.status === 'waitlisted';
  const [plus, setPlus] = useState(wantsToGo ? (current?.plus_ones ?? 0) : 0);
  // Re-sync after a refresh (e.g. the answer changed on another tab or was promoted).
  useEffect(() => {
    if (current?.status === 'going' || current?.status === 'waitlisted') setPlus(current.plus_ones);
  }, [current?.status, current?.plus_ones]);
  // The answer to re-send when only the email changes: waitlisted is "Going" from the guest's side.
  const currentAnswer: RsvpStatus | undefined =
    current?.status === 'waitlisted' ? 'going' : current?.status;

  // In-app browsers sometimes drop cookies but keep localStorage: restore and re-render.
  useEffect(() => {
    const stored = safeStorage()?.getItem(STORAGE_KEY);
    if (!readCookie() && stored) {
      writeCookie(stored);
      router.refresh();
    }
    if (!current) setName((n) => n || safeStorage()?.getItem(NAME_KEY) || '');
  }, [current, router]);

  /**
   * emailChange: undefined = keep the current subscription, null = turn updates off,
   * 'form' = opt in with the address typed in the form (requires the consent box).
   */
  async function send(method: 'POST' | 'DELETE', status?: RsvpStatus, emailChange?: 'form' | null) {
    setError(null);
    setEmailError(null);
    setNotice(null);
    if (method === 'POST' && !name.trim()) {
      setError(strings.nameRequired);
      return;
    }
    const typed = email.trim();
    const optIn =
      emailChange === 'form' ||
      (emailChange === undefined && !current && emailUpdates && typed !== '');
    if (optIn) {
      if (!EMAIL_RE.test(typed)) {
        setEmailError(strings.invalidEmail);
        return;
      }
      if (!consent) {
        setEmailError(strings.consentRequired);
        return;
      }
    }
    const emailBody = optIn
      ? { email: typed, emailConsent: true, locale }
      : emailChange === null
        ? { email: null, locale }
        : { locale };
    setBusy(true);
    try {
      const res = await fetch('/api/rsvp', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          guestToken: getGuestToken(),
          displayName: name,
          status,
          // Only a Going answer chosen here carries plus-ones; an email-only change keeps them.
          ...(method === 'POST' && status === 'going' && emailChange === undefined && plusOnes
            ? { plusOnes: plus }
            : {}),
          ...emailBody,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        email_updates?: { state: string };
        spots_left?: number | null;
        max_plus_ones?: number | null;
      };
      if (!res.ok) {
        if (body.error === 'consent_required') setEmailError(strings.consentRequired);
        else if (body.error === 'invalid_email') setEmailError(strings.invalidEmail);
        else if (body.error === 'capacity_exceeded')
          setError(
            body.spots_left === 1
              ? strings.capacityExceededOne
              : strings.capacityExceeded.replace('{{count}}', String(body.spots_left ?? 0)),
          );
        else if (body.error === 'too_many_plus_ones')
          setError(strings.tooManyPlusOnes.replace('{{max}}', String(body.max_plus_ones ?? plusOnes?.max ?? 0)));
        else if (body.error === 'plus_ones_not_allowed') setError(strings.plusOnesNotAllowed);
        else if (body.error === 'invalid_status') setError(strings.invalidStatus);
        else
          setError(
            body.error === 'rate_limited'
              ? strings.rateLimited
              : body.error === 'event_closed'
                ? strings.eventClosed
                : body.error === 'name_required'
                  ? strings.nameRequired
                  : strings.error,
          );
        return;
      }
      if (method === 'POST') safeStorage()?.setItem(NAME_KEY, name.trim());
      if (body.email_updates?.state === 'rate_limited') setNotice(strings.emailRateLimited);
      if (optIn && body.email_updates?.state === 'on') {
        setEmail('');
        setConsent(false);
        setShowEmail(false);
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

  const emailFields = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor="rsvp-email">{strings.emailLabel}</label>
      <input
        id="rsvp-email"
        type="email"
        inputMode="email"
        value={email}
        maxLength={254}
        autoComplete="email"
        placeholder={strings.emailPlaceholder}
        aria-invalid={emailError ? true : undefined}
        aria-describedby="rsvp-email-help"
        onChange={(e) => setEmail(e.target.value)}
      />
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{strings.emailConsent}</span>
      </label>
      <p id="rsvp-email-help" className="muted" style={{ margin: 0, fontSize: 14 }}>
        {strings.emailHelper}
      </p>
      {emailError ? (
        <p className="error" role="alert" data-testid="email-error">
          {emailError}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <section className="card" aria-label="RSVP">
        {current?.promoted && current.status === 'going' ? (
          <p className="badge" style={{ margin: 0, fontSize: 16 }} role="status" data-testid="got-a-spot">
            {strings.gotASpot}
          </p>
        ) : null}
        {current ? (
          <p style={{ margin: 0 }} data-testid="my-answer">
            {answerText(current, strings)}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="rsvp-name">{strings.nameLabel}</label>
            <input
              id="rsvp-name"
              type="text"
              value={name}
              maxLength={50}
              autoComplete="given-name"
              placeholder={strings.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        {emailUpdates && !current ? emailFields : null}
        {plusOnes ? (
          <PlusOnes value={plus} max={plusOnes.max} disabled={disabled} onChange={setPlus} strings={strings} />
        ) : null}
        <div className="choices">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className="btn"
              data-testid={`answer-${s}`}
              aria-pressed={s === 'going' ? wantsToGo : current?.status === s}
              disabled={disabled}
              onClick={() => send('POST', s)}
            >
              {s === 'going' && full && current?.status !== 'going' ? strings.fullJoinWaitlist : strings[s]}
            </button>
          ))}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="muted" role="status" data-testid="email-notice" style={{ margin: 0 }}>
            {notice}
          </p>
        ) : null}
        {current && emailUpdates ? (
          subscribed ? (
            <p className="muted" style={{ margin: 0 }} data-testid="email-status">
              {strings.emailOn.replace('{{email}}', current.email_updates?.masked ?? '')} ·{' '}
              <button
                type="button"
                className="link-btn"
                disabled={disabled}
                onClick={() => send('POST', currentAnswer, null)}
              >
                {strings.emailTurnOff}
              </button>
            </p>
          ) : showEmail ? (
            <>
              {emailFields}
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => send('POST', currentAnswer, 'form')}
              >
                {strings.emailSave}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="link-btn"
              disabled={disabled}
              onClick={() => setShowEmail(true)}
            >
              {strings.emailAdd}
            </button>
          )
        ) : null}
        {current ? (
          <button
            type="button"
            className="link-btn"
            disabled={disabled}
            onClick={() => send('DELETE')}
          >
            {strings.remove}
          </button>
        ) : null}
      </section>
      {current ? <PlanYourOwn strings={strings} /> : null}
    </>
  );
}
