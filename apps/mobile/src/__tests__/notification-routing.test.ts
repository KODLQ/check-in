import { notificationRoute } from '@/lib/notification-routing';

describe('notificationRoute', () => {
  it('opens the host view for managers', () =>
    expect(notificationRoute({ url: '/events/e0000000-0000-0000-0000-000000000001' })).toBe(
      '/events/e0000000-0000-0000-0000-000000000001',
    ));
  it('opens the invite for guests', () => expect(notificationRoute({ url: '/i/DemoFredag01' })).toBe('/i/DemoFredag01'));
  it.each([
    [undefined],
    [{}],
    [{ url: 42 }],
    [{ url: 'https://evil.example/i/DemoFredag01' }],
    [{ url: '/events/not-a-uuid' }],
    [{ url: '/i/short' }],
    [{ url: '/settings' }],
    [{ url: '/i/DemoFredag01/extra' }],
  ])('ignores %p', (data) => expect(notificationRoute(data)).toBeNull());
});
