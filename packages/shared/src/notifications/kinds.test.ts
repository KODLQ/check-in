import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_KINDS } from './kinds.ts';

const pgtap = readFileSync(
  fileURLToPath(new URL('../../../../supabase/tests/08_notifications_core.test.sql', import.meta.url)),
  'utf8',
);

describe('NOTIFICATION_KINDS', () => {
  it('matches the list the pgTAP registry test compares the database against', () => {
    const block = pgtap.slice(pgtap.indexOf('$$ values'), pgtap.indexOf("'notification_kinds matches"));
    const rows = [...block.matchAll(/\('(\w+)', (true|false), array\[([^\]]*)\], (true|false)\)/g)].map(
      ([, kind, urgent, channels, stale]) => [
        kind,
        {
          urgent: urgent === 'true',
          channels: channels!.split(',').map((c) => c.trim().replace(/'/g, '')),
          staleAfterStart: stale === 'true',
        },
      ],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.fromEntries(rows)).toEqual(
      JSON.parse(JSON.stringify(NOTIFICATION_KINDS)) as Record<string, unknown>,
    );
  });
});
