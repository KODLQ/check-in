import { formatOption, type InvitePoll, type MyVotes, type VoteChoice } from '@check-in/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { locale } from '@/lib/i18n';
import { Body, Button, useColors } from './ui';

const CHOICES: VoteChoice[] = ['yes', 'if_needed', 'no'];

/**
 * A date poll as a guest sees it in the app (add-date-polls): options with tallies and the Yes / If needed
 * names the host allows, and - when `onSave` is given (signed in, voting open) - per-option answers.
 */
export function PollVoting({
  poll,
  myVotes,
  timeZone,
  busy,
  onSave,
  onWithdraw,
}: {
  poll: InvitePoll;
  myVotes: MyVotes | null;
  timeZone: string;
  busy?: boolean;
  onSave?: (votes: { option_id: string; choice: VoteChoice }[]) => void;
  onWithdraw?: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [choices, setChoices] = useState<Record<string, VoteChoice | undefined>>(myVotes?.votes ?? {});
  useEffect(() => setChoices(myVotes?.votes ?? {}), [myVotes]);
  const canVote = !!onSave && poll.voting_open;

  return (
    <View style={{ gap: 12 }} testID="poll">
      <Body muted>
        {poll.expired ? t('polls.not_scheduled') : poll.voting_open ? t('polls.intro') : t('polls.voting_closed')}
      </Body>
      {poll.options.map((o, i) => {
        const live = canVote && !o.passed;
        return (
          <View
            key={o.id}
            testID={`poll-option-${i}`}
            style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, opacity: o.passed ? 0.6 : 1 }}
          >
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
              {formatOption(o, locale, timeZone)}
              {o.passed ? ` · ${t('polls.passed')}` : ''}
            </Text>
            <Text testID={`poll-tallies-${i}`} style={{ color: c.muted }}>
              {t('polls.tallies', { ...o.tallies })}
            </Text>
            {o.voters?.length ? (
              <Text style={{ color: c.text }}>
                {o.voters
                  .map((v) => (v.choice === 'if_needed' ? `${v.display_name} (${t('polls.if_needed')})` : v.display_name))
                  .join(', ')}
              </Text>
            ) : null}
            {live ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {CHOICES.map((choice) => (
                  <View key={choice} style={{ flex: 1 }}>
                    <Button
                      testID={`vote-${i}-${choice}`}
                      variant={choices[o.id] === choice ? 'primary' : 'secondary'}
                      title={t(`polls.${choice}`)}
                      disabled={busy}
                      onPress={() =>
                        setChoices((cur) => ({ ...cur, [o.id]: cur[o.id] === choice ? undefined : choice }))
                      }
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {canVote ? (
        <>
          {myVotes ? (
            <Text testID="my-votes" style={{ color: c.text, fontWeight: '700' }}>
              {t('polls.your_votes', { name: myVotes.display_name })}
            </Text>
          ) : null}
          <Button
            testID="save-votes"
            title={t('polls.save_votes')}
            loading={busy}
            onPress={() =>
              onSave?.(
                Object.entries(choices)
                  .filter((e): e is [string, VoteChoice] => !!e[1])
                  .map(([option_id, choice]) => ({ option_id, choice })),
              )
            }
          />
          {myVotes && onWithdraw ? (
            <Button testID="remove-votes" variant="ghost" title={t('polls.remove_votes')} disabled={busy} onPress={onWithdraw} />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
