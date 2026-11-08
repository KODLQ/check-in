import { formatEventTime } from '@check-in/shared';
import { ImageResponse } from 'next/og';

import { getLocale, makeT } from '@/lib/i18n';
import { getInvite, hostedByLine } from '@/lib/invite';
import { coverUrl, IMAGE_CACHE_CONTROL, themeBackground } from '@/lib/invite-image';

export const alt = 'Event invite';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const options = { ...size, headers: { 'cache-control': IMAGE_CACHE_CONTROL } };

// Preview card: cover, title, date and host. Never the address or guest list.
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, locale] = await Promise.all([getInvite(token), getLocale()]);
  const t = makeT(locale);

  if (invite.state !== 'active' && invite.state !== 'past') {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111114', color: '#fff', fontSize: 64, fontWeight: 800 }}>
          check-in
        </div>
      ),
      options,
    );
  }

  const e = invite.event;
  const cover = coverUrl(e.cover_path);
  const when = formatEventTime(new Date(e.starts_at), locale, e.time_zone);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: themeBackground(e.theme),
        }}
      >
        {cover ? (
          <img src={cover} alt="" width={1200} height={630} style={{ position: 'absolute', inset: 0, objectFit: 'cover' }} />
        ) : null}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '48px 64px',
            background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
            color: '#fff',
          }}
        >
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{e.title.slice(0, 60)}</div>
          <div style={{ fontSize: 38, marginTop: 16, opacity: 0.95 }}>
            {`${when} · ${hostedByLine(invite, locale, t)}`}
          </div>
        </div>
      </div>
    ),
    options,
  );
}
