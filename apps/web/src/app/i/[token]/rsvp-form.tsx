'use client';

import type { RsvpStatus } from '@check-in/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import type { ClientStrings } from '@/lib/i18n';

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

export function RsvpForm({
  token,
  current,
  strings,
}: {
  token: string;
  current: { status: RsvpStatus; display_name: string } | null;
  strings: ClientStrings;
}) {
  const router = useRouter();
  const [name, setName] = useState(current?.display_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  // In-app browsers sometimes drop cookies but keep localStorage: restore and re-render.
  useEffect(() => {
    const stored = safeStorage()?.getItem(STORAGE_KEY);
    if (!readCookie() && stored) {
      writeCookie(stored);
      router.refresh();
    }
    if (!current) setName((n) => n || safeStorage()?.getItem(NAME_KEY) || '');
  }, [current, router]);

  async function send(method: 'POST' | 'DELETE', status?: RsvpStatus) {
    setError(null);
    if (method === 'POST' && !name.trim()) {
      setError(strings.nameRequired);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/rsvp', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, guestToken: getGuestToken(), displayName: name, status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
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
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;

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
      {current ? (
        <button type="button" className="link-btn" disabled={disabled} onClick={() => send('DELETE')}>
          {strings.remove}
        </button>
      ) : null}
    </section>
  );
}
