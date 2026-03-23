// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce explicit return types on functions
      '@typescript-eslint/explicit-function-return-type': 'error',
      // No non-null assertions — use proper null checks
      '@typescript-eslint/no-non-null-assertion': 'error',
      // No floating promises — always await or .catch()
      '@typescript-eslint/no-floating-promises': 'error',
      // No misused promises (e.g. in if conditions)
      '@typescript-eslint/no-misused-promises': 'error',
      // Consistent type imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // No unused variables (underscore prefix to opt-out)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Prefer nullish coalescing over ||
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      // Prefer optional chaining
      '@typescript-eslint/prefer-optional-chain': 'error',
      // No console in library code — use pino
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Relax rules for scripts and config files
    files: ['scripts/**/*.ts', '*.config.*', '.claude/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    // Ignore build output, dependencies, and test fixtures
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', 'pnpm-lock.yaml'],
  },
);
