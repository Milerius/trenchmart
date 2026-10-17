import { registerHooks } from 'node:module';

// typescript-eslint 8.71.2 reads the TypeScript 6 API. The project compiler
// stays on TypeScript 7; only ESLint's `typescript` import is redirected.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript') {
      return nextResolve('@typescript/typescript6', context);
    }
    if (specifier.startsWith('typescript/')) {
      return nextResolve(
        `@typescript/typescript6/${specifier.slice('typescript/'.length)}`,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});
