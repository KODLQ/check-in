import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Area } from './access';
import { onPendingClaimSaved, redeemPendingClaim } from './pending-claim';

/**
 * Redeems a pending claim ticket once the user is in the app area (signed in, onboarded), and
 * whenever a new ticket arrives while they are. Returns the toast message to show, if any.
 */
export function usePendingClaim(area: Area | null): {
  message: string | null;
  dismiss: () => void;
} {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => onPendingClaimSaved(() => setNonce((n) => n + 1)), []);

  useEffect(() => {
    if (area !== 'app') return;
    let active = true;
    void redeemPendingClaim()
      .catch(() => null)
      .then((result) => {
        if (!active || !result || result.kind === 'retry') return;
        if (result.kind === 'expired') setMessage(t('claim.expired'));
        else
          setMessage(
            result.count > 0 ? t('claim.added', { count: result.count }) : t('claim.none'),
          );
      });
    return () => {
      active = false;
    };
  }, [area, nonce, t]);

  const dismiss = useCallback(() => setMessage(null), []);
  return { message, dismiss };
}
