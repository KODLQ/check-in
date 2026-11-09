import { formatHeads, headCount, headsOf, sortWaitlist, spotsLeft, type RsvpState } from '@check-in/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';

import { Body, Card, Label, useColors } from './ui';

/** The response fields the host guest list needs (a subset of the rsvps row). */
export interface GuestRow {
  id: string;
  display_name: string;
  status: RsvpState;
  plus_ones: number;
  waitlisted_at: string | null;
  /** Set for answers from an app account (add-groups-and-recurring-events: member vs outside guest). */
  user_id?: string | null;
}

const GROUPS: RsvpState[] = ['going', 'maybe', 'declined', 'waitlisted'];

/** "Going · 14 / 30", "Maybe · 3", "Waitlist · 4". Going and Waitlist count heads (spec: Host guest list). */
export function groupLabel(t: TFunction, status: RsvpState, rows: readonly GuestRow[], capacity: number | null): string {
  const n =
    status === 'going'
      ? formatHeads(headCount(rows), capacity)
      : status === 'waitlisted'
        ? String(headCount(rows, 'waitlisted'))
        : String(rows.filter((r) => r.status === status).length);
  return `${t(`rsvp.${status}`)} · ${n}`;
}

/**
 * Host guest list: Going, Maybe, Can't go and (when the event has a capacity or anyone waits) Waitlist,
 * in waitlist order with Promote. Removal and promotion are server-side RPCs passed in by the screen.
 */
export function GuestList({
  rsvps,
  capacity,
  editable,
  onRemove,
  onPromote,
  memberIds,
}: {
  /** For an event that invites a group: everyone else is marked as an outside guest. */
  memberIds?: ReadonlySet<string>;
  rsvps: readonly GuestRow[];
  capacity: number | null;
  editable: boolean;
  onRemove: (r: GuestRow) => void;
  onPromote: (r: GuestRow) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const waitlist = sortWaitlist(rsvps.filter((r) => r.status === 'waitlisted'));
  const groups = GROUPS.filter((s) => s !== 'waitlisted' || capacity != null || waitlist.length > 0);

  return (
    <>
      {groups.map((status) => {
        const group = status === 'waitlisted' ? waitlist : rsvps.filter((r) => r.status === status);
        return (
          <Card key={status}>
            <Label>
              <Text testID={`group-${status}`}>{groupLabel(t, status, rsvps, capacity)}</Text>
            </Label>
            {group.map((r, i) => (
              <Pressable key={r.id} onLongPress={() => onRemove(r)} testID={`guest-${r.display_name}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                  <View style={{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
                    {status === 'waitlisted' ? <Text style={{ color: c.muted }}>{i + 1}.</Text> : null}
                    <Body>{r.display_name}</Body>
                    {memberIds && !(r.user_id && memberIds.has(r.user_id)) ? (
                      <Text testID={`outside-${r.display_name}`} style={{ color: c.muted, fontSize: 13, fontWeight: '700' }}>
                        {t('groups.guest_badge')}
                      </Text>
                    ) : null}
                    {r.plus_ones > 0 ? (
                      <Text testID={`plus-${r.display_name}`} style={{ color: c.accent, fontWeight: '700' }}>
                        +{r.plus_ones}
                      </Text>
                    ) : null}
                  </View>
                  {status === 'waitlisted' && editable ? (
                    <Pressable
                      hitSlop={8}
                      testID={`promote-${r.display_name}`}
                      accessibilityRole="button"
                      onPress={() => onPromote(r)}
                    >
                      <Text style={{ color: c.accent, fontWeight: '700' }}>{t('events.promote')}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    hitSlop={8}
                    testID={`remove-${r.display_name}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('rsvp.remove_guest')}
                    onPress={() => onRemove(r)}
                  >
                    <Text style={{ color: c.muted }}>✕</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </Card>
        );
      })}
    </>
  );
}

type Rpc = (fn: 'promote_waitlisted', args: { p_rsvp_id: string; p_over_capacity?: boolean }) => PromiseLike<{
  error: { message?: string } | null;
}>;

/**
 * Promotes a waitlisted guest. If their party doesn't fit, the server answers `over_capacity` and the
 * host is asked to confirm going over capacity (spec: Host manages waitlist). Resolves to an error key or null.
 */
export async function promoteGuest(
  rpc: Rpc,
  t: TFunction,
  r: GuestRow,
  all: readonly GuestRow[],
  capacity: number | null,
): Promise<string | null> {
  const first = await rpc('promote_waitlisted', { p_rsvp_id: r.id });
  if (!first.error) return null;
  if (!first.error.message?.includes('over_capacity')) return first.error.message ?? 'unknown';
  const confirmed = await new Promise<boolean>((resolve) =>
    Alert.alert(
      t('events.promote_over_title'),
      t('events.promote_over_body', {
        name: r.display_name,
        needed: headsOf(r),
        left: spotsLeft(headCount(all), capacity) ?? 0,
      }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('events.promote_anyway'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
  if (!confirmed) return null;
  const second = await rpc('promote_waitlisted', { p_rsvp_id: r.id, p_over_capacity: true });
  return second.error ? (second.error.message ?? 'unknown') : null;
}
