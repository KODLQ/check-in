import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for server modules (route handlers, photo processing). Playwright covers the pages (e2e/).
export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./src/', import.meta.url)),
      // `server-only` throws outside the React server bundle; it has nothing to check in unit tests.
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
