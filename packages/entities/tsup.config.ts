import { defineConfig } from 'tsup';

// Multi-entry so every `exports` subpath resolves to its own emitted file.
// `@flyff/core` + `@flyff/database` are workspace deps -- externalize so they
// resolve via node_modules at runtime instead of being bundled (esbuild CJS
// interop). CPlayer imports CharacterRow as a type-only import (erased).
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/player.ts',
    'src/mover.ts',
    'src/constants/*.ts',
    'src/math/*.ts',
    'src/tables/*.ts',
    'src/state/*.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  external: ['@flyff/core', '@flyff/database'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
