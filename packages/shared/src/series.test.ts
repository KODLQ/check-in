import { describe, expect, it } from 'vitest';

import { endsOnError, formatRepeatRule, groupNameSchema, seriesInputSchema } from './series';

describe('formatRepeatRule', () => {
  it.each([
    ['weekly', '2026-11-13', 'en', 'Every Friday'],
    ['weekly', '2026-11-13', 'sv', 'Varje fredag'],
    ['biweekly', '2026-11-13', 'en', 'Every other Friday'],
    ['biweekly', '2026-11-13', 'sv', 'Varannan fredag'],
    ['monthly', '2026-11-06', 'en', 'First Friday of the month'],
    ['monthly', '2026-11-06', 'sv', 'Första fredagen i månaden'],
    ['monthly', '2026-11-18', 'en', 'Third Wednesday of the month'],
    ['monthly', '2026-11-18', 'sv', 'Tredje onsdagen i månaden'],
    ['monthly', '2026-11-26', 'en', 'Last Thursday of the month'],
    ['monthly', '2026-11-26', 'sv', 'Sista torsdagen i månaden'],
    ['monthly', '2026-11-23', 'en', 'Fourth Monday of the month'],
    ['monthly', '2027-02-22', 'sv', 'Sista måndagen i månaden'],
  ] as const)('%s from %s in %s', (frequency, anchor, locale, expected) => {
    expect(formatRepeatRule(frequency, anchor, locale)).toBe(expected);
  });
});

describe('series input', () => {
  it('accepts a rule with an optional end date', () => {
    const ok = seriesInputSchema.safeParse({
      group_id: '67000000-0000-4000-8000-0000000000a1',
      frequency: 'monthly',
      ends_on: '2027-06-30',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unknown frequencies and bad dates', () => {
    expect(seriesInputSchema.safeParse({ group_id: '67000000-0000-4000-8000-0000000000a1', frequency: 'daily' }).success).toBe(false);
    expect(
      seriesInputSchema.safeParse({ group_id: '67000000-0000-4000-8000-0000000000a1', frequency: 'weekly', ends_on: '30/6' }).success,
    ).toBe(false);
  });

  it('checks the end date against the first date', () => {
    expect(endsOnError('2026-11-01', '2026-11-13')).toBe('before_start');
    expect(endsOnError('2026-11-13', '2026-11-13')).toBeNull();
    expect(endsOnError(null, '2026-11-13')).toBeNull();
  });

  it('trims group names and limits them to 50 characters', () => {
    expect(groupNameSchema.parse('  AW crew ')).toBe('AW crew');
    expect(groupNameSchema.safeParse('   ').success).toBe(false);
    expect(groupNameSchema.safeParse('x'.repeat(51)).success).toBe(false);
  });
});
