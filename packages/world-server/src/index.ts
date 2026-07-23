import { compose } from './compose';
import { IpcBus, createLocalBus } from '@flyff/ipc';
import { buildWorldClientServer } from './clientServer';

/**
 * Connect the ClusterListener to an `IpcBus`.
 *
 * Two transports, picked by `cacheAdapter`:
 *   - `redis` (production): `ioredis` loaded dynamically.
 *   - anything else (dev): `LocalBus` -- localhost TCP pub/sub, same redis-like
 *     shape. Lets cluster + world exchange `player:handoff` with no Redis.
 *
 * `ioredis` is loaded dynamically so the server still boots in `memory` cache
 * mode. Bus setup is best-effort -- a failure logs a warning and the world keeps
 * running without the `player:handoff` listener (joins rejected until recovered).
 */
async function startClusterListener(
  cfg: {
    cacheAdapter: string;
    redisUrl: string;
    ipcSecret: string;
    serverId: string;
    localBusHost: string;
    localBusPort: number;
  },
  setBus: (bus: IpcBus) => void,
  start: () => Promise<void>,
  log: { warn: (obj: unknown, msg: string) => void; info: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    if (cfg.cacheAdapter === 'redis') {
      // ioredis ships as `export = Redis` (CJS); the dynamic-import default needs
      // a construct-signature cast for tsc. Runtime shape matches IpcBus's
      // IpcRedis (on/publish/subscribe/unsubscribe/quit) -- see @flyff/ipc tests.
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
      log.info({ serverId: cfg.serverId }, 'IPC bus connected (redis) -- listening for player:handoff');
    } else {
      const localBus = await createLocalBus({
        host: cfg.localBusHost,
        port: cfg.localBusPort,
        logger: log as never,
      });
      const bus = new IpcBus(localBus, cfg.ipcSecret, cfg.serverId);
      setBus(bus);
      await start();
      log.info(
        { serverId: cfg.serverId, host: cfg.localBusHost, port: cfg.localBusPort },
        'IPC bus connected (local) -- listening for player:handoff',
      );
    }
  } catch (err) {
    log.warn({ err }, 'IPC bus setup failed -- player:handoff listener not started');
  }
}

async function main(): Promise<void> {
  const {
    config,
    logger,
    clusterRegistrar,
    clusterListener,
    joinService,
    joinHandler,
    mapKeyHandler,
    queryPlayerDataHandler,
    snapshotHandler,
    playerMovedHandler,
    playerBehaviorHandler,
    chatHandler,
    motionHandler,
    setTargetHandler,
    leaveHandler,
    playerCorrHandler,
    playerMoved2Handler,
    playerAngleHandler,
    queryGetPosHandler,
    queryGetDestObjHandler,
    getPosHandler,
    scriptDlgHandler,
    revivalHandler,
    playerSetDestObjHandler,
    meleeAttackHandler,
    rangeAttackHandler,
    actMsgHandler,
    moveItemHandler,
    dropItemHandler,
    dropGoldHandler,
    removeItemHandler,
    doEquipHandler,
    doUseItemHandler,
    bankHandler,
    shopHandler,
    taskbarHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    useSkillHandler,
    doUseSkillPointHandler,
    modifyStatusHandler,
    journal,
    journalReplayer,
    npcSpeechService,
    questTracker,
    spawnManager,
    aiSystem,
    checkpointSystem,
    recoverySystem,
    itemManager,
  } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });

  // Crash recovery: replay any journaled mutations the previous run never
  // flushed to the main DB, BEFORE accepting players. Rule `04-persistence.md`.
  const recovery = await journalReplayer.recover();
  if (recovery.total > 0) {
    logger.info(
      { replayed: recovery.replayed, skipped: recovery.skipped },
      'Journal recovery finished'
    );
  }

  // Flush + close the journal cleanly on shutdown.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down world server');
    npcSpeechService.stop();
    questTracker.stop();
    aiSystem.stop();
    checkpointSystem.stop();
    recoverySystem.stop();
    spawnManager.shutdown();
    itemManager.shutdown();
    journal.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  clusterRegistrar.start();
  await startClusterListener(
    {
      cacheAdapter: config.cache.adapter,
      redisUrl: config.cache.redisUrl,
      ipcSecret: config.ipc.secret,
      serverId: config.server.id,
      localBusHost: config.ipc.localBusHost,
      localBusPort: config.ipc.localBusPort,
    },
    (bus) => clusterListener.setBus(bus),
    () => clusterListener.start(),
    logger,
  );

  const { server } = buildWorldClientServer({
    joinHandler,
    mapKeyHandler,
    queryPlayerDataHandler,
    snapshotHandler,
    playerMovedHandler,
    playerBehaviorHandler,
    chatHandler,
    motionHandler,
    setTargetHandler,
    leaveHandler,
    playerCorrHandler,
    playerMoved2Handler,
    playerAngleHandler,
    queryGetPosHandler,
    queryGetDestObjHandler,
    getPosHandler,
    scriptDlgHandler,
    revivalHandler,
    playerSetDestObjHandler,
    meleeAttackHandler,
    rangeAttackHandler,
    actMsgHandler,
    moveItemHandler,
    dropItemHandler,
    dropGoldHandler,
    removeItemHandler,
    doEquipHandler,
    doUseItemHandler,
    bankHandler,
    shopHandler,
    taskbarHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    useSkillHandler,
    doUseSkillPointHandler,
    modifyStatusHandler,
    onDisconnect: (socket) => {
      // Flush player state (position, vitals, stats, bank gold) + drop from
      // managers. disconnectByCharId swallows its own errors so this never
      // rejects; the dispatcher also guards the hook with try/catch.
      void joinService.disconnectByCharId(socket.session?.charId);
    },
    logger,
  });
  server.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'World client server listening');
  });
}

void main();
