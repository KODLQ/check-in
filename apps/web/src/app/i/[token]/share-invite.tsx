'use client';

import { useRef, useState } from 'react';

export interface ShareStrings {
  share: string;
  saveImage: string;
  copyLink: string;
  copied: string;
  shareText: string;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/**
 * Guest "Share" for an active invite: shares the story image + link through the browser share sheet when
 * it can share files, otherwise offers "Save image" and "Copy link". The image is fetched on tap only,
 * to keep the page light in chat apps' in-app browsers.
 */
export function ShareInvite({ token, url, strings }: { token: string; url: string; strings: ShareStrings }) {
  const storyPath = `/i/${token}/story`;
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function share() {
    setBusy(true);
    try {
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        const res = await fetch(storyPath);
        if (!res.ok) throw new Error(`story ${res.status}`);
        const file = new File([await res.blob()], 'invite.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], text: strings.shareText, url });
          } catch (e) {
            // Some browsers reject files together with a url: put the link in the text instead.
            if (!(e instanceof TypeError)) throw e;
            await navigator.share({ files: [file], text: `${strings.shareText} ${url}` });
          }
          return;
        }
      }
      setFallback(true);
    } catch (e) {
      if (!isAbort(e)) setFallback(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // No async clipboard (older in-app browsers): select the text and use the legacy copy command.
      inputRef.current?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
  }

  return (
    <section className="card share" data-testid="share-invite">
      <button type="button" className="btn primary" onClick={share} disabled={busy}>
        {strings.share}
      </button>
      {fallback ? (
        <div className="share-fallback" data-testid="share-fallback">
          <a className="btn" href={storyPath} download="invite.png">
            {strings.saveImage}
          </a>
          <button type="button" className="btn" onClick={copy}>
            {strings.copyLink}
          </button>
          <input ref={inputRef} readOnly value={url} aria-label={strings.copyLink} onFocus={(e) => e.currentTarget.select()} />
          {copied ? (
            <p className="muted" role="status" style={{ margin: 0 }}>
              {strings.copied}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
