'use client';

// Event wall on the invite page (change: add-event-wall, design §9). The first page is rendered on the server
// with signed photo URLs; this component adds posting, deleting, "load more" and the photo lightbox. After a
// post or delete it calls router.refresh(), which reloads the page with everyone's latest posts (no live
// connection on the web: spec "Web wall refresh").
//
// Text is rendered as React text (escaped, white-space: pre-wrap): no markup, no clickable links.
import {
  formatEventTime,
  formatRelativeTime,
  WALL_LIMITS,
  wallContentType,
  wallFilesPrecheck,
  wallTextLength,
  type WallFeed,
  type WallPost,
} from '@check-in/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { getGuestToken } from '@/lib/guest-device';
import type { WallStrings } from '@/lib/i18n';

type OkFeed = Extract<WallFeed, { state: 'ok' }>;

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp';

async function api<T>(method: string, url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? 'unknown' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}

function Composer({
  token,
  photosLeft,
  strings,
  onPosted,
}: {
  token: string;
  photosLeft: number | null;
  strings: WallStrings;
  onPosted: () => void;
}) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const length = wallTextLength(body);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function pick(list: FileList | null) {
    setError(null);
    const next = [...files, ...Array.from(list ?? [])];
    const problem = wallFilesPrecheck(next.map((f) => ({ size: f.size, type: wallContentType(f.name, f.type) ?? f.type })), photosLeft);
    if (problem) setError(strings.errors[problem] ?? strings.errors.unknown!);
    else setFiles(next);
    if (input.current) input.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (length === 0 && files.length === 0) return setError(strings.errors.empty_post!);
    if (length > WALL_LIMITS.bodyMax) return setError(strings.errors.body_too_long!);
    setBusy(true);
    const guestToken = getGuestToken();
    const uploadIds: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setProgress(strings.uploading.replace('{{done}}', String(i + 1)).replace('{{total}}', String(files.length)));
        const contentType = wallContentType(file.name, file.type);
        if (!contentType) return setError(strings.errors.unsupported_type!);
        const reserved = await api<{ uploadId: string; signedUploadUrl: string }>('POST', '/api/wall/uploads', {
          token, guestToken, contentType, size: file.size,
        });
        if (!reserved.ok) return setError(strings.errors[reserved.error] ?? strings.errors.unknown!);
        // Straight to the private quarantine bucket with the single-use URL (bypasses the 4.5 MB body limit).
        const put = await fetch(reserved.data.signedUploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: file }).catch(() => null);
        if (!put?.ok) return setError(strings.errors.invalid_upload!);
        const done = await api('POST', `/api/wall/uploads/${reserved.data.uploadId}/complete`, { token, guestToken });
        if (!done.ok) return setError(strings.errors[done.error] ?? strings.errors.unknown!);
        uploadIds.push(reserved.data.uploadId);
      }
      setProgress(null);
      const posted = await api('POST', '/api/wall/posts', { token, guestToken, body, uploadIds });
      if (!posted.ok) return setError(strings.errors[posted.error] ?? strings.errors.unknown!);
      setBody('');
      setFiles([]);
      onPosted();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form className="wall-composer" onSubmit={submit} data-testid="wall-composer">
      <textarea
        data-testid="wall-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={strings.placeholder}
        rows={3}
        aria-label={strings.placeholder}
      />
      {previews.length > 0 ? (
        <ul className="wall-previews">
          {previews.map((src, i) => (
            <li key={src}>
              {/* HEIC previews only render in Safari; the file name is the fallback. */}
              <img src={src} alt={files[i]?.name ?? ''} />
              <button type="button" className="link-btn" aria-label={strings.remove_photo} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="wall-composer-row">
        <label className="btn wall-photo-btn">
          {strings.add_photos}
          <input ref={input} type="file" accept={ACCEPT} multiple hidden data-testid="wall-file" onChange={(e) => pick(e.target.files)} disabled={busy} />
        </label>
        <span className={length > WALL_LIMITS.bodyMax ? 'error' : 'muted'} data-testid="wall-counter">
          {strings.counter.replace('{{count}}', String(length))}
        </span>
        <button type="submit" className="btn primary" disabled={busy} data-testid="wall-submit">
          {busy ? strings.posting : strings.post}
        </button>
      </div>
      {photosLeft !== null && photosLeft < WALL_LIMITS.photosPerGuest ? (
        <span className="muted small">
          {photosLeft === 1 ? strings.photosLeftOne : strings.photosLeft.replace('{{count}}', String(photosLeft))}
        </span>
      ) : null}
      {progress ? <p className="muted small" role="status">{progress}</p> : null}
      {error ? <p className="error" role="alert" data-testid="wall-error">{error}</p> : null}
    </form>
  );
}

export function Wall({
  token,
  initial,
  strings,
  locale,
  timeZone,
}: {
  token: string;
  initial: OkFeed;
  strings: WallStrings;
  locale: 'en' | 'sv';
  timeZone: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [older, setOlder] = useState<WallPost[]>([]);
  const [hasMore, setHasMore] = useState(initial.has_more);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ url: string; alt: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // A refresh brings a new first page: drop the pages loaded with "load more".
  useEffect(() => {
    setOlder([]);
    setHasMore(initial.has_more);
  }, [initial]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const posts = [...initial.posts, ...older.filter((o) => !initial.posts.some((p) => p.id === o.id))];
  const refresh = () => startTransition(() => router.refresh());

  async function loadMore() {
    const last = posts[posts.length - 1];
    if (!last) return;
    const q = new URLSearchParams({ token, before: last.created_at, beforeId: last.id });
    const res = await api<OkFeed>('GET', `/api/wall?${q}`);
    if (!res.ok) return setError(strings.errors[res.error] ?? strings.errors.unknown!);
    setOlder((o) => [...o, ...res.data.posts]);
    setHasMore(res.data.has_more);
  }

  async function remove(post: WallPost) {
    if (!window.confirm(strings.delete_confirm)) return;
    const res = await api('DELETE', `/api/wall/posts/${post.id}`, { token, guestToken: getGuestToken() });
    if (!res.ok) return setError(strings.errors[res.error] ?? strings.errors.unknown!);
    setOlder((o) => o.filter((p) => p.id !== post.id));
    refresh();
  }

  async function removeAll() {
    if (!window.confirm(strings.delete_all_confirm)) return;
    const res = await api('DELETE', '/api/wall/mine', { token, guestToken: getGuestToken() });
    if (!res.ok) return setError(strings.errors[res.error] ?? strings.errors.unknown!);
    setOlder((o) => o.filter((p) => !p.mine));
    refresh();
  }

  return (
    <section className="card wall" aria-label={strings.title} data-testid="wall" aria-busy={refreshing}>
      <strong>{strings.title}</strong>
      {initial.can_post === 'ok' ? (
        <Composer token={token} photosLeft={initial.photos_left} strings={strings} onPosted={refresh} />
      ) : (
        <p className="muted small" data-testid="wall-reason">{strings.reasons[initial.can_post]}</p>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}

      {posts.length === 0 ? <p className="muted small">{strings.empty}</p> : null}
      <ul className="wall-posts" data-testid="wall-posts">
        {posts.map((p) => (
          <li key={p.id} className="wall-post" data-testid="wall-post">
            <div className="wall-post-head">
              <span className="wall-author">
                {p.display_name}
                {p.is_host ? <span className="badge" data-testid="host-label"> · {strings.host_label}</span> : null}
              </span>
              <time dateTime={p.created_at} title={formatEventTime(new Date(p.created_at), locale, timeZone)}>
                {formatRelativeTime(new Date(p.created_at), locale)}
              </time>
            </div>
            {p.body ? <p className="wall-body" data-testid="wall-body">{p.body}</p> : null}
            {p.photos.length > 0 ? (
              <div className={`wall-photos n${p.photos.length}`}>
                {p.photos.map((ph) => (
                  <button
                    key={ph.id}
                    type="button"
                    className="wall-photo"
                    onClick={() => setOpen({ url: ph.full_url, alt: strings.photoAlt.replace('{{name}}', p.display_name) })}
                  >
                    <img
                      src={ph.thumb_url}
                      width={ph.width}
                      height={ph.height}
                      alt={strings.photoAlt.replace('{{name}}', p.display_name)}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      data-testid="wall-photo"
                    />
                  </button>
                ))}
              </div>
            ) : null}
            {p.mine ? (
              <button type="button" className="link-btn small" data-testid="wall-delete" onClick={() => void remove(p)}>
                {strings.delete}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button type="button" className="btn" onClick={() => void loadMore()} data-testid="wall-more">
          {strings.load_more}
        </button>
      ) : null}

      {initial.has_own_posts ? (
        <details className="wall-mine" data-testid="wall-mine">
          <summary>{strings.your_posts}</summary>
          <p className="muted small">{strings.device_note}</p>
          <button type="button" className="link-btn" data-testid="wall-delete-all" onClick={() => void removeAll()}>
            {strings.delete_all}
          </button>
        </details>
      ) : null}

      <dialog ref={dialog} className="wall-lightbox" onClose={() => setOpen(null)} onClick={() => setOpen(null)}>
        {open ? <img src={open.url} alt={open.alt} referrerPolicy="no-referrer" data-testid="wall-full" /> : null}
        <button type="button" className="btn" onClick={() => setOpen(null)}>{strings.close}</button>
      </dialog>
    </section>
  );
}
