import { defineConfig } from 'vitest/config';

// Runs against the local Supabase database (npx supabase start). See capacity.test.ts.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time: the tests themselves create the contention.
    fileParallelism: false,
  },
});
