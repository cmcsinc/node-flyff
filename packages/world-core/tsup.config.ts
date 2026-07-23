import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/managers/*.ts', 'src/quest-hooks.ts', 'src/snapshot-constants.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  external: ['@flyff/core', '@flyff/entities', '@flyff/resources'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
