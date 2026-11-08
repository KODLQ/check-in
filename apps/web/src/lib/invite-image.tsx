import 'server-only';

import { createHash } from 'node:crypto';

import { unstable_cache } from 'next/cache';
import { ImageResponse } from 'next/og';

import { STORY_SIZE, type StoryImageModel } from './invite-image-model';

export { themeBackground, storyImageModel, type StoryImageModel } from './invite-image-model';
export { coverUrl } from './supabase';

/** Short shared cache for invite images: revocation/cancellation/edits show up within a minute. */
export const IMAGE_CACHE_CONTROL = 'public, max-age=60, s-maxage=60, stale-while-revalidate=0';

const RENDER_CACHE_SECONDS = 7 * 24 * 3600;

/** Hash of everything the story image shows. Any edit changes it, so stale renders are never reused. */
export function storyContentKey(model: StoryImageModel): string {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex');
}

/** Supabase image transformation URL for an object URL (smaller cover → faster render). */
function resizedCoverUrl(url: string): string {
  const u = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  return `${u}?width=${STORY_SIZE.width}&height=${STORY_SIZE.height}&resize=cover`;
}

/** Fetches the cover as a data URI (resized when the storage supports it). Null → the theme is used. */
async function loadCover(url: string | null): Promise<string | null> {
  if (!url) return null;
  for (const candidate of [resizedCoverUrl(url), url]) {
    try {
      const res = await fetch(candidate, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('image/')) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const SCRIM_COLOR = 'rgb(10,10,14)';

function StoryLayout({ model, cover }: { model: StoryImageModel; cover: string | null }) {
  const { width, height } = STORY_SIZE;
  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        position: 'relative',
        background: cover ? SCRIM_COLOR : model.background,
        color: '#fff',
      }}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          width={width}
          height={Math.round(height * 0.62)}
          style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }}
        />
      ) : null}
      {/* Scrim from transparent over the cover/theme to near-black behind the text. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: Math.round(height * 0.3),
          bottom: 0,
          display: 'flex',
          background: 'linear-gradient(rgba(10,10,14,0), rgba(10,10,14,0.8) 30%, rgb(10,10,14) 44%)',
        }}
      />
      {/* Text block: kept clear of the top 250 px and bottom 340 px (story UI chrome). */}
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          bottom: 340,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -1,
            display: 'block',
            lineClamp: 3,
            wordBreak: 'break-word',
          }}
        >
          {model.title}
        </div>
        <div style={{ fontSize: 48, marginTop: 36, opacity: 0.95 }}>{model.when}</div>
        <div style={{ fontSize: 40, marginTop: 14, opacity: 0.8 }}>{model.hostLine}</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: 64 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 36,
              color: '#111114',
              background: '#ffffff',
              borderRadius: 999,
              padding: '14px 34px',
            }}
          >
            {model.cta}
          </div>
          <div style={{ fontSize: 50, marginTop: 22, letterSpacing: -0.5 }}>{model.url}</div>
        </div>
      </div>
    </div>
  );
}

async function renderStoryBase64(_key: string, model: StoryImageModel): Promise<string> {
  const cover = await loadCover(model.coverUrl);
  const res = new ImageResponse(<StoryLayout model={model} cover={cover} />, STORY_SIZE);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

/**
 * Renders (or reuses) the story PNG. Cached in the Next.js data cache by content key for up to 7 days.
 * Callers must check the invite is active first: the cache never decides availability.
 */
const cachedRender = unstable_cache(renderStoryBase64, ['invite-story-image-v1'], { revalidate: RENDER_CACHE_SECONDS });

export async function renderStoryPng(model: StoryImageModel): Promise<Uint8Array> {
  return Buffer.from(await cachedRender(storyContentKey(model), model), 'base64');
}
