// ESLint flat config: typescript-eslint recommended rules for the backend, infra and shared packages.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/cdk.out/**',
      '**/dist/**',
      'frontend/**',
      'aidlc/**',
      '.claude/**',
      'docs/**',
    ],
  },
  tseslint.configs.recommended,
  {
    rules: {
      // Allow intentionally unused parameters and variables when prefixed with an underscore.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
