// Pure data for the invite images (no server-only imports, so it can be unit tested).
import { displayInviteUrl, formatEventTime, getTheme, translations, type Locale } from '@check-in/shared';

import type { Invite } from './invite';

export type ShownInvite = Extract<Invite, { state: 'active' | 'past' }>;

/** Longest title printed on the story image; longer titles end with an ellipsis (about three lines). */
export const STORY_TITLE_MAX = 48;

export const STORY_SIZE = { width: 1080, height: 1920 } as const;

/** Two-stop theme gradient used whenever there is no uploaded cover. */
export function themeBackground(themeId: string | null | undefined): string {
  const theme = getTheme(themeId);
  return `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]})`;
}

export function truncateTitle(title: string, max = STORY_TITLE_MAX): string {
  const chars = Array.from(title.trim());
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max - 1).join('');
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length >= max * 0.6 ? atWord : cut).trimEnd()}…`;
}

function hostedBy(locale: Locale, name: string): string {
  return translations[locale].invite.hosted_by.replace('{{name}}', name);
}

/**
 * Everything the story image shows, and nothing else. Privacy rule (spec: story image privacy):
 * only title, start time, host name, cover/theme, call to action and the invite URL ever leave here.
 */
export interface StoryImageModel {
  title: string;
  when: string;
  hostLine: string;
  coverUrl: string | null;
  background: string;
  cta: string;
  url: string;
}

export function storyImageModel(
  invite: ShownInvite,
  locale: Locale,
  token: string,
  urls: { siteUrl: string; coverUrl: (path: string | null) => string | null },
): StoryImageModel {
  const e = invite.event;
  return {
    title: truncateTitle(e.title),
    when: formatEventTime(new Date(e.starts_at), locale, e.time_zone),
    hostLine: hostedBy(locale, invite.host.display_name ?? ''),
    coverUrl: urls.coverUrl(e.cover_path),
    background: themeBackground(e.theme),
    cta: translations[locale].story.cta,
    url: displayInviteUrl(urls.siteUrl, token),
  };
}
