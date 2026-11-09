import type { WallFeed, WallPost } from '@check-in/shared';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Body, Button, Card, ErrorText, Label, Screen, Title, useColors } from '@/components/ui';
import { WallComposer, WallPostItem, type WallAction } from '@/components/wall';
import { supabase } from '@/lib/supabase';
import { wallApi, wallErrorKey, type WallApi, type WallTarget } from '@/lib/wall';

type OkFeed = Extract<WallFeed, { state: 'ok' }>;

/** Debounce for Realtime-triggered refetches (signed URLs must come from the server anyway). */
const REFETCH_DEBOUNCE_MS = 1000;

/**
 * The event wall (add-event-wall). Opened as /wall?eventId=… (host, co-host, guest with an RSVP) or
 * /wall?token=… (signed-in user who opened an invite link). Hosts and co-hosts get live updates through
 * Realtime on wall_posts (RLS: managers only); everyone refreshes on focus, pull-to-refresh and own actions.
 */
export default function WallScreen({ api = wallApi }: { api?: WallApi }) {
  const { t } = useTranslation();
  const c = useColors();
  const params = useLocalSearchParams<{ eventId?: string; token?: string; title?: string }>();
  const target = useMemo<WallTarget>(
    () => (params.eventId ? { eventId: params.eventId } : { token: params.token ?? '' }),
    [params.eventId, params.token],
  );
  const [feed, setFeed] = useState<WallFeed | null>(null);
  const [older, setOlder] = useState<WallPost[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.feed(target);
      setFeed(next);
      setOlder([]);
      setHasMore(next.state === 'ok' && next.has_more);
    } catch (e) {
      setError(t(wallErrorKey(e)));
    }
  }, [api, target, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Live wall for hosts and co-hosts. Inserts are filtered by event; deletes can't be filtered (Realtime
  // sends only the old primary key), so any delete of a post we show triggers a refetch.
  const moderator = feed?.state === 'ok' && feed.moderator;
  const eventId = params.eventId;
  const shownIds = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!moderator || !eventId) return;
    const refetch = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), REFETCH_DEBOUNCE_MS);
    };
    const channel = supabase
      .channel(`wall:${eventId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wall_posts', filter: `event_id=eq.${eventId}` }, refetch)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wall_posts' }, (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (!id || shownIds.current.has(id)) refetch();
      })
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [moderator, eventId, load]);

  const ok = feed?.state === 'ok' ? (feed as OkFeed) : null;
  const posts = ok ? [...ok.posts, ...older.filter((o) => !ok.posts.some((p) => p.id === o.id))] : [];
  shownIds.current = new Set(posts.map((p) => p.id));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function loadMore() {
    const last = posts[posts.length - 1];
    if (!last) return;
    try {
      const next = await api.feed(target, { before: last.created_at, beforeId: last.id });
      if (next.state === 'ok') {
        setOlder((o) => [...o, ...next.posts]);
        setHasMore(next.has_more);
      }
    } catch (e) {
      setError(t(wallErrorKey(e)));
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(t(wallErrorKey(e)));
    }
    await load();
  }

  function onAction(post: WallPost, action: WallAction['key']) {
    const eventIdForModeration = params.eventId;
    if (action === 'delete') {
      Alert.alert(t('wall.delete_confirm'), t('wall.delete_confirm_body'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => api.deletePost(target, post.id)) },
      ]);
    } else if (action === 'delete_all_by') {
      Alert.alert(t('wall.delete_all_by_confirm', { name: post.display_name }), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => api.deletePost(target, post.id, true)) },
      ]);
    } else if (action === 'block' && eventIdForModeration) {
      void run(() => api.block(eventIdForModeration, post.id));
    }
  }

  function deleteAllMine() {
    Alert.alert(t('wall.delete_all'), t('wall.delete_all_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => api.deleteMine(target)) },
    ]);
  }

  if (!feed) {
    return (
      <Screen style={{ justifyContent: 'center' }}>
        <Stack.Screen options={{ title: t('wall.title') }} />
        <ActivityIndicator />
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  if (!ok) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('wall.title') }} />
        <Title>{t('wall.title')}</Title>
        <Body muted>{feed.state === 'disabled' ? t('wall.reason.disabled') : t('wall.errors.not_found')}</Body>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: params.title ? `${t('wall.title')} · ${params.title}` : t('wall.title') }} />
      <ScrollView
        testID="wall-screen"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {ok.moderator && !ok.wall_enabled ? <Body muted>{t('wall.off_host')}</Body> : null}
        {ok.can_post === 'ok' ? (
          <Card>
            <WallComposer
              photosLeft={ok.photos_left}
              onSubmit={async (body, photos, onProgress) => {
                await api.post(target, body, photos, onProgress);
                await load();
              }}
            />
          </Card>
        ) : (
          <Body muted>{t(`wall.reason.${ok.can_post}`)}</Body>
        )}
        <ErrorText testID="wall-screen-error">{error}</ErrorText>

        {posts.length === 0 ? <Body muted>{t('wall.empty')}</Body> : null}
        {posts.map((p) => (
          <WallPostItem key={p.id} post={p} moderator={ok.moderator} onAction={onAction} onOpenPhoto={setPhoto} />
        ))}
        {hasMore ? <Button variant="secondary" title={t('wall.load_more')} onPress={() => void loadMore()} /> : null}

        {ok.has_own_posts ? (
          <Button testID="wall-delete-mine" variant="ghost" title={t('wall.delete_all')} onPress={deleteAllMine} />
        ) : null}

        {ok.moderator && ok.blocks && ok.blocks.length > 0 && params.eventId ? (
          <Card>
            <Label>{t('wall.blocked_list')}</Label>
            {ok.blocks.map((b) => (
              <View key={b.id} testID="wall-blocked" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Body>{b.display_name}</Body>
                <Pressable testID={`wall-unblock-${b.id}`} onPress={() => void run(() => api.unblock(params.eventId!, b.id))} hitSlop={8}>
                  <Text style={{ color: c.accent, fontWeight: '600' }}>{t('wall.unblock')}</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <Pressable testID="wall-lightbox" onPress={() => setPhoto(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}>
          {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
          <Text style={{ color: '#fff', textAlign: 'center', marginTop: 12, fontSize: 16 }}>{t('wall.close')}</Text>
        </Pressable>
      </Modal>
    </>
  );
}
