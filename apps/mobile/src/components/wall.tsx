// Event wall UI pieces for the app (change: add-event-wall): composer, post list and the moderation /
// withdraw choices. The screen (app/wall.tsx) wires them to the API and Realtime.
import { formatRelativeTime, WALL_LIMITS, wallFilesPrecheck, wallTextLength, type WallPost } from '@check-in/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Body, Button, ErrorText, Field, useColors } from '@/components/ui';
import { locale as deviceLocale } from '@/lib/i18n';
import { pickPhotos, wallErrorKey, type PickedPhoto } from '@/lib/wall';

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface WallAction {
  key: 'delete' | 'delete_all_by' | 'block';
  label: string;
  destructive: boolean;
}

/**
 * What can be done with a post: the author deletes their own; hosts and co-hosts delete any post, delete
 * everything by its author, and stop a guest from posting (never another host).
 */
export function postActions(post: Pick<WallPost, 'mine' | 'can_block' | 'display_name' | 'is_host'>, moderator: boolean, t: T): WallAction[] {
  const actions: WallAction[] = [];
  if (post.mine || moderator) actions.push({ key: 'delete', label: t('wall.delete_post'), destructive: true });
  if (moderator && !post.mine) {
    actions.push({ key: 'delete_all_by', label: t('wall.delete_all_by', { name: post.display_name }), destructive: true });
  }
  if (moderator && post.can_block) actions.push({ key: 'block', label: t('wall.block', { name: post.display_name }), destructive: false });
  return actions;
}

export interface WithdrawChoice {
  key: 'keep' | 'delete_posts';
  label: string;
}

/** Withdraw dialog options: posts are kept unless the guest picks the second option (spec: event-rsvp). */
export function withdrawChoices(hasOwnPosts: boolean, t: T): WithdrawChoice[] {
  const keep: WithdrawChoice = { key: 'keep', label: t('rsvp.remove') };
  return hasOwnPosts ? [keep, { key: 'delete_posts', label: t('wall.withdraw_delete_posts') }] : [keep];
}

export function WallComposer({
  photosLeft,
  onSubmit,
  pick = pickPhotos,
}: {
  photosLeft: number | null;
  onSubmit: (body: string, photos: PickedPhoto[], onProgress: (done: number, total: number) => void) => Promise<void>;
  pick?: (limit: number) => Promise<PickedPhoto[]>;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const length = wallTextLength(body);
  const room = Math.min(WALL_LIMITS.photosPerPost - photos.length, photosLeft === null ? Infinity : photosLeft - photos.length);

  async function addPhotos() {
    setError(null);
    const picked = await pick(Math.max(0, room));
    const next = [...photos, ...picked];
    const problem = wallFilesPrecheck(next.map((p) => ({ size: p.size, type: p.contentType })), photosLeft);
    if (problem) setError(t(`wall.errors.${problem}`));
    else setPhotos(next);
  }

  async function submit() {
    setError(null);
    if (length === 0 && photos.length === 0) return setError(t('wall.errors.empty_post'));
    if (length > WALL_LIMITS.bodyMax) return setError(t('wall.errors.body_too_long'));
    setBusy(true);
    try {
      await onSubmit(body.trim(), photos, (done, total) =>
        setProgress(done < total ? t('wall.uploading', { done: done + 1, total }) : null),
      );
      setBody('');
      setPhotos([]);
    } catch (e) {
      setError(t(wallErrorKey(e)));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <View style={{ gap: 8 }} testID="wall-composer">
      <Field
        testID="wall-input"
        value={body}
        onChangeText={setBody}
        placeholder={t('wall.placeholder')}
        multiline
        maxLength={WALL_LIMITS.bodyMax + 100}
      />
      {photos.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {photos.map((p, i) => (
            <Pressable
              key={p.uri}
              testID={`wall-photo-remove-${i}`}
              accessibilityLabel={t('wall.remove_photo')}
              onPress={() => setPhotos(photos.filter((_, j) => j !== i))}
            >
              <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable testID="wall-add-photos" accessibilityRole="button" onPress={() => void addPhotos()} disabled={busy || room <= 0}>
          <Text style={{ color: room > 0 ? c.accent : c.muted, fontWeight: '600', fontSize: 16 }}>{t('wall.add_photos')}</Text>
        </Pressable>
        <Text testID="wall-counter" style={{ color: length > WALL_LIMITS.bodyMax ? c.danger : c.muted, fontSize: 13 }}>
          {t('wall.counter', { count: length })}
        </Text>
      </View>
      {progress ? <Body muted>{progress}</Body> : null}
      <ErrorText testID="wall-error">{error}</ErrorText>
      <Button testID="wall-submit" title={busy ? t('wall.posting') : t('wall.post')} loading={busy} onPress={() => void submit()} />
    </View>
  );
}

export function WallPostItem({
  post,
  moderator,
  onAction,
  onOpenPhoto,
}: {
  post: WallPost;
  moderator: boolean;
  onAction: (post: WallPost, action: WallAction['key']) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const actions = postActions(post, moderator, t);
  return (
    <View testID="wall-post" style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: c.text, fontWeight: '700' }}>
          {post.display_name}
          {post.is_host ? <Text style={{ color: c.accent }}>{` · ${t('wall.host_label')}`}</Text> : null}
        </Text>
        <Text style={{ color: c.muted, fontSize: 13 }}>{formatRelativeTime(new Date(post.created_at), deviceLocale)}</Text>
      </View>
      {/* Plain text: never markup, never linkified. */}
      {post.body ? <Text testID="wall-body" style={{ color: c.text, fontSize: 16 }}>{post.body}</Text> : null}
      {post.photos.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {post.photos.map((ph) => (
            <Pressable key={ph.id} testID="wall-photo" onPress={() => onOpenPhoto(ph.full_url)} style={{ width: post.photos.length === 1 ? '100%' : '49%' }}>
              <Image
                source={{ uri: ph.thumb_url }}
                // The signed URL changes on every load; cache by photo id instead.
                recyclingKey={ph.id}
                style={{ width: '100%', aspectRatio: post.photos.length === 1 ? ph.width / ph.height : 1, borderRadius: 8 }}
                contentFit="cover"
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      {actions.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <Pressable key={a.key} testID={`wall-action-${a.key}`} accessibilityRole="button" onPress={() => onAction(post, a.key)} hitSlop={6}>
              <Text style={{ color: a.destructive ? c.danger : c.muted, fontSize: 14 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
