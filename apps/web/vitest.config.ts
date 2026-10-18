import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig keeps jsx: preserve for Next; tests compile JSX with the automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  esbuild: { jsx: 'automatic' },
  // Same `@/` alias as tsconfig, so tests can render components that import through it.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
