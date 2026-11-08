import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.expo/**',
      '**/dist/**',
      '**/ios/**',
      '**/android/**',
      '**/database.types.ts',
      'openspec/**',
      '.claude/**',
      'supabase/functions/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/jest.setup.js', '**/e2e/**'],
    languageOptions: { globals: { ...globals.jest } },
  },
  prettier,
);
