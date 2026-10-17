import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig keeps jsx: preserve for Next; tests compile JSX with the automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
