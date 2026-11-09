import type { RsvpState, RsvpStatus } from '@check-in/shared';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { errorKey } from '@/lib/events';
import { Body, Button, Stepper, useColors } from './ui';

const STATUSES: RsvpStatus[] = ['going', 'maybe', 'declined'];

/** The parts of an invite payload (get_invite / get_my_invite) the RSVP controls use. */
export interface RsvpInvite {
  event?: { allow_plus_ones?: boolean; max_plus_ones?: number; capacity?: number | null };
  counts?: { going: number; maybe: number; waitlist?: number; spots_left?: number | null; full?: boolean };
  my_rsvp?: {
    status: RsvpState;
    plus_ones?: number;
    waitlist_position?: number | null;
    promoted?: boolean;
  } | null;
}

/** "Your answer: Going +2" / "You're on the waitlist — #3". */
export function answerLine(t: TFunction, my: NonNullable<RsvpInvite['my_rsvp']>): string {
  if (my.status === 'waitlisted') return t('rsvp.waitlist_position', { position: my.waitlist_position ?? '' });
  const label =
    my.status === 'going' && (my.plus_ones ?? 0) > 0
      ? t('rsvp.going_plus', { count: my.plus_ones })
      : t(`rsvp.${my.status}`);
  return t('rsvp.your_answer', { status: label });
}

/** Error text for an RSVP RPC error, with the spots left / maximum the server sends in `details`. */
export function rsvpErrorText(t: TFunction, error: { message?: string; details?: string | null }, maxPlusOnes?: number) {
  const key = errorKey(error);
  const n = error.details && /^\d+$/.test(error.details) ? Number(error.details) : undefined;
  if (key === 'capacity_exceeded')
    return n === 1 ? t('errors.capacity_exceeded_one') : t('errors.capacity_exceeded', { count: n ?? 0 });
  if (key === 'too_many_plus_ones') return t('errors.too_many_plus_ones', { max: n ?? maxPlusOnes ?? 0 });
  return t(`errors.${key}`, t('common.error'));
}

/**
 * Going / Maybe / Can't go with the plus-one stepper and waitlist states, shared by the in-app invite
 * (rsvp_as_user) and My invites (set_my_rsvp). Going reads "Full — join waitlist" on a full event.
 */
export function RsvpControls({
  invite,
  busy,
  onRespond,
}: {
  invite: RsvpInvite;
  busy?: boolean;
  /** plusOnes is only sent with Going. */
  onRespond: (status: RsvpStatus, plusOnes?: number) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const my = invite.my_rsvp ?? null;
  const wantsToGo = my?.status === 'going' || my?.status === 'waitlisted';
  const allow = !!invite.event?.allow_plus_ones;
  const max = invite.event?.max_plus_ones ?? 1;
  const [plus, setPlus] = useState(wantsToGo ? (my?.plus_ones ?? 0) : 0);
  useEffect(() => {
    if (wantsToGo) setPlus(my?.plus_ones ?? 0);
  }, [wantsToGo, my?.plus_ones]);
  // The stepper never offers more than the current maximum, but keeps a higher count the guest already has.
  const stepperMax = Math.max(max, wantsToGo ? (my?.plus_ones ?? 0) : 0);

  return (
    <View style={{ gap: 12 }}>
      {my?.promoted && my.status === 'going' ? (
        <Text testID="got-a-spot" style={{ color: c.accent, fontSize: 18, fontWeight: '800' }}>
          {t('rsvp.got_a_spot')}
        </Text>
      ) : null}
      {my ? (
        <Text testID="my-answer" style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
          {answerLine(t, my)}
        </Text>
      ) : null}
      {allow ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Body>{t('rsvp.plus_ones_label')}</Body>
            <Text style={{ color: c.muted, fontSize: 13 }}>{t('rsvp.plus_ones_hint', { max })}</Text>
          </View>
          <Stepper
            testID="plus-ones"
            value={plus}
            min={0}
            max={stepperMax}
            onChange={setPlus}
            disabled={busy}
            decreaseLabel={t('rsvp.plus_ones_decrease')}
            increaseLabel={t('rsvp.plus_ones_increase')}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {STATUSES.map((s) => (
          <View key={s} style={{ flex: s === 'going' ? 1.4 : 1 }}>
            <Button
              testID={`answer-${s}`}
              variant={(s === 'going' ? wantsToGo : my?.status === s) ? 'primary' : 'secondary'}
              title={
                s === 'going' && invite.counts?.full && my?.status !== 'going'
                  ? t('rsvp.full_join_waitlist')
                  : t(`rsvp.${s}`)
              }
              disabled={busy}
              onPress={() => onRespond(s, s === 'going' && allow ? plus : undefined)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** "5 people going · 2 spots left · 3 on the waitlist" (heads). */
export function CountsLine({ counts }: { counts?: RsvpInvite['counts'] }) {
  const { t } = useTranslation();
  const c = useColors();
  if (!counts) return null;
  const parts = [counts.going === 1 ? t('rsvp.people_going_one') : t('rsvp.people_going', { count: counts.going })];
  if (counts.full) parts.push(t('rsvp.full'));
  else if (counts.spots_left === 1) parts.push(t('rsvp.spots_left_one'));
  else if (counts.spots_left != null) parts.push(t('rsvp.spots_left', { count: counts.spots_left }));
  if (counts.waitlist) parts.push(t('rsvp.waitlist_count', { count: counts.waitlist }));
  return (
    <Text testID="counts" style={{ color: c.muted }}>
      {parts.join(' · ')}
    </Text>
  );
}
