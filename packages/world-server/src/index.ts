import { compose } from './compose.js';
import { IpcBus } from '@flyff/ipc';
import { buildWorldClientServer } from './clientServer.js';

/**
 * Connect the ClusterListener to a real IpcBus when Redis is configured.
 *
 * `ioredis` is loaded dynamically so the server still boots in `memory` cache
 * mode (or before `pnpm install` resolves the new dep). Bus setup is best-effort
 * — a Redis failure logs a warning and the world keeps running without the
 * `player:handoff` listener (joins will be rejected until Redis recovers).
 */
async function startClusterListener(
  cfg: { cacheAdapter: string; redisUrl: string; ipcSecret: string; serverId: string },
  setBus: (bus: IpcBus) => void,
  start: () => Promise<void>,
  log: { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void },
): Promise<void> {
  if (cfg.cacheAdapter !== 'redis') {
    log.info({ adapter: cfg.cacheAdapter }, 'IPC bus disabled (cache adapter ≠ redis)');
    return;
  }
  try {
    // ioredis ships as `export = Redis` (CJS); the dynamic-import default needs
    // a construct-signature cast for tsc. Runtime shape matches IpcBus's
    // IpcRedis (on/publish/subscribe/unsubscribe/quit) — see @flyff/ipc tests.
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
    const bus = new IpcBus(redis, cfg.ipcSecret, cfg.serverId);
    setBus(bus);
    await start();
    log.info({ serverId: cfg.serverId }, 'IPC bus connected — listening for player:handoff');
  } catch (err) {
    log.warn({ err }, 'IPC bus setup failed — player:handoff listener not started');
  }
}

async function main(): Promise<void> {
  const { config, logger, clusterRegistrar, clusterListener, joinHandler } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });

  clusterRegistrar.start();
  await startClusterListener(
    {
      cacheAdapter: config.cache.adapter,
      redisUrl: config.cache.redisUrl,
      ipcSecret: config.ipc.secret,
      serverId: config.server.id,
    },
    (bus) => clusterListener.setBus(bus),
    () => clusterListener.start(),
    logger,
  );

  const { server } = buildWorldClientServer({ joinHandler, logger });
  server.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'World client server listening');
  });
}

void main();
