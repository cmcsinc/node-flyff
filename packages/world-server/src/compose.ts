import { createLogger, type Logger, loadConfig, type WorldServerConfig } from '@flyff/core';
import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
import { createDb, type DbConfig, CharacterRepository, AccountRepository, Journal, QuestRepository, InventoryRepository, BankRepository } from '@flyff/database';
import { ClusterRegistrar } from './ipc/clusterRegistrar.js';
import { ClusterListener } from './ipc/clusterListener.js';
import { loadAllResources, type ResourceIndex } from '@flyff/resources';
import { PlayerManager } from './managers/player.manager.js';
import { ZoneManager } from './managers/zone.manager.js';
import { SpawnManager } from './managers/spawn.manager.js';
import { PlayerSnapshotSerializer } from './net/snapshot/playerSnapshot.serializer.js';
import { NpcSnapshotSerializer } from './net/snapshot/npcSnapshot.serializer.js';
import { DestObjSerializer } from './net/snapshot/destObj.serializer.js';
import { JoinService } from './services/join.service.js';
import { QuestService } from './services/quest.service.js';
import { JoinHandler } from './handlers/join.handler.js';
import { MapKeyService } from './services/mapKey.service.js';
import { MapKeyHandler } from './handlers/mapKey.handler.js';
import { VicinityService } from './services/vicinity.service.js';
import { QueryPlayerDataService } from './services/queryPlayerData.service.js';
import { QueryPlayerDataHandler } from './handlers/queryPlayerData.handler.js';
import { SnapshotService } from './services/snapshot.service.js';
import { SnapshotHandler } from './handlers/snapshot.handler.js';
import { MovementService } from './services/movement.service.js';
import { PlayerMovedHandler } from './handlers/playerMoved.handler.js';
import { PlayerBehaviorHandler } from './handlers/playerBehavior.handler.js';
import { ChatService } from './services/chat.service.js';
import { ChatHandler } from './handlers/chat.handler.js';
import { CommandService } from './services/command.service.js';
import { MotionService } from './services/motion.service.js';
import { MotionHandler } from './handlers/motion.handler.js';
import { TargetService } from './services/target.service.js';
import { SetTargetHandler } from './handlers/setTarget.handler.js';
import { LeaveHandler } from './handlers/leave.handler.js';
import { PlayerCorrHandler } from './handlers/playerCorr.handler.js';
import { PlayerMoved2Handler } from './handlers/playerMoved2.handler.js';
import { PlayerAngleHandler } from './handlers/playerAngle.handler.js';
import { QueryGetPosService } from './services/queryGetPos.service.js';
import { QueryGetPosHandler } from './handlers/queryGetPos.handler.js';
import { QueryGetDestObjService } from './services/queryGetDestObj.service.js';
import { QueryGetDestObjHandler } from './handlers/queryGetDestObj.handler.js';
import { GetPosHandler } from './handlers/getPos.handler.js';
import { ScriptDlgService } from './services/scriptDlg.service.js';
import { ScriptDlgHandler } from './handlers/scriptDlg.handler.js';
import { RevivalService } from './services/revival.service.js';
import { NpcSpeechService } from './services/npcSpeech.service.js';
import { RevivalHandler } from './handlers/revival.handler.js';
import { MeleeAttackService } from './services/meleeAttack.service.js';
import { CombatService } from './services/combat.service.js';
import { DropService } from './services/drop.service.js';
import { InventoryService } from './services/inventory.service.js';
import { ItemManager } from './managers/item.manager.js';
import { VISIBILITY_RADIUS } from './net/snapshot/constants.js';
import { PlayerSetDestObjHandler } from './handlers/playerSetDestObj.handler.js';
import { MeleeAttackHandler } from './handlers/meleeAttack.handler.js';
import { ActMsgHandler } from './handlers/actMsg.handler.js';
import { RemoveQuestHandler } from './handlers/removeQuest.handler.js';
import { QuestCheckHandler } from './handlers/questCheck.handler.js';
import { QuestHelperHandler } from './handlers/questHelper.handler.js';
import { JournalReplayer } from './systems/journalReplayer.js';
import { registerReplayers } from './systems/journalReplayers.js';
import { QuestTrackerSystem } from './systems/questTracker.system.js';
import { AISystem } from './systems/ai.system.js';

export interface WorldComposeResult {
  config: WorldServerConfig;
  logger: Logger;
  clusterRegistrar: ClusterRegistrar;
  clusterListener: ClusterListener;
  resources: ResourceIndex;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  spawnManager: SpawnManager;
  npcSpeechService: NpcSpeechService;
  snapshotSerializer: PlayerSnapshotSerializer;
  npcSnapshotSerializer: NpcSnapshotSerializer;
  joinService: JoinService;
  questService: QuestService;
  joinHandler: JoinHandler;
  mapKeyService: MapKeyService;
  mapKeyHandler: MapKeyHandler;
  vicinityService: VicinityService;
  queryPlayerDataService: QueryPlayerDataService;
  queryPlayerDataHandler: QueryPlayerDataHandler;
  snapshotService: SnapshotService;
  snapshotHandler: SnapshotHandler;
  movementService: MovementService;
  playerMovedHandler: PlayerMovedHandler;
  playerBehaviorHandler: PlayerBehaviorHandler;
  chatService: ChatService;
  chatHandler: ChatHandler;
  commandService: CommandService;
  motionService: MotionService;
  motionHandler: MotionHandler;
  targetService: TargetService;
  setTargetHandler: SetTargetHandler;
  leaveHandler: LeaveHandler;
  playerCorrHandler: PlayerCorrHandler;
  playerMoved2Handler: PlayerMoved2Handler;
  playerAngleHandler: PlayerAngleHandler;
  queryGetPosService: QueryGetPosService;
  queryGetPosHandler: QueryGetPosHandler;
  queryGetDestObjService: QueryGetDestObjService;
  queryGetDestObjHandler: QueryGetDestObjHandler;
  getPosHandler: GetPosHandler;
  scriptDlgService: ScriptDlgService;
  scriptDlgHandler: ScriptDlgHandler;
  revivalService: RevivalService;
  revivalHandler: RevivalHandler;
  meleeAttackService: MeleeAttackService;
  combatService: CombatService;
  itemManager: ItemManager;
  dropService: DropService;
  playerSetDestObjHandler: PlayerSetDestObjHandler;
  meleeAttackHandler: MeleeAttackHandler;
  actMsgHandler: ActMsgHandler;
  removeQuestHandler: RemoveQuestHandler;
  questCheckHandler: QuestCheckHandler;
  questHelperHandler: QuestHelperHandler;
  journal: Journal;
  journalReplayer: JournalReplayer;
  questTracker: QuestTrackerSystem;
  aiSystem: AISystem;
}

export async function compose(): Promise<WorldComposeResult> {
  const config = await loadConfig('world-server', WorldServerConfigSchema);
  const logger = createLogger({ service: 'world-server', serverId: config.server.id });

  // Load game resources (items, movers, skills, zones)
  logger.info({ phase: 'resources' }, 'Loading game resources');
  const resources = await loadAllResources(config.resources.dataDir);
  logger.info(
    {
      items: resources.items.items.size,
      movers: resources.movers.movers.size,
      skills: resources.skills.skills.size,
      zones: resources.zones.zones.size,
    },
    'Resources loaded'
  );

  const clusterRegistrar = new ClusterRegistrar({
    serverId: config.server.id,
    channelId: config.registration.channelId,
    channelName: config.registration.channelName,
    publicIp: config.server.publicHost,
    publicPort: config.server.port,
    maxPlayers: config.world.maxPlayers,
    ipcSecret: config.ipc.secret,
    clusterHost: config.registration.clusterHost,
    clusterInternalPort: config.registration.clusterInternalPort,
    reconnectIntervalMs: config.registration.reconnectIntervalMs,
    heartbeatIntervalMs: config.registration.heartbeatIntervalMs,
    getPlayerCount: () => 0,
    logger,
  });

  // Database (character load on JOIN).
  const dbConfig: DbConfig = {
    client: config.database.client,
    connection: config.database.client === 'better-sqlite3'
      ? config.database.filename
      : config.database.url || {
          host: 'localhost',
          port: 3306,
          user: 'root',
          password: '',
          database: 'flyff',
        },
  };
  const db = createDb(dbConfig);
  const charRepo = new CharacterRepository(db);
  const accountRepo = new AccountRepository(db);
  const questRepo = new QuestRepository(db);
  const inventoryRepo = new InventoryRepository(db);
  const bankRepo = new BankRepository(db);

  // WAL journal — embedded SQLite, opened once per process. Critical mutations
  // (items, gold, exp, level) append here before ack so a crash never dupes or
  // rolls back. Closed on shutdown via index.ts. See rule `04-persistence.md`.
  const journal = new Journal({ path: config.wal.journalPath, logger });
  const journalReplayer = new JournalReplayer({ journal, logger });
  // Register idempotent replay handlers for every WAL event type the services
  // emit (CHAR_EXP / CHAR_GOLD / INVENTORY_SLOT). Payloads are absolute
  // end-state, so recover() can re-apply them on the next boot without dupes.
  registerReplayers(journalReplayer, { charRepo, inventoryRepo, logger });

  // In-memory world state + enter-world stack.
  const playerManager = new PlayerManager();
  const zoneManager = new ZoneManager();
  const clusterListener = new ClusterListener({});
  const snapshotSerializer = new PlayerSnapshotSerializer();
  const npcSnapshotSerializer = new NpcSnapshotSerializer();

  // Boot the spawn table before the TCP listener opens so the first JOIN sees a
  // populated zone. Static NPCs (with outfit) + monster spawn points come from
  // the loaded zone YAML + mover resource index.
  const spawnManager = new SpawnManager({
    resources,
    // Respawn broadcast: push a 1-entry ADD_OBJ snapshot to players already in
    // the zone so they see the monster reappear. zoneManager + npcSnapshot
    // exist above, so the closure captures them by reference.
    onSpawn: (mover) => {
      const pkt = npcSnapshotSerializer.build([mover]);
      zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, pkt);
    },
  });
  spawnManager.bootstrap();
  logger.info(
    { movers: spawnManager.size, zoneId: 1 },
    'Spawn table bootstrapped',
  );

  // Ambient NPC speech bubbles — scans spawned NPCs for state-0 `speak`
  // greetings and broadcasts them on the vanilla `CNpcProperty` cadence.
  const npcSpeechService = new NpcSpeechService({
    spawnManager,
    zoneManager,
    dialogs: resources.dialogs,
  });
  npcSpeechService.start();

  // ponytail: `inventory` left permissive-stubbed (no inventory system yet).
  // Item quests stay uncompletable until it lands; non-item quests work today.
  const questService = new QuestService({
    questRepo,
    quests: resources.quests,
    journal,
    charRepo,
  });

  // Phase 6 — reactive quest tracker (kill/patrol/time). Self-driven 1 s timer
  // for the time-limit countdown; `onKill`/`onPlayerMoved` are hooks the combat
  // and movement services call (wired in Phase 7 integration).
  const questTracker = new QuestTrackerSystem({
    quests: resources.quests,
    playerManager,
    questRepo,
  });
  questTracker.start();

  // Revival/death loop — wired before AISystem so the AI tick can hand lethal
  // player damage to `onPlayerDeath` (flag dead + broadcast + open revive dlg).
  const revivalService = new RevivalService({
    charRepo, inventoryRepo, journal, zoneManager, playerManager, zones: resources.zones,
  });

  // Monster idle-wander FSM (C++ CAIMonster::StateIdle). Emits one DESTPOS per
  // new destination; the client walks itself. Monsters only — town NPCs/guards
  // are skipped. Self-driven 1 s timer; `tick(now)` is public for the future
  // unified 50 ms loop. Stopped on shutdown via index.ts (no leaked timer).
  const aiSystem = new AISystem({
    spawnManager, zoneManager, playerManager, zones: resources.zones,
    onPlayerDeath: (p, killerObjid) => revivalService.onPlayerDeath(p, killerObjid),
  });
  aiSystem.start();

  const joinService = new JoinService({
    charRepo,
    accountRepo,
    questService,
    inventoryRepo,
    bankRepo,
    playerManager,
    zoneManager,
    handoffSource: clusterListener,
  });
  const joinHandler = new JoinHandler(
    joinService,
    snapshotSerializer,
  );

  const mapKeyService = new MapKeyService({ playerManager });
  const vicinityService = new VicinityService({
    playerManager,
    spawnManager,
    npcSnapshotSerializer,
  });
  const mapKeyHandler = new MapKeyHandler(mapKeyService, vicinityService);
  const queryPlayerDataService = new QueryPlayerDataService({ playerManager });
  const queryPlayerDataHandler = new QueryPlayerDataHandler(queryPlayerDataService);

  // In-world movement + peer-broadcast handlers (Phases 3-5).
  const snapshotService = new SnapshotService({ zoneManager });
  const snapshotHandler = new SnapshotHandler(playerManager, snapshotService);
  const movementService = new MovementService({
    zoneManager,
    onMoved: (p) => questTracker.onPlayerMoved(p),
  });
  const playerMovedHandler = new PlayerMovedHandler(playerManager, movementService);
  const playerBehaviorHandler = new PlayerBehaviorHandler(playerManager, movementService);

  // Phase 6 — remaining v15 C→S handlers (chat, motion, target, movement
  // variants, query/getpos, script dialog, revival). See PROGRESS.md for
  // the audit that scoped these.
  const inventoryService = new InventoryService({ inventoryRepo, charRepo, journal });
  const commandService = new CommandService({
    playerManager, spawnManager, questService, journal,
    inventoryService, charRepo,
  });
  const chatService = new ChatService({ zoneManager, commandService });
  const chatHandler = new ChatHandler(playerManager, chatService);
  const motionService = new MotionService({ zoneManager });
  const motionHandler = new MotionHandler(playerManager, motionService);
  const targetService = new TargetService({ spawnManager });
  const setTargetHandler = new SetTargetHandler(playerManager, targetService);
  const leaveHandler = new LeaveHandler();
  const playerCorrHandler = new PlayerCorrHandler(playerManager, movementService);
  const playerMoved2Handler = new PlayerMoved2Handler(playerManager, movementService);
  const playerAngleHandler = new PlayerAngleHandler(playerManager, movementService);
  const queryGetPosService = new QueryGetPosService();
  const queryGetPosHandler = new QueryGetPosHandler(playerManager, queryGetPosService);
  const queryGetDestObjService = new QueryGetDestObjService(playerManager, new DestObjSerializer());
  const queryGetDestObjHandler = new QueryGetDestObjHandler(playerManager, queryGetDestObjService);
  const getPosHandler = new GetPosHandler(playerManager, movementService);
  const scriptDlgService = new ScriptDlgService({
    spawnManager, dialogs: resources.dialogs, quests: resources.quests, questService,
  });
  const scriptDlgHandler = new ScriptDlgHandler(playerManager, scriptDlgService);
  const revivalHandler = new RevivalHandler(playerManager, revivalService);

  const itemManager = new ItemManager({ zoneManager });
  const dropService = new DropService({ resources, itemManager });
  const combatService = new CombatService({
    spawnManager, zoneManager, playerManager, charRepo, journal, questTracker, dropService,
  });
  const meleeAttackService = new MeleeAttackService({ zoneManager, combatService });
  const playerSetDestObjHandler = new PlayerSetDestObjHandler(playerManager, movementService);
  const meleeAttackHandler = new MeleeAttackHandler(playerManager, meleeAttackService);
  // Phase E — ground-item pickup (PACKETTYPE_ACTMSG / OBJMSG_PICKUP).
  const actMsgHandler = new ActMsgHandler({ playerManager, itemManager, inventoryService });

  // Phase 4 — C→S quest handlers (REMOVEQUEST / QUEST_CHECK / QUESTHELPER).
  const removeQuestHandler = new RemoveQuestHandler(playerManager, questService);
  const questCheckHandler = new QuestCheckHandler(playerManager, questService);
  const questHelperHandler = new QuestHelperHandler(playerManager, spawnManager);

  return {
    config,
    logger,
    clusterRegistrar,
    clusterListener,
    resources,
    playerManager,
    zoneManager,
    spawnManager,
    npcSpeechService,
    questTracker,
    aiSystem,
    snapshotSerializer,
    npcSnapshotSerializer,
    joinService,
    joinHandler,
    questService,
    mapKeyService,
    mapKeyHandler,
    vicinityService,
    queryPlayerDataService,
    queryPlayerDataHandler,
    snapshotService,
    snapshotHandler,
    movementService,
    playerMovedHandler,
    playerBehaviorHandler,
    chatService,
    chatHandler,
    commandService,
    motionService,
    motionHandler,
    targetService,
    setTargetHandler,
    leaveHandler,
    playerCorrHandler,
    playerMoved2Handler,
    playerAngleHandler,
    queryGetPosService,
    queryGetPosHandler,
    queryGetDestObjService,
    queryGetDestObjHandler,
    getPosHandler,
    scriptDlgService,
    scriptDlgHandler,
    revivalService,
    revivalHandler,
    meleeAttackService,
    combatService,
    itemManager,
    dropService,
    playerSetDestObjHandler,
    meleeAttackHandler,
    actMsgHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    journal,
    journalReplayer,
  };
}
