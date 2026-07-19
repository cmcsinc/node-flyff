import { compose } from './compose.js';
import { IpcBus } from '@flyff/ipc';
import type { PublisherBusPort } from './ipc/handoffPublisher.js';
import { buildClusterClientServer } from './clientServer.js';

/**
 * Connect the ClusterHandoffPublisher to a real IpcBus when Redis is configured.
 *
 * Mirrors the world-side `startClusterListener`. `ioredis` is loaded dynamically
 * so the cluster still boots in `memory` cache mode (or before `pnpm install`
 * resolves the dep). Bus setup is best-effort — a Redis failure logs a warning
 * and char-select keeps working (PRE_JOIN will log-and-drop the handoff instead
 * of publishing it).
 */
async function startHandoffPublisher(
  cfg: { cacheAdapter: string; redisUrl: string; ipcSecret: string; serverId: string },
  setBus: (bus: PublisherBusPort) => void,
  log: { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void },
): Promise<void> {
  if (cfg.cacheAdapter !== 'redis') {
    log.info({ adapter: cfg.cacheAdapter }, 'IPC bus disabled (cache adapter ≠ redis)');
    return;
  }
  try {
    type IpcRedisLike = {
      on(event: 'message', h: (channel: string, data: string) => void): void;
      publish(channel: string, data: string): Promise<number>;
      subscribe(channel: string): Promise<void>;
      unsubscribe(channel: string): Promise<void>;
      quit(): Promise<void>;
    };
    const Redis = (await import('ioredis')).default as unknown as
      new (url: string, opts?: Record<string, unknown>) => IpcRedisLike;
    const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
    setBus(new IpcBus(redis, cfg.ipcSecret, cfg.serverId));
    log.info({ serverId: cfg.serverId }, 'IPC bus connected — publishing player:handoff');
  } catch (err) {
    log.warn({ err }, 'IPC bus setup failed — player:handoff will not be published');
  }
}

async function main(): Promise<void> {
  const { config, logger, worldRegistry, loginRegistrar, handoffPublisher, charHandler } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });

  await worldRegistry.start();
  loginRegistrar.start();
  await startHandoffPublisher(
    {
      cacheAdapter: config.cache.adapter,
      redisUrl: config.cache.redisUrl,
      ipcSecret: config.ipc.secret,
      serverId: config.server.id,
    },
    (bus) => handoffPublisher.setBus(bus),
    logger,
  );

  const { server } = buildClusterClientServer({ charHandler, logger });
  server.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'Cluster client server listening');
  });
}

void main();
