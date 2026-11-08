import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AnnouncementComposer, AnnouncementList, announcementErrorMessage } from '@/components/announcements';
import i18n from '@/lib/i18n';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const t = i18n.t.bind(i18n) as (k: string, v?: Record<string, string>) => string;

describe('AnnouncementComposer', () => {
  it('requires text and does not post an empty update', async () => {
    const post = jest.fn();
    await render(<AnnouncementComposer eventId="e1" onPosted={jest.fn()} post={post} />);
    await fireEvent.press(screen.getByTestId('announcement-post'));
    expect(await screen.findByText('Write something first')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('counts characters and rejects more than 500', async () => {
    const post = jest.fn();
    await render(<AnnouncementComposer eventId="e1" onPosted={jest.fn()} post={post} />);
    await fireEvent.changeText(screen.getByTestId('announcement-input'), 'x'.repeat(501));
    expect(screen.getByTestId('announcement-counter')).toHaveTextContent('501/500');
    await fireEvent.press(screen.getByTestId('announcement-post'));
    expect(await screen.findByText('Max 500 characters')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('posts trimmed text and clears the input', async () => {
    const post = jest.fn().mockResolvedValue({ error: null });
    const onPosted = jest.fn();
    await render(<AnnouncementComposer eventId="e1" onPosted={onPosted} post={post} />);
    await fireEvent.changeText(screen.getByTestId('announcement-input'), '  Doors open 19:30  ');
    await fireEvent.press(screen.getByTestId('announcement-post'));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('e1', 'Doors open 19:30');
    expect(screen.getByTestId('announcement-input').props.value).toBe('');
  });

  it('shows when posting is possible again after the daily limit', async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ error: { message: 'announcement_limit', details: '2026-12-12T18:30:00Z' } });
    await render(<AnnouncementComposer eventId="e1" onPosted={jest.fn()} post={post} />);
    await fireEvent.changeText(screen.getByTestId('announcement-input'), 'Sixth');
    await fireEvent.press(screen.getByTestId('announcement-post'));
    expect(
      await screen.findByText("You've posted 5 updates in 24 hours. You can post again Sat 12 Dec, 19:30."),
    ).toBeTruthy();
  });
});

describe('announcementErrorMessage', () => {
  it('maps server errors', () => {
    expect(announcementErrorMessage({ message: 'event_closed' }, t)).toBe('This event is no longer taking responses');
    expect(announcementErrorMessage({ message: 'boom' }, t)).toBe('Something went wrong. Try again.');
  });
});

describe('AnnouncementList', () => {
  it('renders items in the given (newest first) order with relative times', async () => {
    const now = Date.now();
    await render(
      <AnnouncementList
        items={[
          { id: '2', body: "We're on the roof", created_at: new Date(now - 5 * 60_000).toISOString() },
          { id: '1', body: 'Doors open 19:30', created_at: new Date(now - 3 * 3600_000).toISOString() },
        ]}
      />,
    );
    const items = screen.getAllByTestId('announcement');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/We're on the roof.*5 minutes ago/);
    expect(items[1]).toHaveTextContent(/Doors open 19:30.*3 hours ago/);
    expect(screen.queryByTestId('announcement-delete-1')).toBeNull();
  });
});
