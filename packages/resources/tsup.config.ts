import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/schemas/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  external: ['chokidar', 'pino', 'pino-pretty', 'yaml', 'zod'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
