import { createLogger, type Logger, loadConfig, type WorldServerConfig } from '@flyff/core';
import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
import { createDb, type DbConfig, CharacterRepository, AccountRepository, Journal, QuestRepository, InventoryRepository, BankRepository, SkillRepository } from '@flyff/database';
import { ClusterRegistrar } from './ipc/clusterRegistrar';
import { ClusterListener } from './ipc/clusterListener';
import { loadAllResources, type ResourceIndex } from '@flyff/resources';
import { PlayerManager } from '@flyff/world-core';
import { ZoneManager } from '@flyff/world-core';
import { SpawnManager } from '@flyff/world-core';
import { PlayerSnapshotSerializer } from './net/snapshot/playerSnapshot.serializer';
import { SetExperienceSerializer } from '@flyff/combat';
import { TaskBarSnapshotSerializer } from './net/snapshot/taskbar.serializer';
import { NpcSnapshotSerializer } from '@flyff/npc';
import { DestObjSerializer } from '@flyff/combat';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';
import { JoinService } from './services/join.service';
import { QuestService } from '@flyff/quest';
import { JoinHandler } from './handlers/join.handler';
import { MapKeyService } from '@flyff/npc';
import { MapKeyHandler } from '@flyff/npc';
import { VicinityService } from '@flyff/npc';
import { QueryPlayerDataService } from './services/queryPlayerData.service';
import { QueryPlayerDataHandler } from './handlers/queryPlayerData.handler';
import { SnapshotService } from './services/snapshot.service';
import { SnapshotHandler } from './handlers/snapshot.handler';
import { MovementService } from './services/movement.service';
import { PlayerMovedHandler } from './handlers/playerMoved.handler';
import { PlayerBehaviorHandler } from './handlers/playerBehavior.handler';
import { ChatService } from './services/chat.service';
import { ChatHandler } from './handlers/chat.handler';
import { CommandService } from './services/command.service';
import { MotionService } from './services/motion.service';
import { MotionHandler } from './handlers/motion.handler';
import { TargetService } from '@flyff/npc';
import { SetTargetHandler } from '@flyff/npc';
import { LeaveHandler } from './handlers/leave.handler';
import { PlayerCorrHandler } from './handlers/playerCorr.handler';
import { PlayerMoved2Handler } from './handlers/playerMoved2.handler';
import { PlayerAngleHandler } from './handlers/playerAngle.handler';
import { QueryGetPosService } from './services/queryGetPos.service';
import { QueryGetPosHandler } from './handlers/queryGetPos.handler';
import { QueryGetDestObjService } from './services/queryGetDestObj.service';
import { QueryGetDestObjHandler } from './handlers/queryGetDestObj.handler';
import { GetPosHandler } from './handlers/getPos.handler';
import { ScriptDlgService } from '@flyff/npc';
import { ScriptDlgHandler } from '@flyff/npc';
import { RevivalService } from './services/revival.service';
import { NpcSpeechService } from '@flyff/npc';
import { RevivalHandler } from './handlers/revival.handler';
import { PkModeService } from './services/pkMode.service';
import { PkModeHandler } from './handlers/pkMode.handler';
import { MeleeAttackService } from '@flyff/combat';
import { RangeAttackService } from '@flyff/combat';
import { CombatService } from '@flyff/combat';
import { DropService } from '@flyff/inventory';
import { InventoryService } from '@flyff/inventory';
import { LootService } from '@flyff/inventory';
import { ItemManager } from '@flyff/inventory';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import { PlayerSetDestObjHandler } from './handlers/playerSetDestObj.handler';
import { MeleeAttackHandler } from '@flyff/combat';
import { RangeAttackHandler } from '@flyff/combat';
import { SkillService } from '@flyff/skills';
import { StatService } from './services/stat.service';
import { UseSkillHandler } from '@flyff/skills';
import { DoUseSkillPointHandler } from '@flyff/skills';
import { ModifyStatusHandler } from './handlers/modifyStatus.handler';
import { ActMsgHandler } from '@flyff/inventory';
import { MoveItemHandler } from '@flyff/inventory';
import { DropItemHandler } from '@flyff/inventory';
import { DropGoldHandler } from '@flyff/inventory';
import { RemoveItemHandler } from '@flyff/inventory';
import { DoEquipHandler } from '@flyff/inventory';
import { EquipService } from '@flyff/inventory';
import { ConsumableService } from '@flyff/inventory';
import { UseItemService } from '@flyff/inventory';
import { EnchantService } from '@flyff/inventory';
import { DoUseItemHandler } from '@flyff/inventory';
import { EnchantHandler } from '@flyff/inventory';
import { BankService } from '@flyff/npc';
import { BankHandler } from '@flyff/npc';
import { TaskBarService } from './services/taskbar.service';
import { TaskBarHandler } from './handlers/taskbar.handler';
import { ShopService } from '@flyff/npc';
import { ShopHandler } from '@flyff/npc';
import { RemoveQuestHandler } from '@flyff/quest';
import { QuestCheckHandler } from '@flyff/quest';
import { QuestHelperHandler } from '@flyff/quest';
import { JournalReplayer } from './systems/journalReplayer';
import { registerReplayers } from './systems/journalReplayers';
import { QuestTrackerSystem } from '@flyff/quest';
import { AISystem } from '@flyff/combat';
import { CheckpointSystem } from './systems/checkpoint.system';
import { RecoverySystem } from './systems/recovery.system';
import { BuffSystem } from './systems/buff.system';
import { PkDecaySystem } from './systems/pkDecay.system';

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
  pkModeService: PkModeService;
  pkModeHandler: PkModeHandler;
  meleeAttackService: MeleeAttackService;
  rangeAttackService: RangeAttackService;
  combatService: CombatService;
  itemManager: ItemManager;
  dropService: DropService;
  playerSetDestObjHandler: PlayerSetDestObjHandler;
  meleeAttackHandler: MeleeAttackHandler;
  rangeAttackHandler: RangeAttackHandler;
  skillService: SkillService;
  statService: StatService;
  useSkillHandler: UseSkillHandler;
  doUseSkillPointHandler: DoUseSkillPointHandler;
  modifyStatusHandler: ModifyStatusHandler;
  actMsgHandler: ActMsgHandler;
  moveItemHandler: MoveItemHandler;
  dropItemHandler: DropItemHandler;
  dropGoldHandler: DropGoldHandler;
  removeItemHandler: RemoveItemHandler;
  doEquipHandler: DoEquipHandler;
  doUseItemHandler: DoUseItemHandler;
  bankHandler: BankHandler;
  shopHandler: ShopHandler;
  taskbarHandler: TaskBarHandler;
  removeQuestHandler: RemoveQuestHandler;
  questCheckHandler: QuestCheckHandler;
  questHelperHandler: QuestHelperHandler;
  journal: Journal;
  journalReplayer: JournalReplayer;
  questTracker: QuestTrackerSystem;
  aiSystem: AISystem;
  checkpointSystem: CheckpointSystem;
  recoverySystem: RecoverySystem;
  buffSystem: BuffSystem;
  pkDecaySystem: PkDecaySystem;
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
  const skillRepo = new SkillRepository(db);

  // WAL journal -- embedded SQLite, opened once per process. Critical mutations
  // (items, gold, exp, level) append here before ack so a crash never dupes or
  // rolls back. Closed on shutdown via index.ts. See rule `04-persistence.md`.
  const journal = new Journal({ path: config.wal.journalPath, logger });
  const journalReplayer = new JournalReplayer({ journal, logger });
  // Register idempotent replay handlers for every WAL event type the services
  // emit (CHAR_EXP / CHAR_GOLD / INVENTORY_SLOT). Payloads are absolute
  // end-state, so recover() can re-apply them on the next boot without dupes.
  registerReplayers(journalReplayer, { charRepo, inventoryRepo, bankRepo, skillRepo, logger });

  // In-memory world state + enter-world stack.
  const playerManager = new PlayerManager();
  const zoneManager = new ZoneManager();
  const clusterListener = new ClusterListener({});
  const snapshotSerializer = new PlayerSnapshotSerializer();
  const setExperienceSerializer = new SetExperienceSerializer();
  const taskbarSerializer = new TaskBarSnapshotSerializer();
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

  // Ambient NPC speech bubbles -- scans spawned NPCs for state-0 `speak`
  // greetings and broadcasts them on the vanilla `CNpcProperty` cadence.
  const npcSpeechService = new NpcSpeechService({
    spawnManager,
    zoneManager,
    dialogs: resources.dialogs,
  });
  npcSpeechService.start();

  // Inventory service -- constructed early so the quest tracker can grant
  // quest-item drops on kill AND questService can evaluate/grant item
  // conditions + rewards through the real bag (questInventory adapter).
  const inventoryService = new InventoryService({
    inventoryRepo, journal,
    getStackSize: (id: number) => resources.items.items.get(id)?.stack_size ?? 1,
  });
  const createItemSerializer = new CreateItemSnapshotSerializer();

  const questService = new QuestService({
    questRepo,
    quests: resources.quests,
    inventoryService,
    createItemSerializer,
    journal,
    inventoryRepo,
  });

  // Phase 6 -- reactive quest tracker (kill/patrol/time + quest-item drops).
  // Self-driven 1 s timer for the time-limit countdown; `onKill`/
  // `onPlayerMoved` are hooks the combat and movement services call
  // (wired in Phase 7 integration).
  const questTracker = new QuestTrackerSystem({
    quests: resources.quests,
    playerManager,
    questRepo,
    inventoryService,
    createItemSerializer,
  });
  questTracker.start();

  // Revival/death loop -- wired before AISystem so the AI tick can hand lethal
  // player damage to `onPlayerDeath` (flag dead + broadcast + open revive dlg).
  const revivalService = new RevivalService({
    charRepo, inventoryRepo, journal, zoneManager, playerManager, zones: resources.zones,
  });

  // Monster idle-wander FSM (C++ CAIMonster::StateIdle). Emits one DESTPOS per
  // new destination; the client walks itself. Monsters only -- town NPCs/guards
  // are skipped. Self-driven 1 s timer; `tick(now)` is public for the future
  // unified 50 ms loop. Stopped on shutdown via index.ts (no leaked timer).
  const aiSystem = new AISystem({
    spawnManager, zoneManager, playerManager,
    onPlayerDeath: (p, killerObjid) => revivalService.onPlayerDeath(p, killerObjid),
  });
  aiSystem.start();

  const joinService = new JoinService({
    charRepo,
    accountRepo,
    questService,
    inventoryRepo,
    bankRepo,
    skillRepo,
    getItem: (id: number) => resources.items.items.get(id),
    playerManager,
    zoneManager,
    handoffSource: clusterListener,
  });
  const joinHandler = new JoinHandler(
    joinService,
    snapshotSerializer,
    setExperienceSerializer,
    taskbarSerializer,
  );

  // Periodic checkpoint -- flush live player position/angle/vitals/stats every
  // 30 s so a hard crash (no graceful logout) loses at most one interval.
  // Graceful disconnect is covered by JoinService.disconnectByCharId. Wired
  // after joinService exists so the closure captures a bound reference.
  const checkpointSystem = new CheckpointSystem({
    flush: () => joinService.flushAll(),
  });
  checkpointSystem.start();

  // Passive HP/MP/FP regen -- C++ `CMover::ProcessRecovery` stand branch. Fires
  // every 3 s for players untouched by combat for 10 s. Self-driven 1 s timer
  // (public `tick(now)` for the future unified 50 ms loop); stopped on shutdown.
  const recoverySystem = new RecoverySystem({ playerManager });
  recoverySystem.start();
  const buffSystem = new BuffSystem({ playerManager, zoneManager });
  const pkDecaySystem = new PkDecaySystem({ playerManager, charRepo });
  buffSystem.start();
  pkDecaySystem.start();

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
  // ItemManager + LootService created before MovementService: movement runs the
  // dest-obj arrival check (v15 pickup has no packet -- client walks to the pile
  // via PLAYERSETDESTOBJ, server loots on arrival) every position update.
  const itemManager = new ItemManager({ zoneManager });
  const lootService = new LootService({ inventoryService, itemManager, playerManager, zoneManager });
  const movementService = new MovementService({
    zoneManager,
    onMoved: (p) => questTracker.onPlayerMoved(p),
    lootService,
  });
  const playerMovedHandler = new PlayerMovedHandler(playerManager, movementService);
  const playerBehaviorHandler = new PlayerBehaviorHandler(playerManager, movementService);

  // Phase 6 -- remaining v15 C->S handlers (chat, motion, target, movement
  // variants, query/getpos, script dialog, revival). See PROGRESS.md for
  // the audit that scoped these.
  const commandService = new CommandService({
    playerManager, spawnManager, questService, journal,
    inventoryService, charRepo, inventoryRepo,
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
  const pkModeService = new PkModeService({ playerManager, zoneManager });
  const pkModeHandler = new PkModeHandler(playerManager, pkModeService);

  const dropService = new DropService({ resources, itemManager });
  const combatService = new CombatService({
    spawnManager, zoneManager, playerManager, charRepo, journal, questTracker, dropService,
    getItem: (id: number) => resources.items.items.get(id),
    // Hand PvP kills to the revival loop (flag victim dead + broadcast + open
    // revive dialog). Mirrors the AISystem `onPlayerDeath` seam.
    onPvpKill: (victim, killerObjid) => revivalService.onPlayerDeath(victim, killerObjid),
  });
  const meleeAttackService = new MeleeAttackService({ zoneManager, combatService });
  const rangeAttackService = new RangeAttackService({ zoneManager, combatService });
  const playerSetDestObjHandler = new PlayerSetDestObjHandler(playerManager, movementService);
  const meleeAttackHandler = new MeleeAttackHandler(playerManager, meleeAttackService);
  const rangeAttackHandler = new RangeAttackHandler(playerManager, rangeAttackService);
  // Skills -- USESKILL cast + DOUSESKILLPOINT learn (v15 damage-skill MVP).
  const skillService = new SkillService({
    skills: resources.skills,
    spawnManager, zoneManager, playerManager, combatService,
    skillRepo, charRepo, journal,
  });
  const useSkillHandler = new UseSkillHandler(playerManager, skillService);
  const doUseSkillPointHandler = new DoUseSkillPointHandler(playerManager, skillService);
  // Stats -- MODIFY_STATUS allocates STR/STA/DEX/INT from m_nRemainGP (OnModifyStatus).
  const statService = new StatService({ playerManager, charRepo, journal });
  const modifyStatusHandler = new ModifyStatusHandler(playerManager, statService);
  // Phase E -- ground-item pickup (PACKETTYPE_ACTMSG / OBJMSG_PICKUP).
  const actMsgHandler = new ActMsgHandler({ playerManager, itemManager, inventoryService });

  // Inventory ops -- move (swap) / drop item / drop gold.
  const moveItemHandler = new MoveItemHandler({ playerManager, inventoryService });
  const dropItemHandler = new DropItemHandler({ playerManager, itemManager, inventoryService });
  const dropGoldHandler = new DropGoldHandler({ playerManager, itemManager, inventoryService });
  const removeItemHandler = new RemoveItemHandler({ playerManager, inventoryService });

  // Equipment -- equip/unequip + stat fold into combat.
  const equipService = new EquipService({
    inventoryRepo, journal,
    getItem: (id: number) => resources.items.items.get(id),
    sendTo: (player, buf) => playerManager.sendTo(player, buf),
  });
  const doEquipHandler = new DoEquipHandler({ playerManager, zoneManager, equipService });

  // Use-item -- DOUSEITEM router (equip / potion+food / buff-skill-warp-text).
  const consumableService = new ConsumableService(inventoryService);
  const useItemService = new UseItemService({
    equipService, consumableService, inventoryService,
    getItem: (id: number) => resources.items.items.get(id),
    potionCooldownMs: config.consumable.potionCooldownMs,
    playerManager, zoneManager,
  });
  const doUseItemHandler = new DoUseItemHandler({ playerManager, zoneManager, useItemService });

  // Enchant -- PACKETTYPE_ENCHANT refine (Sunstone) + element (card). Reuses
  // inventoryService.consume for the material + journals the target slot's
  // absolute end-state (refine/element) for crash-safe WAL recovery.
  const enchantService = new EnchantService({
    inventoryRepo, journal,
    getItem: (id: number) => resources.items.items.get(id),
    consume: (player, slot, count) => inventoryService.consume(player, slot, count),
  });
  const enchantHandler = new EnchantHandler({ playerManager, enchantService });

  // Bank -- open + deposit/withdraw item & gold (account-shared).
  const bankService = new BankService({ bankRepo, inventoryRepo, journal });
  const bankHandler = new BankHandler({ playerManager, bankService });

  // Taskbar -- hotkey shortcut bind/clear. Write-through persists the grid to
  // `characters.taskbar` on every add/remove; hydrate happens in JoinService.
  const taskbarService = new TaskBarService(
    (charId, json) => charRepo.update(charId, { taskbar: json }),
  );
  const taskbarHandler = new TaskBarHandler({ playerManager, taskbarService });

  // NPC vendor shop -- open/close + buy/sell.
  const shopService = new ShopService({
    spawnManager,
    inventoryService,
    getItem: (id: number) => resources.items.items.get(id),
  });
  const shopHandler = new ShopHandler({ playerManager, shopService, createItemSerializer });

  // Phase 4 -- C->S quest handlers (REMOVEQUEST / QUEST_CHECK / QUESTHELPER).
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
    checkpointSystem,
    recoverySystem,
    buffSystem,
    pkDecaySystem,
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
    pkModeService,
    pkModeHandler,
    meleeAttackService,
    rangeAttackService,
    combatService,
    itemManager,
    dropService,
    playerSetDestObjHandler,
    meleeAttackHandler,
    rangeAttackHandler,
    skillService,
    statService,
    useSkillHandler,
    doUseSkillPointHandler,
    modifyStatusHandler,
    actMsgHandler,
    moveItemHandler,
    dropItemHandler,
    dropGoldHandler,
    removeItemHandler,
    doEquipHandler,
    doUseItemHandler,
    enchantHandler,
    bankHandler,
    shopHandler,
    taskbarHandler,
    removeQuestHandler,
    questCheckHandler,
    questHelperHandler,
    journal,
    journalReplayer,
  };
}
