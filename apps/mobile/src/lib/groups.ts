import type { RepeatFrequency } from '@check-in/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { INVITE_BASE_URL } from './config';
import { supabase } from './supabase';

/** add-groups-and-recurring-events: a group as list_my_groups / get_group return it. */
export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupSummary {
  id: string;
  name: string;
  role: GroupRole;
  member_count: number;
}

export interface GroupInvitation {
  group_id: string;
  name: string;
  owner_name: string | null;
  invited_by_name: string | null;
  member_count: number;
}

export interface GroupMember {
  user_id: string;
  display_name: string | null;
  role: GroupRole;
  joined_at: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string | null;
  my_role: GroupRole;
  members: GroupMember[];
  /** Only for the owner and admins. */
  link: string | null;
  pending_invitations: number | null;
}

export interface GroupSeries {
  id: string;
  title: string;
  frequency: RepeatFrequency;
  anchor_local_date: string;
  ends_on: string | null;
  next: { event_id: string; starts_at: string; cancelled: boolean } | null;
}

export type GroupLinkPreview =
  | { state: 'invalid' }
  | { state: 'valid'; group_id: string | null; name: string; owner_name: string | null; member_count: number; is_member: boolean };

export const isAdminRole = (role: GroupRole | null | undefined) => role === 'owner' || role === 'admin';

const GROUP_TOKEN = /^[A-Za-z0-9]{22}$/;
export const isValidGroupToken = (token: string | null | undefined): token is string => !!token && GROUP_TOKEN.test(token);

export function groupLinkUrl(token: string, base = INVITE_BASE_URL): string {
  return `${base.replace(/\/$/, '')}/g/${token}`;
}

/**
 * Who to suggest as the new owner when the owner leaves: the longest-standing admin, else the
 * longest-standing member (the same rule the server uses when an owner deletes their account).
 */
export function suggestedHeir(members: readonly GroupMember[]): GroupMember | null {
  const others = members.filter((m) => m.role !== 'owner');
  const byJoin = (a: GroupMember, b: GroupMember) => a.joined_at.localeCompare(b.joined_at);
  return [...others.filter((m) => m.role === 'admin')].sort(byJoin)[0] ?? [...others].sort(byJoin)[0] ?? null;
}

/** A group link opened while signed out or before onboarding; resumed from the home screen. */
export const PENDING_GROUP_KEY = 'ci_pending_group';
const PENDING_GROUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function savePendingGroupLink(token: string, now = Date.now()): Promise<boolean> {
  if (!isValidGroupToken(token)) return false;
  await AsyncStorage.setItem(PENDING_GROUP_KEY, JSON.stringify({ token, savedAt: now }));
  return true;
}

export async function consumePendingGroupLink(now = Date.now()): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_GROUP_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(PENDING_GROUP_KEY);
  try {
    const { token, savedAt } = JSON.parse(raw) as { token: string; savedAt: number };
    if (isValidGroupToken(token) && savedAt <= now && now - savedAt < PENDING_GROUP_MAX_AGE_MS) return token;
  } catch {
    // malformed: dropped
  }
  return null;
}

/** Groups the user owns or administers: the ones they can put a series in or invite to an event. */
export async function loadManagedGroups(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.rpc('list_my_groups');
  const groups = (data as unknown as { groups: GroupSummary[] } | null)?.groups ?? [];
  return groups.filter((g) => isAdminRole(g.role)).map((g) => ({ id: g.id, name: g.name }));
}
