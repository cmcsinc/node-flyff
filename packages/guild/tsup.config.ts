import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/services/*.ts',
    'src/managers/*.ts',
    'src/handlers/*.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  external: ['@flyff/core', '@flyff/entities', '@flyff/world-core', '@flyff/database'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
