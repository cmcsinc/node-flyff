/**
 * Hot-reload watcher for development.
 *
 * Watches resource files for changes and automatically reloads them.
 *
 * @module hotReload
 */

import type { FSWatcher } from 'chokidar';
import { createResourceLogger } from './logger.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reloadResources } from './index.js';

const logger = createResourceLogger('hotReload');

let watcher: FSWatcher | null = null;

/**
 * Watch options.
 */
export interface WatchOptions {
  /** Path to resources/data directory */
  dataDir?: string;
  /** Callback when resources are reloaded */
  onReload?: (resources: Awaited<ReturnType<typeof reloadResources>>) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Starts watching resource files for changes.
 *
 * @param options - Watch options
 * @returns Cleanup function to stop watching
 */
export async function watchResources(options: WatchOptions = {}): Promise<() => void> {
  const { dataDir = './resources/data', onReload, onError } = options;

  if (watcher) {
    logger.warn('Watcher already running');
    return () => {};
  }

  // Dynamic import chokidar (only load this module in development)
  let chokidar: typeof import('chokidar');
  try {
    chokidar = await import('chokidar');
  } catch (err) {
    logger.error({ err }, 'Failed to import chokidar. Make sure it\'s installed: pnpm add chokidar');
    throw new Error('chokidar is required for hot-reload. Install it with: pnpm add chokidar');
  }

  const resolvedDataDir = resolve(dataDir);

  logger.info({ dataDir: resolvedDataDir }, 'Starting resource hot-reload watcher...');

  // Initial load
  try {
    const resources = await reloadResources(resolvedDataDir);
    onReload?.(resources);
    logger.info('Initial resources loaded');
  } catch (err) {
    logger.error({ err }, 'Failed to load initial resources');
    onError?.(err as Error);
  }

  // Watch for changes
  watcher = chokidar.watch(`${resolvedDataDir}/**/*.yml`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('change', async (filePath) => {
    logger.info({ file: filePath }, 'Resource file changed, reloading...');

    try {
      const resources = await reloadResources(resolvedDataDir);
      onReload?.(resources);
      logger.info('Resources reloaded successfully');
    } catch (err) {
      logger.error({ file: filePath, err }, 'Failed to reload resources');
      onError?.(err as Error);
    }
  });

  watcher.on('add', async (filePath) => {
    logger.info({ file: filePath }, 'New resource file added, reloading...');

    try {
      const resources = await reloadResources(resolvedDataDir);
      onReload?.(resources);
      logger.info('Resources reloaded successfully');
    } catch (err) {
      logger.error({ file: filePath, err }, 'Failed to reload resources');
      onError?.(err as Error);
    }
  });

  watcher.on('error', (error) => {
    logger.error({ error }, 'Watcher error');
    onError?.(error as Error);
  });

  // Return cleanup function
  return () => {
    logger.info('Stopping resource hot-reload watcher...');
    watcher?.close();
    watcher = null;
  };
}

/**
 * Stops watching resource files.
 */
export function stopWatching(): void {
  if (watcher) {
    logger.info('Stopping resource hot-reload watcher...');
    watcher.close();
    watcher = null;
  }
}

/**
 * Checks if the watcher is currently active.
 */
export function isWatching(): boolean {
  return watcher !== null;
}
