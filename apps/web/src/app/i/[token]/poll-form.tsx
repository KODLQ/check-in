'use client';

import type { InvitePoll, MyVotes, VoteChoice } from '@check-in/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { getGuestToken, GUEST_NAME_KEY, readGuestCookie, safeStorage, writeGuestCookie } from '@/lib/guest-device';
import type { PollStrings } from '@/lib/i18n';

const CHOICES: VoteChoice[] = ['yes', 'if_needed', 'no'];

/** Errors after which the page must be reloaded: the poll changed (picked, closed, options edited). */
const STALE = new Set(['poll_closed', 'option_not_found', 'option_passed', 'event_closed']);

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), template);
}

/**
 * Date poll on the web invite page (change: add-date-polls): every option with its tallies and, when the
 * host shows the guest list, the Yes / If needed names; per-option Yes / If needed / No while voting is
 * open; one name for the whole ballot (shared with the RSVP form's stored name).
 */
export function PollForm({
  token,
  poll,
  labels,
  myVotes,
  strings,
}: {
  token: string;
  poll: InvitePoll;
  /** Option id -> formatted time, rendered on the server in the event's time zone. */
  labels: Record<string, string>;
  myVotes: MyVotes | null;
  strings: PollStrings;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, VoteChoice | undefined>>(myVotes?.votes ?? {});
  const [name, setName] = useState(myVotes?.display_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const disabled = busy || pending;
  const open = poll.voting_open;

  // Re-sync after a refresh (saved on another tab, or options edited by the host).
  useEffect(() => {
    setChoices(myVotes?.votes ?? {});
  }, [myVotes]);

  // In-app browsers sometimes drop cookies but keep localStorage: restore and re-render with the ballot.
  useEffect(() => {
    const stored = safeStorage()?.getItem('ci_guest');
    if (!readGuestCookie() && stored) {
      writeGuestCookie(stored);
      router.refresh();
    }
    if (!myVotes) setName((n) => n || safeStorage()?.getItem(GUEST_NAME_KEY) || '');
  }, [myVotes, router]);

  function toggle(optionId: string, choice: VoteChoice) {
    setChoices((c) => ({ ...c, [optionId]: c[optionId] === choice ? undefined : choice }));
  }

  async function send(method: 'POST' | 'DELETE') {
    setError(null);
    const votes = Object.entries(choices)
      .filter((e): e is [string, VoteChoice] => !!e[1])
      .map(([optionId, choice]) => ({ optionId, choice }));
    if (method === 'POST') {
      if (!name.trim()) return setError(strings.nameRequired);
      if (votes.length === 0) return setError(strings.noVotes);
    }
    setBusy(true);
    try {
      const res = await fetch('/api/votes', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, guestToken: getGuestToken(), displayName: name, votes }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const e = body.error ?? '';
        setError(
          e === 'poll_closed'
            ? strings.pollChanged
            : e === 'option_not_found'
              ? strings.optionsChanged
              : e === 'option_passed'
                ? strings.optionPassed
                : e === 'event_closed'
                  ? strings.eventClosed
                  : e === 'name_required'
                    ? strings.nameRequired
                    : e === 'no_votes'
                      ? strings.noVotes
                      : e === 'rate_limited'
                        ? strings.rateLimited
                        : strings.error,
        );
        // Picked, closed or edited meanwhile: show the current state (e.g. the picked date with RSVP).
        if (STALE.has(e)) startTransition(() => router.refresh());
        return;
      }
      if (method === 'POST') safeStorage()?.setItem(GUEST_NAME_KEY, name.trim());
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Poll" data-testid="poll">
      <ul className="poll-options">
        {poll.options.map((o, i) => {
          const live = open && !o.passed;
          return (
            <li key={o.id} className="poll-option" data-testid={`option-${i}`} data-passed={o.passed || undefined}>
              <div className="poll-option-head">
                <strong>{labels[o.id]}</strong>
                {o.passed ? <span className="muted"> · {strings.passed}</span> : null}
              </div>
              <span className="muted" data-testid={`tallies-${i}`}>
                {fill(strings.tallies, { yes: o.tallies.yes, if_needed: o.tallies.if_needed, no: o.tallies.no })}
              </span>
              {o.voters && o.voters.length > 0 ? (
                <ul className="guests" data-testid={`voters-${i}`}>
                  {o.voters.map((v, j) => (
                    <li key={j}>
                      {v.display_name}
                      {v.choice === 'if_needed' ? <span className="muted"> · {strings.ifNeeded}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {live ? (
                <div className="choices" role="group" aria-label={labels[o.id]}>
                  {CHOICES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="btn"
                      data-testid={`vote-${i}-${c}`}
                      aria-pressed={choices[o.id] === c}
                      disabled={disabled}
                      onClick={() => toggle(o.id, c)}
                    >
                      {c === 'yes' ? strings.yes : c === 'if_needed' ? strings.ifNeeded : strings.no}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {open ? (
        <>
          {myVotes ? (
            <p style={{ margin: 0 }} data-testid="my-votes">
              {fill(strings.yourVotes, { name: myVotes.display_name })}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="poll-name">{strings.nameLabel}</label>
              <input
                id="poll-name"
                type="text"
                value={name}
                maxLength={50}
                autoComplete="given-name"
                placeholder={strings.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <button type="button" className="btn primary" data-testid="save-votes" disabled={disabled} onClick={() => send('POST')}>
            {strings.saveVotes}
          </button>
        </>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {open && myVotes ? (
        <button type="button" className="link-btn" data-testid="remove-votes" disabled={disabled} onClick={() => send('DELETE')}>
          {strings.removeVotes}
        </button>
      ) : null}
    </section>
  );
}
