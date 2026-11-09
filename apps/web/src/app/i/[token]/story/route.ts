import { pickLocale, SUPPORTED_LOCALES, type Locale } from '@check-in/shared';
import type { NextRequest } from 'next/server';

import { env } from '@/lib/env';
import { getLocale } from '@/lib/i18n';
import { getInvite } from '@/lib/invite';
import { coverUrl, IMAGE_CACHE_CONTROL, renderStoryPng, storyImageModel } from '@/lib/invite-image';

/** Same response for unknown, revoked, deleted, cancelled and ended invites (spec: story image availability). */
const notFound = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

async function requestLocale(req: NextRequest): Promise<Locale> {
  const lang = req.nextUrl.searchParams.get('lang');
  if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) return pickLocale([lang]);
  return getLocale();
}

// Story image (1080×1920) for Instagram/Snapchat stories. The invite is looked up on every request so
// revocation and cancellation apply immediately; only the render itself is cached (by content key).
export async function GET(req: NextRequest, ctx: RouteContext<'/i/[token]/story'>) {
  const { token } = await ctx.params;
  const [invite, locale] = await Promise.all([getInvite(token), requestLocale(req)]);
  // A date poll is active too (add-date-polls): its image says "Date TBD — vote now".
  if (invite.state !== 'active' && invite.state !== 'date_pending') return notFound();

  const model = storyImageModel(invite, locale, token, { siteUrl: env.siteUrl, coverUrl });
  const png = await renderStoryPng(model);
  return new Response(png as Uint8Array<ArrayBuffer>, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.byteLength),
      'cache-control': IMAGE_CACHE_CONTROL,
      vary: 'Accept-Language',
      'x-robots-tag': 'noindex',
    },
  });
}
