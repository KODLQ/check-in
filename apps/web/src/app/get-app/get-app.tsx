'use client';

import { CLAIM_TICKET_PATTERN } from '@check-in/shared';
import { useSyncExternalStore } from 'react';

type Strings = Record<
  'body' | 'openApp' | 'appStore' | 'playStore' | 'comeBack' | 'inAppBrowser' | 'desktop',
  string
>;

interface Client {
  ticket: string | null;
  mobile: boolean;
  inAppBrowser: boolean;
}

const SERVER: Client = { ticket: null, mobile: true, inAppBrowser: false };
let cached: { key: string; value: Client } | null = null;

/** Reads the ticket from the URL fragment (never sent to a server) and the device kind from the UA. */
function snapshot(): Client {
  const key = `${location.hash}|${navigator.userAgent}`;
  if (cached?.key === key) return cached.value;
  const t = new URLSearchParams(location.hash.slice(1)).get('t');
  const ua = navigator.userAgent;
  const value = {
    ticket: t && CLAIM_TICKET_PATTERN.test(t) ? t : null,
    mobile: /iPhone|iPad|iPod|Android/i.test(ua),
    inAppBrowser: /Instagram|FBAN|FBAV|Snapchat|TikTok|musical_ly|Bytedance/i.test(ua),
  };
  cached = { key, value };
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function GetApp({
  appStoreUrl,
  playStoreUrl,
  strings,
}: {
  appStoreUrl: string;
  playStoreUrl: string;
  strings: Strings;
}) {
  const { ticket, mobile, inAppBrowser } = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  // A custom-scheme URL never reaches a server, so the ticket may travel as a query parameter here.
  const openUrl = ticket ? `checkin://claim?t=${encodeURIComponent(ticket)}` : null;

  return (
    <>
      <p className="muted">{mobile ? strings.body : strings.desktop}</p>
      {mobile && openUrl ? (
        <>
          {inAppBrowser ? (
            <p className="card" role="note" data-testid="in-app-browser">
              {strings.inAppBrowser}
            </p>
          ) : null}
          <a
            className="btn primary"
            href={openUrl}
            data-testid="open-app"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
            }}
          >
            {strings.openApp}
          </a>
        </>
      ) : null}
      <div className="store-links">
        <a className="btn" href={appStoreUrl} rel="noreferrer" data-testid="app-store">
          {strings.appStore}
        </a>
        <a className="btn" href={playStoreUrl} rel="noreferrer" data-testid="play-store">
          {strings.playStore}
        </a>
      </div>
      {mobile && openUrl ? <p className="muted">{strings.comeBack}</p> : null}
    </>
  );
}
