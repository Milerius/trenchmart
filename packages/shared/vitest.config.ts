import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/fee.ts', 'src/tier.ts', 'src/state.ts', 'src/escrow.ts', 'src/payouts.ts'],
      thresholds: {
        'src/fee.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/tier.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/state.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/escrow.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/payouts.ts': { lines: 85, functions: 85, branches: 85, statements: 85 },
      },
    },
  },
});
