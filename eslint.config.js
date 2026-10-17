import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      '**/coverage/**',
      'design/**',
      'evidence/**',
      'playwright-report/**',
      'test-results/**',
      'apps/web/AGENTS.md',
      'target/**',
      '.anchor/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: [
      'packages/shared/src/fee.ts',
      'packages/shared/src/tier.ts',
      'packages/shared/src/state.ts',
      'packages/shared/src/escrow.ts',
      'packages/shared/src/payouts.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject time into fee, tier, and escrow modules. Do not call Date.now().',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject time into fee, tier, and escrow modules. Do not call new Date().',
        },
      ],
    },
  },
);
