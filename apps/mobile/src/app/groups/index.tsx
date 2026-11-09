import { groupNameSchema } from '@check-in/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Body, Button, Card, ErrorText, Field, Label, Spinner, useColors } from '@/components/ui';
import { errorKey } from '@/lib/events';
import type { GroupInvitation, GroupSummary } from '@/lib/groups';
import { supabase } from '@/lib/supabase';

/** The user's groups and pending group invitations (spec: groups "Groups list in the app"). */
export default function Groups() {
  const { t } = useTranslation();
  const c = useColors();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('list_my_groups');
    const result = (data as unknown as { groups: GroupSummary[]; invitations: GroupInvitation[] } | null) ?? {
      groups: [],
      invitations: [],
    };
    setGroups(result.groups);
    setInvitations(result.invitations);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function create() {
    const parsed = groupNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(t('errors.invalid_name'));
      return;
    }
    setError(null);
    setBusy('create');
    const { data, error: rpcError } = await supabase.rpc('create_group', { p_name: parsed.data });
    setBusy(null);
    if (rpcError || !data) {
      setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
      return;
    }
    setCreating(false);
    setName('');
    router.push(`/groups/${data as string}`);
  }

  async function respond(groupId: string, accept: boolean) {
    setBusy(groupId);
    const { error: rpcError } = await supabase.rpc('respond_group_invitation', { p_group_id: groupId, p_accept: accept });
    setBusy(null);
    if (rpcError) setError(t(`errors.${errorKey(rpcError)}`, t('common.error')));
    await load();
    if (!rpcError && accept) router.push(`/groups/${groupId}`);
  }

  if (!groups) return <Spinner style={{ flex: 1, backgroundColor: c.bg }} />;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          tintColor={c.accent}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {invitations.length > 0 ? (
        <View style={{ gap: 10 }} testID="group-invitations">
          <Label>{t('groups.invitations')}</Label>
          {invitations.map((inv) => (
            <Card key={inv.group_id}>
              <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>{inv.name}</Text>
              <Body muted>
                {t('groups.invited_by', { name: inv.invited_by_name ?? inv.owner_name ?? '', count: inv.member_count })}
              </Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    testID={`accept-${inv.group_id}`}
                    title={t('groups.accept')}
                    loading={busy === inv.group_id}
                    onPress={() => void respond(inv.group_id, true)}
                  />
                </View>
                <Button
                  testID={`decline-${inv.group_id}`}
                  variant="ghost"
                  title={t('groups.decline')}
                  onPress={() => void respond(inv.group_id, false)}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <Label>{t('groups.your_groups')}</Label>
      {groups.length === 0 ? (
        <View testID="groups-empty">
          <Body muted>{t('groups.empty')}</Body>
        </View>
      ) : (
        groups.map((g) => (
          <Pressable
            key={g.id}
            testID={`group-${g.id}`}
            accessibilityRole="button"
            onPress={() => router.push(`/groups/${g.id}`)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', flex: 1 }} numberOfLines={1}>
                  {g.name}
                </Text>
                {g.role !== 'member' ? (
                  <Text style={{ color: c.muted, fontWeight: '700' }}>
                    {g.role === 'owner' ? t('groups.yours') : t('groups.admin')}
                  </Text>
                ) : null}
                <Text style={{ color: c.muted, fontSize: 18 }}>›</Text>
              </View>
              <Body muted>{t('groups.members_count', { count: g.member_count })}</Body>
            </Card>
          </Pressable>
        ))
      )}

      {creating ? (
        <Card>
          <Field
            testID="group-name"
            label={t('groups.name_label')}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder={t('groups.name_placeholder')}
            maxLength={50}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void create()}
          />
          <Button testID="create-group" title={t('groups.create')} loading={busy === 'create'} onPress={() => void create()} />
          <Button variant="ghost" title={t('common.cancel')} onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button testID="new-group" variant="secondary" title={t('groups.new_group')} onPress={() => setCreating(true)} />
      )}
      <ErrorText testID="groups-error">{error}</ErrorText>
    </ScrollView>
  );
}
