import { defineConfig } from 'tsup';

// Multi-entry so every `exports` subpath resolves to its own emitted file.
// Schemas keep their `.schema.ts` filename on disk; the exports map aliases
// them to extensionless subpaths (./config/schemas/cluster -> cluster.schema.js).
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/errors.ts',
    'src/logger.ts',
    'src/eventBus.ts',
    'src/net/index.ts',
    'src/net/*.ts',
    'src/cache/index.ts',
    'src/config/index.ts',
    'src/utils/*.ts',
    'src/constants/*.ts',
    'src/config/schemas/*.schema.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Externalize npm deps so pino/js-yaml/ioredis resolve from node_modules at
  // runtime instead of being bundled -- bundling CJS deps pulls their dynamic
  // require() of node builtins into the ESM output, which throws at boot.
  external: ['ioredis', 'js-yaml', 'pino', 'pino-pretty', 'zod'],
  sourcemap: true,
  splitting: true,
  clean: true,
});
