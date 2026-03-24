#!/usr/bin/env tsx
/**
 * Development script to watch resource files.
 *
 * Usage: pnpm watch
 *
 * @module scripts/watch
 */

import { watchResources } from '../src/hotReload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('🔥 Flyff Resources Hot-Reload Watcher');
  console.log('Watching for changes to YAML files...\n');

  const cleanup = await watchResources({
    dataDir: resolve(__dirname, '../data'),
    onReload: (resources) => {
      console.log('\n✅ Resources reloaded!');
      console.log(`   Items: ${resources.items.items.size}`);
      console.log(`   Movers: ${resources.movers.movers.size}`);
      console.log(`   Skills: ${resources.skills.skills.size}`);
      console.log(`   Zones: ${resources.zones.zones.size}`);
      console.log('');
    },
    onError: (error) => {
      console.error('\n❌ Failed to reload resources:', error.message);
      console.error('');
    },
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping watcher...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n👋 Stopping watcher...');
    cleanup();
    process.exit(0);
  });
}

// Dynamic import for dirname
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

main().catch((err) => {
  console.error('Failed to start watcher:', err);
  process.exit(1);
});
