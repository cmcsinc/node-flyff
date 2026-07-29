import { compose } from './compose';
import { IpcBus, createLocalBus } from '@flyff/ipc';
import { buildWorldClientServer } from './clientServer';

/**
 * Connect the IPC listeners to a shared `IpcBus`.
 *
 * Two transports, picked by `cacheAdapter`:
 *   - `redis` (production): `ioredis` loaded dynamically.
 *   - anything else (dev): `LocalBus` -- localhost TCP pub/sub, same redis-like
 *     shape. Lets cluster + world exchange `player:handoff` with no Redis.
 *
 * One bus instance serves every channel: `player:handoff` (cluster->world) and
 * `admin:command` (admin panel->world). `ioredis` is loaded dynamically so the
 * server still boots in `memory` cache mode. Bus setup is best-effort -- a
 * failure logs a warning and the world keeps running without either listener
 * (joins rejected and admin commands ignored until recovered).
 */
async function startIpcListeners(
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
      log.info({ serverId: cfg.serverId }, 'IPC bus connected (redis) -- listeners started');
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
        'IPC bus connected (local) -- listeners started',
      );
    }
  } catch (err) {
    log.warn({ err }, 'IPC bus setup failed -- IPC listeners not started');
  }
}

async function main(): Promise<void> {
  const {
    config,
    logger,
    clusterRegistrar,
    clusterListener,
    adminListener,
    mailHandler,
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
    duelHandler,
    partyManager,
    partyService,
    partyHandler,
    playerManager,
    actMsgHandler,
    moveItemHandler,
    dropItemHandler,
    dropGoldHandler,
    removeItemHandler,
    doEquipHandler,
    doUseItemHandler,
    bankHandler,
    shopHandler,
    npcBuffHandler,
    taskbarHandler,
    skillTaskbarHandler,
    endSkillQueueHandler,
    reqLeaveHandler,
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
    buffSystem,
    pkDecaySystem,
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
    buffSystem.stop();
    pkDecaySystem.stop();
    spawnManager.shutdown();
    itemManager.shutdown();
    journal.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  clusterRegistrar.start();
  await startIpcListeners(
    {
      cacheAdapter: config.cache.adapter,
      redisUrl: config.cache.redisUrl,
      ipcSecret: config.ipc.secret,
      serverId: config.server.id,
      localBusHost: config.ipc.localBusHost,
      localBusPort: config.ipc.localBusPort,
    },
    (bus) => {
      // One bus, two channels: `player:handoff` and `admin:command`.
      clusterListener.setBus(bus);
      adminListener.setBus(bus);
    },
    async () => {
      await clusterListener.start();
      await adminListener.start();
    },
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
    duelHandler,
    partyHandler,
    actMsgHandler,
    moveItemHandler,
    dropItemHandler,
    dropGoldHandler,
    removeItemHandler,
    doEquipHandler,
    doUseItemHandler,
    bankHandler,
    shopHandler,
    npcBuffHandler,
    taskbarHandler,
    skillTaskbarHandler,
    endSkillQueueHandler,
    reqLeaveHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    useSkillHandler,
    doUseSkillPointHandler,
    modifyStatusHandler,
    mailHandler,
    onDisconnect: (socket) => {
      // Party cleanup FIRST -- needs the live player object to clear m_idParty
      // + re-broadcast roster / disband. After disconnectByCharId drops the
      // player from PlayerManager the party service can no longer resolve them.
      const charId = socket.session?.charId;
      if (charId !== undefined) {
        const player = playerManager.get(charId);
        if (player) partyService.onDisconnect(player);
      }
      // Flush player state (position, vitals, stats, bank gold) + drop from
      // managers. disconnectByCharId swallows its own errors so this never
      // rejects; the dispatcher also guards the hook with try/catch.
      void joinService.disconnectByCharId(charId);
    },
    logger,
  });
  server.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'World client server listening');
  });
}

void main();
