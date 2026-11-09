import 'server-only';

import { cache } from 'react';

import { serviceClient } from './supabase';

const GROUP_TOKEN = /^[A-Za-z0-9]{22}$/;

/** What the /g/<token> page may show (spec: groups "Join with the group link"): name, owner, member count. */
export type GroupLinkPreview =
  | { state: 'invalid' }
  | { state: 'valid'; name: string; owner_name: string | null; member_count: number };

/** Memoized per request so generateMetadata and the page share one call. */
export const getGroupLinkPreview = cache(async (token: string): Promise<GroupLinkPreview> => {
  if (!GROUP_TOKEN.test(token)) return { state: 'invalid' };
  const { data, error } = await serviceClient().rpc('get_group_link_preview', { p_token: token });
  if (error || !data) return { state: 'invalid' };
  const preview = data as unknown as GroupLinkPreview & { state: string };
  // Re-shape so nothing beyond the name, owner name and count can ever reach the page.
  return preview.state === 'valid'
    ? { state: 'valid', name: preview.name, owner_name: preview.owner_name, member_count: preview.member_count }
    : { state: 'invalid' };
});
