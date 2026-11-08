import 'server-only';

import { isValidCoHostToken } from '@check-in/shared';
import { cache } from 'react';

import { serviceClient } from './supabase';

/** What the /c/<token> landing page may show: the event title and the owner's name, nothing else. */
export type CoHostPreview =
  | { state: 'invalid' }
  | { state: 'valid'; event: { title: string }; owner: { display_name: string | null } };

/** Memoized per request so generateMetadata and the page share one call. Service role only. */
export const getCoHostPreview = cache(async (token: string): Promise<CoHostPreview> => {
  if (!isValidCoHostToken(token)) return { state: 'invalid' };
  const { data, error } = await serviceClient().rpc('get_co_host_invite_preview', { p_token: token });
  if (error || !data) return { state: 'invalid' };
  const preview = data as unknown as CoHostPreview;
  // Re-shape so nothing beyond title and owner name can ever reach the page.
  return preview.state === 'valid'
    ? { state: 'valid', event: { title: preview.event.title }, owner: { display_name: preview.owner.display_name } }
    : { state: 'invalid' };
});
