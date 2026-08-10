import type { Server } from 'node:net';
import { compose } from './compose';
import { IpcBus, createLocalBus } from '@flyff/ipc';
import { buildWorldClientServer } from './clientServer';
import { KICK_CLOSE_DELAY_MS } from './net/snapshot/kick.serializer';

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
      interface IpcRedisLike {
        on(event: 'message', h: (channel: string, data: string) => void): void;
        publish(channel: string, data: string): Promise<number>;
        subscribe(channel: string): Promise<void>;
        unsubscribe(channel: string): Promise<void>;
        quit(): Promise<void>;
      }
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
    queryEquipHandler,
    cheeringHandler,
    tradeService,
    tradeHandler,
    friendService,
    friendHandler,
    campusService,
    campusHandler,
    joinService,
    joinHandler,
    mapKeyHandler,
    queryPlayerDataHandler,
    snapshotHandler,
    playerMovedHandler,
    playerBehaviorHandler,
    playerBehavior2Handler,
    chatHandler,
    motionHandler,
    moverFocusHandler,
    gmChatLogHandler,
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
    partyService,
    partyHandler,
    guildService,
    guildBankService,
    guildHandler,
    playerManager,
    visibilityService,
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
    pkModeHandler,
    stateModeHandler,
    vendorHandler,
    enchantHandler,
    repairHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    useSkillHandler,
    doUseSkillPointHandler,
    modifyStatusHandler,
    journal,
    journalReplayer,
    adminCommandService,
    npcSpeechService,
    questTracker,
    spawnManager,
    aiSystem,
    checkpointSystem,
    recoverySystem,
    buffSystem,
    guildSalarySystem,
    guildWarSystem,
    guildWarService,
    guildQuestSystem,
    blinkwingSystem,
    pkDecaySystem,
    petSystem,
    itemManager,
    destPollService,
  } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });
  // Replaced below with the draining shutdown, once it exists. Kept here so a
  // boot-time crash (journal recovery) still fails loudly instead of hanging.
  process.on('uncaughtException', err => {
    logger.error({ err }, 'Uncaught exception');
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

  // Holder so `prefer-const` is satisfied — shutdown() runs before assignment.
  const clientServer: { server?: Server } = {};
  let shuttingDown = false;

  /**
   * Ordered teardown. The client-facing half comes FIRST and is the reason this
   * is async: every online player must get the forced-logout notice and have
   * their state flushed before the journal closes, or they relog into a world
   * that rolled back to the last checkpoint.
   *
   * `adminCommandService.kickAll` is exactly that sequence (notice -> awaited
   * `disconnectByCharId` per player -> socket close after the grace window), so
   * shutdown reuses it rather than re-deriving a drain. Its socket close is on a
   * timer, hence the `KICK_CLOSE_DELAY_MS` wait before we stop the systems and
   * close the journal.
   *
   * On Windows the SIGTERM handler below never fires -- the supervisor's
   * `child.kill('SIGTERM')` is `TerminateProcess` there (memory
   * `supervisor-orphans-and-windows-sigterm`). That is why the daemon asks over
   * the IPC channel instead, and why `process.on('message')` is the real stop
   * path on this platform.
   */
  const shutdown = async (signal: string, code = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down world server');

    // Stop accepting new connections before draining, so a joiner cannot land
    // mid-drain and be left un-notified.
    clientServer.server?.close();

    try {
      const drain = await adminCommandService.kickAll(`shutdown:${signal}`);
      logger.info(
        { total: drain.total, saved: drain.saved, failed: drain.failed.length },
        'Shutdown drain complete',
      );
      // Let the notices leave the wire + kickAll's deferred socket close run.
      if (drain.total > 0) {
        await new Promise<void>(res => setTimeout(res, KICK_CLOSE_DELAY_MS + 100));
      }
    } catch (err) {
      logger.error({ err }, 'Shutdown drain failed -- tearing down anyway');
    }

    npcSpeechService.stop();
    questTracker.stop();
    aiSystem.stop();
    checkpointSystem.stop();
    recoverySystem.stop();
    buffSystem.stop();
    guildSalarySystem.stop();
    guildWarSystem.stop();
    // Cancel any open declaration timer (rule 05 -- no timer outlives the
    // process it was armed in).
    guildWarService.dispose();
    guildQuestSystem.stop();
    blinkwingSystem.stop();
    pkDecaySystem.stop();
    // Before spawnManager.shutdown(): dismissing each pet kills its mover.
    petSystem.stop();
    spawnManager.shutdown();
    itemManager.shutdown();
    destPollService.shutdown();
    journal.close();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // The supervisor's real stop path. On Windows `child.kill('SIGTERM')` is
  // `TerminateProcess` and the SIGTERM handler above never runs, so the daemon
  // asks over the IPC channel instead (supervisor-daemon.ts `stop`). This is
  // what makes "click Stop in the admin panel" tell the clients to log out.
  process.on('message', (msg: unknown) => {
    if (typeof msg === 'object' && msg !== null && (msg as { cmd?: unknown }).cmd === 'shutdown') {
      void shutdown('ipc:shutdown');
    }
  });
  // Now that the draining shutdown exists, let a CRASH use it -- a crash must
  // still get clients off the wire with their state flushed. The boot-time
  // handlers above stay registered; `shuttingDown` makes the pair idempotent.
  //
  // `unhandledRejection` deliberately does NOT drain: it fires for any stray
  // floating promise anywhere in the process, and evicting every online player
  // over one is far too blunt. It stays a loud fast exit -- the supervisor
  // restarts us, and journal replay recovers state on the next boot. Only
  // `uncaughtException` (the process is genuinely unsound) drains.
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', err => {
    logger.error({ err }, 'Uncaught exception');
    void shutdown('uncaughtException', 1);
  });

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
    playerBehavior2Handler,
    chatHandler,
    motionHandler,
    moverFocusHandler,
    gmChatLogHandler,
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
    guildHandler,
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
    pkModeHandler,
    stateModeHandler,
    vendorHandler,
    enchantHandler,
    repairHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    useSkillHandler,
    doUseSkillPointHandler,
    modifyStatusHandler,
    mailHandler,
    queryEquipHandler,
    cheeringHandler,
    tradeHandler,
    friendHandler,
    campusHandler,
    onDisconnect: (socket) => {
      // Party cleanup FIRST -- needs the live player object to clear m_idParty
      // + re-broadcast roster / disband. After disconnectByCharId drops the
      // player from PlayerManager the party service can no longer resolve them.
      const charId = socket.session.charId;
      if (charId !== undefined) {
        const player = playerManager.get(charId);
        if (player) {
          partyService.onDisconnect(player);
          // Guild logout notice -- same ordering reason as party: the roster
          // fan-out needs the live player. The member is NEVER removed from the
          // roster (C++ `CGuildMng::RemoveConnection`, guild.cpp:882).
          guildService.onDisconnect(player);
          // Clear the guild-bank window flag (`CUser::m_bGuildBank`) -- a dropped
          // socket must not leave a phantom "window open" peer receiving echoes.
          guildBankService.onDisconnect(charId);
          // Trade teardown before the player leaves PlayerManager: refunds any
          // staged gold on BOTH sides and unwedges the surviving partner
          // (C++ `CMover::~CMover` -> `pOther->m_vtInfo.TradeClear()`).
          tradeService.onDisconnect(player);
          // Friend + campus presence: tell online friends we left and refresh
          // campus buff levels (a master's buff level is the ONLINE pupil count).
          friendService.onDisconnect(charId);
          campusService.onDisconnect(charId);
          // DEL_OBJ the leaver from every peer that still has them in scene, and
          // clear their own known-set (rule 05 -- no dangling Set entries).
          visibilityService.remove(player);
          // Stop the walk-to-destination position poll (rule 05 -- no interval
          // outlives the player it was armed for).
          destPollService.cancel(charId);
        }
      }
      // Flush player state (position, vitals, stats, bank gold) + drop from
      // managers. disconnectByCharId swallows its own errors so this never
      // rejects; the dispatcher also guards the hook with try/catch.
      void joinService.disconnectByCharId(charId);
    },
    logger,
  });
  clientServer.server = server;
  server.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'World client server listening');
  });
}

void main();
