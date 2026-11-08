import { accessArea } from '@/lib/access';

describe('accessArea', () => {
  it('sends signed-out users to sign-in', () => expect(accessArea(false, null)).toBe('signed-out'));
  it('blocks event creation until a display name is set', () => {
    expect(accessArea(true, { display_name: null })).toBe('onboarding');
    expect(accessArea(true, { display_name: '   ' })).toBe('onboarding');
  });
  it('lets onboarded hosts into the app', () =>
    expect(accessArea(true, { display_name: 'Anna' })).toBe('app'));
});
