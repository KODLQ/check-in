'use client';

import type { RsvpStatus } from '@check-in/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import type { ClientStrings } from '@/lib/i18n';
import type { MyRsvp } from '@/lib/invite';

const COOKIE = 'ci_guest';
const STORAGE_KEY = 'ci_guest';
const NAME_KEY = 'ci_name';
const STATUSES: RsvpStatus[] = ['going', 'maybe', 'declined'];

function readCookie(): string | null {
  const m = document.cookie.match(/(?:^|; )ci_guest=([^;]+)/);
  return m?.[1] ?? null;
}

function writeCookie(value: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Random 128-bit device token, base64url (22 chars). Only its hash is stored server-side. */
function newGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getGuestToken(): string {
  const existing = readCookie() ?? safeStorage()?.getItem(STORAGE_KEY);
  const token = existing ?? newGuestToken();
  writeCookie(token);
  safeStorage()?.setItem(STORAGE_KEY, token);
  return token;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function RsvpForm({
  token,
  current,
  strings,
  locale,
  emailUpdates,
}: {
  token: string;
  current: MyRsvp | null;
  strings: ClientStrings;
  locale: 'en' | 'sv';
  /** Email opt-in is offered (feature flag). */
  emailUpdates: boolean;
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
    const optIn = emailChange === 'form' || (emailChange === undefined && !current && emailUpdates && typed !== '');
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
        body: JSON.stringify({ token, guestToken: getGuestToken(), displayName: name, status, ...emailBody }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        email_updates?: { state: string };
      };
      if (!res.ok) {
        if (body.error === 'consent_required') setEmailError(strings.consentRequired);
        else if (body.error === 'invalid_email') setEmailError(strings.invalidEmail);
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
    <section className="card" aria-label="RSVP">
      {current ? (
        <p style={{ margin: 0 }} data-testid="my-answer">
          {strings.yourAnswer.replace('{{status}}', strings[current.status])}
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
      <div className="choices">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            aria-pressed={current?.status === s}
            disabled={disabled}
            onClick={() => send('POST', s)}
          >
            {strings[s]}
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
            <button type="button" className="link-btn" disabled={disabled} onClick={() => send('POST', current.status, null)}>
              {strings.emailTurnOff}
            </button>
          </p>
        ) : showEmail ? (
          <>
            {emailFields}
            <button type="button" className="btn" disabled={disabled} onClick={() => send('POST', current.status, 'form')}>
              {strings.emailSave}
            </button>
          </>
        ) : (
          <button type="button" className="link-btn" disabled={disabled} onClick={() => setShowEmail(true)}>
            {strings.emailAdd}
          </button>
        )
      ) : null}
      {current ? (
        <button type="button" className="link-btn" disabled={disabled} onClick={() => send('DELETE')}>
          {strings.remove}
        </button>
      ) : null}
    </section>
  );
}
