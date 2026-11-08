import '@/lib/i18n';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Area } from '@/lib/access';
import { PENDING_CLAIM_KEY, readPendingClaim, savePendingClaim } from '@/lib/pending-claim';
import { supabase } from '@/lib/supabase';
import { usePendingClaim } from '@/lib/use-pending-claim';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as jest.Mock;

const TICKET = 'AbCdEfGhIjKlMnOpQrStUv';
const flush = () => act(async () => {});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

async function hook(area: Area | null) {
  return renderHook((props: { area: Area | null }) => usePendingClaim(props.area), {
    initialProps: { area },
  });
}

describe('pending claim', () => {
  it('rejects malformed tickets', async () => {
    expect(await savePendingClaim('bad ticket')).toBe(false);
    expect(await AsyncStorage.getItem(PENDING_CLAIM_KEY)).toBeNull();
  });

  it('redeems only once the user is in the app area, then clears the ticket', async () => {
    await savePendingClaim(TICKET);
    rpc.mockResolvedValue({ data: { claimed: 2, merged: 0 }, error: null });

    const h = await hook('signed-out');
    await flush();
    await h.rerender({ area: 'onboarding' });
    await flush();
    expect(rpc).not.toHaveBeenCalled();

    await h.rerender({ area: 'app' });
    await waitFor(() => expect(h.result.current.message).toBe('2 invites added to your events'));
    expect(rpc).toHaveBeenCalledWith('claim_guest_rsvps', { p_ticket: TICKET });
    expect(await readPendingClaim()).toBeNull();
  });

  it('redeems a ticket that arrives while already in the app', async () => {
    rpc.mockResolvedValue({ data: { claimed: 0, merged: 1 }, error: null });
    const h = await hook('app');
    await flush();
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => {
      await savePendingClaim(TICKET);
    });
    await waitFor(() => expect(h.result.current.message).toBe('1 invite added to your events'));
  });

  it('clears the ticket on invalid_ticket and tells the user to start again', async () => {
    await savePendingClaim(TICKET);
    rpc.mockResolvedValue({ data: { error: 'invalid_ticket' }, error: null });
    const h = await hook('app');
    await waitFor(() =>
      expect(h.result.current.message).toBe('That link expired — open the invite page again'),
    );
    expect(await AsyncStorage.getItem(PENDING_CLAIM_KEY)).toBeNull();
  });

  it('keeps the ticket on network errors', async () => {
    await savePendingClaim(TICKET);
    rpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const h = await hook('app');
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await flush();
    expect(h.result.current.message).toBeNull();
    expect(await readPendingClaim()).toBe(TICKET);
  });

  it('drops tickets older than 24 hours without calling the server', async () => {
    await savePendingClaim(TICKET, Date.now() - 25 * 60 * 60 * 1000);
    const h = await hook('app');
    await flush();
    await flush();
    expect(rpc).not.toHaveBeenCalled();
    expect(h.result.current.message).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_CLAIM_KEY)).toBeNull();
  });
});
