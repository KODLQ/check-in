import { formatEventTime, formatOption, leadingOptionId, tally, type VoteChoice } from '@check-in/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { locale } from '@/lib/i18n';
import { allVotes, type HostPoll, type PollOptionRow, type PollVoterRow } from '@/lib/polls';
import { Body, Button, Card, Label, useColors } from './ui';

const CHOICES: VoteChoice[] = ['yes', 'if_needed', 'no'];

/**
 * Host view of a date poll (add-date-polls): every option with tallies and every voter's answer
 * (including No), the leading option highlighted, Pick per option, remove voter, Edit times.
 */
export function PollResults({
  poll,
  timeZone,
  closesAt,
  editable,
  onPick,
  onRemoveVoter,
  onEdit,
  now = new Date(),
}: {
  poll: HostPoll;
  timeZone: string;
  closesAt: string | null;
  /** Pending and not cancelled: Pick, Edit and remove are offered. */
  editable: boolean;
  onPick: (option: PollOptionRow) => void;
  onRemoveVoter: (voter: PollVoterRow) => void;
  onEdit: () => void;
  now?: Date;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const votes = allVotes(poll);
  const withTallies = poll.options.map((o) => ({ ...o, tallies: tally(votes, o.id) }));
  const leading = leadingOptionId(withTallies);
  const nameOf = new Map(poll.voters.map((v) => [v.id, v.display_name]));
  const closed = closesAt !== null && new Date(closesAt).getTime() <= now.getTime();

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>{t('polls.results')}</Label>
        <Text testID="poll-voter-count" style={{ color: c.muted }}>
          {t('polls.voted_count', { count: poll.voters.length })}
        </Text>
      </View>
      {closesAt ? (
        <Body muted>
          {closed ? t('polls.voting_closed') : t('polls.closes_at', { when: formatEventTime(new Date(closesAt), locale, timeZone) })}
        </Body>
      ) : null}

      {withTallies.map((o, i) => {
        const passed = new Date(o.starts_at).getTime() <= now.getTime();
        const isLeading = o.id === leading;
        return (
          <View
            key={o.id}
            testID={`poll-option-${i}`}
            style={{
              gap: 6,
              padding: 12,
              borderRadius: 12,
              backgroundColor: c.bg,
              borderWidth: isLeading ? 2 : 1,
              borderColor: isLeading ? c.accent : c.border,
              opacity: passed ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', flex: 1 }}>
                {formatOption(o, locale, timeZone)}
              </Text>
              {isLeading ? (
                <Text testID={`poll-leading-${i}`} style={{ color: c.accent, fontWeight: '800' }}>
                  {t('polls.leading')}
                </Text>
              ) : passed ? (
                <Text style={{ color: c.muted }}>{t('polls.passed')}</Text>
              ) : null}
            </View>
            <Text testID={`poll-tallies-${i}`} style={{ color: c.muted }}>
              {t('polls.tallies', { ...o.tallies })}
            </Text>
            {CHOICES.map((choice) => {
              const names = votes
                .filter((v) => v.option_id === o.id && v.choice === choice)
                .map((v) => nameOf.get(v.voter_id));
              return names.length ? (
                <Text key={choice} testID={`poll-names-${i}-${choice}`} style={{ color: c.text }}>
                  {t(`polls.${choice}`)}: {names.join(', ')}
                </Text>
              ) : null;
            })}
            {editable && !passed ? (
              <Button testID={`pick-${i}`} variant={isLeading ? 'primary' : 'secondary'} title={t('polls.pick')} onPress={() => onPick(o)} />
            ) : null}
          </View>
        );
      })}

      {poll.voters.length === 0 ? <Body muted>{t('polls.no_votes_yet')}</Body> : null}
      {editable && poll.voters.length > 0 ? (
        <View style={{ gap: 6 }}>
          {poll.voters.map((v, i) => (
            <View key={v.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: c.text }}>{v.display_name}</Text>
              <Pressable testID={`remove-voter-${i}`} accessibilityRole="button" hitSlop={8} onPress={() => onRemoveVoter(v)}>
                <Text style={{ color: c.danger }}>{t('polls.remove_voter')}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {editable ? <Button testID="edit-poll" variant="secondary" title={t('polls.edit_options')} onPress={onEdit} /> : null}
    </Card>
  );
}
