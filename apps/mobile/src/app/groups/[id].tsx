import { formatEventTime, formatRepeatRule, groupNameSchema } from '@check-in/shared';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { Toast } from '@/components/toast';
import { Body, Button, Card, ErrorText, Field, Label, Spinner, useColors } from '@/components/ui';
import { showActionSheet } from '@/lib/action-sheet';
import { useAuth } from '@/lib/auth';
import { errorKey } from '@/lib/events';
import {
  groupLinkUrl,
  isAdminRole,
  suggestedHeir,
  type GroupDetail,
  type GroupMember,
  type GroupSeries,
} from '@/lib/groups';
import { locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

interface PastGuest {
  user_id: string;
  display_name: string;
}

/** One group: members, link, past-guest invitations, repeating events, and owner/admin actions (spec: groups). */
export default function GroupScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id;
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [series, setSeries] = useState<GroupSeries[]>([]);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  const [pastGuests, setPastGuests] = useState<PastGuest[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [handingOver, setHandingOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([
      supabase.rpc('get_group', { p_group_id: id }),
      supabase.rpc('list_group_series', { p_group_id: id }),
    ]);
    if (g.error || !g.data) {
      setGone(true);
      return;
    }
    setGroup(g.data as unknown as GroupDetail);
    setSeries((s.data as unknown as GroupSeries[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const fail = (e: { message?: string } | null) => setError(t(`errors.${errorKey(e)}`, t('common.error')));

  async function run(key: string, fn: string, args: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setBusy(key);
    const { error: rpcError } = await supabase.rpc(fn as never, args as never);
    setBusy(null);
    if (rpcError) {
      fail(rpcError);
      return false;
    }
    return true;
  }

  if (gone) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 12, justifyContent: 'center' }}>
        <Body>{t('groups.invalid_body')}</Body>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.replace('/groups')} />
      </View>
    );
  }
  if (!group) return <Spinner style={{ flex: 1, backgroundColor: c.bg }} />;

  const admin = isAdminRole(group.my_role);
  const owner = group.my_role === 'owner';

  async function shareLink() {
    let token = group!.link;
    if (!token) {
      const { data, error: rpcError } = await supabase.rpc('create_group_link', { p_group_id: id });
      if (rpcError || !data) return fail(rpcError);
      token = data as string;
      await load();
    }
    const url = groupLinkUrl(token);
    await Share.share({ message: t('groups.share_message', { group: group!.name, url }), url });
  }

  function revokeLink() {
    Alert.alert(t('groups.revoke_confirm_title'), t('groups.revoke_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.revoke_link'),
        style: 'destructive',
        onPress: async () => {
          if (await run('revoke', 'revoke_group_link', { p_group_id: id })) await load();
        },
      },
    ]);
  }

  async function openPastGuests() {
    const { data, error: rpcError } = await supabase.rpc('invitable_past_guests', { p_group_id: id });
    if (rpcError) return fail(rpcError);
    setPicked(new Set());
    setPastGuests((data as unknown as PastGuest[] | null) ?? []);
  }

  async function invitePicked() {
    const ids = [...picked];
    if (await run('invite', 'invite_to_group', { p_group_id: id, p_user_ids: ids })) {
      setPastGuests(null);
      setToast(t('groups.invited_toast'));
      await load();
    }
  }

  async function memberActions(m: GroupMember) {
    // Admins act on regular members; only the owner demotes or removes admins. Nobody acts on the owner.
    if (!admin || m.role === 'owner' || m.user_id === me) return;
    const options: { label: string; destructive?: boolean; run: () => Promise<unknown> }[] = [];
    if (m.role === 'member') {
      options.push({ label: t('groups.make_admin'), run: () => run('member', 'set_group_admin', { p_group_id: id, p_user_id: m.user_id, p_admin: true }) });
    }
    if (m.role === 'admin' && owner) {
      options.push({ label: t('groups.remove_admin'), run: () => run('member', 'set_group_admin', { p_group_id: id, p_user_id: m.user_id, p_admin: false }) });
    }
    if (m.role === 'member' || owner) {
      options.push({
        label: t('groups.remove_member'),
        destructive: true,
        run: () =>
          new Promise<void>((resolve) =>
            Alert.alert(t('groups.remove_confirm', { name: m.display_name ?? '', group: group!.name }), undefined, [
              { text: t('common.cancel'), style: 'cancel', onPress: () => resolve() },
              {
                text: t('groups.remove_member'),
                style: 'destructive',
                onPress: () => void run('member', 'remove_group_member', { p_group_id: id, p_user_id: m.user_id }).then(() => resolve()),
              },
            ]),
          ),
      });
    }
    if (options.length === 0) return;
    const index = await showActionSheet(options, { title: m.display_name ?? '', cancelLabel: t('common.cancel') });
    if (index === null) return;
    await options[index]!.run();
    await load();
  }

  function leave() {
    if (owner) {
      if (group!.members.length === 1) {
        Alert.alert(t('groups.only_member'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('groups.delete'), style: 'destructive', onPress: confirmDelete },
        ]);
      } else {
        setHandingOver(true);
      }
      return;
    }
    Alert.alert(t('groups.leave_confirm_title', { group: group!.name }), t('groups.leave_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.leave'),
        style: 'destructive',
        onPress: async () => {
          if (await run('leave', 'leave_group', { p_group_id: id })) router.replace('/groups');
        },
      },
    ]);
  }

  function handOver(m: GroupMember) {
    Alert.alert(t('groups.hand_over_confirm', { name: m.display_name ?? '' }), t('groups.hand_over_body', { group: group!.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.hand_over_confirm', { name: m.display_name ?? '' }),
        style: 'destructive',
        onPress: async () => {
          if (await run('hand_over', 'hand_over_and_leave_group', { p_group_id: id, p_new_owner: m.user_id })) {
            router.replace('/groups');
          }
        },
      },
    ]);
  }

  function confirmDelete() {
    Alert.alert(t('groups.delete_confirm_title', { group: group!.name }), t('groups.delete_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.delete'),
        style: 'destructive',
        onPress: async () => {
          if (await run('delete', 'delete_group', { p_group_id: id })) router.replace('/groups');
        },
      },
    ]);
  }

  async function saveName() {
    const parsed = groupNameSchema.safeParse(renaming ?? '');
    if (!parsed.success) return setError(t('errors.invalid_name'));
    if (await run('rename', 'rename_group', { p_group_id: id, p_name: parsed.data })) {
      setRenaming(null);
      await load();
    }
  }

  const heir = suggestedHeir(group.members);
  const roleLabel = (m: GroupMember) =>
    m.role === 'owner' ? t('groups.owner') : m.role === 'admin' ? t('groups.admin') : null;

  return (
    <>
      <Stack.Screen options={{ title: group.name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {renaming !== null ? (
          <Card>
            <Field testID="rename-field" label={t('groups.rename_title')} value={renaming} onChangeText={setRenaming} maxLength={50} autoFocus />
            <Button testID="save-name" title={t('groups.save_name')} loading={busy === 'rename'} onPress={() => void saveName()} />
            <Button variant="ghost" title={t('common.cancel')} onPress={() => setRenaming(null)} />
          </Card>
        ) : (
          <View style={{ gap: 4 }}>
            <Text testID="group-title" style={{ fontSize: 28, fontWeight: '800', color: c.text }}>
              {group.name}
            </Text>
            <Body muted>{t('groups.members_count', { count: group.members.length })}</Body>
          </View>
        )}

        {admin ? (
          <View style={{ gap: 10 }}>
            <Button testID="share-group-link" title={group.link ? t('groups.share_link') : t('groups.invite_link')} onPress={() => void shareLink()} />
            {group.link ? (
              <Text selectable testID="group-link" style={{ color: c.muted, textAlign: 'center' }}>
                {groupLinkUrl(group.link)}
              </Text>
            ) : null}
            <Button testID="add-past-guests" variant="secondary" title={t('groups.add_past_guests')} onPress={() => void openPastGuests()} />
          </View>
        ) : null}

        {pastGuests ? (
          <Card>
            <Label>{t('groups.add_past_guests')}</Label>
            <Body muted>{pastGuests.length ? t('groups.past_guests_hint') : t('groups.past_guests_empty')}</Body>
            {pastGuests.map((g) => {
              const on = picked.has(g.user_id);
              return (
                <Pressable
                  key={g.user_id}
                  testID={`past-guest-${g.display_name}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(g.user_id);
                      else next.add(g.user_id);
                      return next;
                    })
                  }
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
                >
                  <Text style={{ fontSize: 18, color: on ? c.accent : c.muted }}>{on ? '☑︎' : '☐'}</Text>
                  <Body>{g.display_name}</Body>
                </Pressable>
              );
            })}
            {picked.size > 0 ? (
              <Button
                testID="invite-picked"
                title={t('groups.invite_selected', { count: picked.size })}
                loading={busy === 'invite'}
                onPress={() => void invitePicked()}
              />
            ) : null}
            <Button variant="ghost" title={t('common.cancel')} onPress={() => setPastGuests(null)} />
          </Card>
        ) : null}

        <Card>
          <Label>{t('groups.series_title')}</Label>
          {series.length === 0 ? <Body muted>{t('groups.no_series')}</Body> : null}
          {series.map((s) => (
            <Pressable
              key={s.id}
              testID={`series-${s.id}`}
              accessibilityRole="button"
              disabled={!s.next}
              onPress={() => s.next && router.push(admin ? `/events/${s.next.event_id}` : `/invites/${s.next.event_id}`)}
              style={{ paddingVertical: 6, gap: 2 }}
            >
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{s.title}</Text>
              <Body muted>
                {formatRepeatRule(s.frequency, s.anchor_local_date, locale)}
                {s.next ? ` · ${t('series.next_date')}: ${formatEventTime(new Date(s.next.starts_at), locale)}` : ''}
              </Body>
            </Pressable>
          ))}
          {admin ? (
            <Button
              testID="new-series"
              variant="secondary"
              title={t('groups.new_series')}
              onPress={() => router.push({ pathname: '/events/new', params: { groupId: id } })}
            />
          ) : null}
        </Card>

        {handingOver ? (
          <Card>
            <Label>{t('groups.hand_over_title')}</Label>
            <Body muted>{t('groups.hand_over_body', { group: group.name })}</Body>
            {[...group.members]
              .filter((m) => m.role !== 'owner')
              .sort((a, b) => (a.user_id === heir?.user_id ? -1 : b.user_id === heir?.user_id ? 1 : 0))
              .map((m) => (
                <Pressable
                  key={m.user_id}
                  testID={`heir-${m.display_name}`}
                  accessibilityRole="button"
                  onPress={() => handOver(m)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}
                >
                  <Body>{m.display_name}</Body>
                  {roleLabel(m) ? <Text style={{ color: c.muted }}>{roleLabel(m)}</Text> : null}
                  {m.user_id === heir?.user_id ? (
                    <Text style={{ color: c.accent, fontWeight: '700' }}>{t('groups.suggested')}</Text>
                  ) : null}
                </Pressable>
              ))}
            <Button variant="ghost" title={t('common.cancel')} onPress={() => setHandingOver(false)} />
          </Card>
        ) : null}

        <Card>
          <Label>{t('groups.members')}</Label>
          {group.members.map((m) => (
            <Pressable
              key={m.user_id}
              testID={`member-${m.display_name}`}
              accessibilityRole={admin && m.role !== 'owner' && m.user_id !== me ? 'button' : undefined}
              onPress={() => void memberActions(m)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}
            >
              <View style={{ flex: 1 }}>
                <Body>{m.user_id === me ? t('groups.you', { name: m.display_name ?? '' }) : m.display_name}</Body>
              </View>
              {roleLabel(m) ? (
                <Text testID={`role-${m.display_name}`} style={{ color: c.muted, fontWeight: '700' }}>
                  {roleLabel(m)}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </Card>

        <ErrorText testID="group-error">{error}</ErrorText>

        <View style={{ gap: 10 }}>
          {admin && group.link ? (
            <Button testID="revoke-group-link" variant="secondary" title={t('groups.revoke_link')} onPress={revokeLink} />
          ) : null}
          {admin ? (
            <Button testID="rename-group" variant="secondary" title={t('groups.rename')} onPress={() => setRenaming(group.name)} />
          ) : null}
          <Button testID="leave-group" variant="ghost" title={t('groups.leave')} onPress={leave} />
          {owner ? <Button testID="delete-group" variant="danger" title={t('groups.delete')} onPress={confirmDelete} /> : null}
        </View>
      </ScrollView>
      <Toast message={toast} onHide={hideToast} topOffset={64} />
    </>
  );
}
