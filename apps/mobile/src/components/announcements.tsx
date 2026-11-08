import { announcementInputSchema, ANNOUNCEMENT_MAX_LENGTH, fieldErrors, formatEventTime, formatRelativeTime } from '@check-in/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Body, Button, Card, ErrorText, Field, Label, useColors } from '@/components/ui';
import { locale as deviceLocale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export interface AnnouncementItem {
  id: string;
  body: string;
  created_at: string;
}

type RpcError = { message?: string; details?: string | null } | null;
export type PostAnnouncement = (eventId: string, body: string) => Promise<{ error: RpcError }>;

const defaultPost: PostAnnouncement = async (eventId, body) => {
  const { error } = await supabase.rpc('post_announcement', { p_event_id: eventId, p_body: body });
  return { error };
};

/** Maps a post_announcement error to a message; the limit error says when posting is possible again. */
export function announcementErrorMessage(
  error: RpcError,
  t: (key: string, vars?: Record<string, string>) => string,
  locale: string = deviceLocale,
): string {
  const msg = error?.message ?? '';
  if (msg.includes('announcement_limit')) {
    const next = error?.details ? new Date(error.details) : null;
    const when = next && !Number.isNaN(next.getTime()) ? formatEventTime(next, locale) : '';
    return t('errors.announcement_limit', { when });
  }
  if (msg.includes('invalid_body')) return t('errors.announcement_too_long');
  if (msg.includes('event_closed')) return t('errors.event_closed');
  return t('common.error');
}

export function AnnouncementComposer({
  eventId,
  onPosted,
  post = defaultPost,
}: {
  eventId: string;
  onPosted: () => void;
  post?: PostAnnouncement;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const length = body.trim().length;

  async function submit() {
    setError(null);
    const errs = fieldErrors(announcementInputSchema.safeParse({ body }));
    if (errs?.body) {
      setError(t(`errors.${errs.body}`));
      return;
    }
    setBusy(true);
    const { error: rpcError } = await post(eventId, body.trim());
    setBusy(false);
    if (rpcError) {
      setError(announcementErrorMessage(rpcError, t));
      return;
    }
    setBody('');
    onPosted();
  }

  return (
    <View style={{ gap: 8 }}>
      <Field
        testID="announcement-input"
        value={body}
        onChangeText={setBody}
        placeholder={t('announcements.placeholder')}
        multiline
        maxLength={ANNOUNCEMENT_MAX_LENGTH + 50}
      />
      <Text
        testID="announcement-counter"
        style={{ color: length > ANNOUNCEMENT_MAX_LENGTH ? c.danger : c.muted, textAlign: 'right', fontSize: 13 }}
      >
        {t('announcements.counter', { count: String(length) })}
      </Text>
      <ErrorText testID="announcement-error">{error}</ErrorText>
      <Button testID="announcement-post" title={t('announcements.post')} loading={busy} onPress={submit} />
    </View>
  );
}

export function AnnouncementList({
  items,
  onDelete,
}: {
  items: AnnouncementItem[];
  onDelete?: (item: AnnouncementItem) => void;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }} testID="announcement-list">
      {items.map((a) => (
        <View key={a.id} testID="announcement" style={{ backgroundColor: c.bg, borderRadius: 12, padding: 12, gap: 4 }}>
          <Body>{a.body}</Body>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>{formatRelativeTime(new Date(a.created_at), deviceLocale)}</Text>
            {onDelete ? (
              <Pressable hitSlop={8} accessibilityRole="button" testID={`announcement-delete-${a.id}`} onPress={() => onDelete(a)}>
                <Text style={{ color: c.muted }}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Card wrapper used on both the host screen and the in-app invite. */
export function AnnouncementsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Label>{title}</Label>
      {children}
    </Card>
  );
}
