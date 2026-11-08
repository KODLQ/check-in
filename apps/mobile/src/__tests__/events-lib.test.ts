import { errorKey } from '@/lib/events';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('errorKey', () => {
  it.each([
    ['owner_only', 'owner_only'],
    ['co_host_limit', 'co_host_limit'],
    ['invalid_invite', 'invalid_invite'],
    ['already_host', 'already_host'],
    ['invalid_cover', 'invalid_cover'],
    ['start_in_past', 'start_in_past'],
    ['something else', 'unknown'],
  ])('maps "%s" to %s', (message, key) => {
    expect(errorKey({ message })).toBe(key);
  });
  it('handles missing errors', () => {
    expect(errorKey(null)).toBe('unknown');
    expect(errorKey(undefined)).toBe('unknown');
  });
});
