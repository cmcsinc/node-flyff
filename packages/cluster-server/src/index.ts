import { compose } from './compose.js';
import { IpcBus, createLocalBus } from '@flyff/ipc';
import type { PublisherBusPort } from './ipc/handoffPublisher.js';
import { buildClusterClientServer } from './clientServer.js';

/**
 * Connect the ClusterHandoffPublisher to an `IpcBus`.
 *
 * Two transports, picked by `cacheAdapter`:
 *   - `redis` (production): `ioredis` loaded dynamically. HMAC-signed pub/sub
 *     over Redis; HMAC + 30 s freshness enforced by `IpcBus`.
 *   - anything else (dev): `LocalBus` — a localhost TCP pub/sub with the same
 *     redis-like shape, so cluster + world exchange `player:handoff` with no
 *     Redis dependency. First process to bind `localBusPort` becomes the broker.
 *
 * `ioredis` is loaded dynamically so the cluster still boots in `memory` cache
 * mode. Bus setup is best-effort — a failure logs a warning and char-select
 * keeps working (PRE_JOIN will log-and-drop the handoff instead of publishing).
 */
async function startHandoffPublisher(
  cfg: {
    cacheAdapter: string;
    redisUrl: string;
    ipcSecret: string;
    serverId: string;
    localBusHost: string;
    localBusPort: number;
  },
  setBus: (bus: PublisherBusPort) => void,
  log: { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    if (cfg.cacheAdapter === 'redis') {
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
      log.info({ serverId: cfg.serverId }, 'IPC bus connected (redis) — publishing player:handoff');
    } else {
      const localBus = await createLocalBus({
        host: cfg.localBusHost,
        port: cfg.localBusPort,
        logger: log as never,
      });
      setBus(new IpcBus(localBus, cfg.ipcSecret, cfg.serverId));
      log.info(
        { serverId: cfg.serverId, host: cfg.localBusHost, port: cfg.localBusPort },
        'IPC bus connected (local) — publishing player:handoff',
      );
    }
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
      localBusHost: config.ipc.localBusHost,
      localBusPort: config.ipc.localBusPort,
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
