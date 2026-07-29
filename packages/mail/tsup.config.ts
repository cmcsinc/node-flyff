import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/services/*.ts',
    'src/handlers/*.ts',
    'src/net/snapshot/*.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  external: ['@flyff/core', '@flyff/entities', '@flyff/world-core', '@flyff/database', '@flyff/inventory'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
