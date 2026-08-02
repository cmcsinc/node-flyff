import { createLogger, type Logger, loadConfig, type WorldServerConfig } from '@flyff/core';
import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
import { createDb, type DbConfig, CharacterRepository, AccountRepository, Journal, QuestRepository, InventoryRepository, BankRepository, SkillRepository, BuffRepository, MailRepository, PresenceRepository, FriendRepository, CampusRepository } from '@flyff/database';
import { ClusterRegistrar } from './ipc/clusterRegistrar';
import { ClusterListener } from './ipc/clusterListener';
import { AdminListener } from './ipc/adminListener';
import { AdminCommandService } from './services/adminCommand.service';
import { MailService, MailHandler } from '@flyff/mail';
import { SetPosSerializer } from './net/snapshot/setPos.serializer';
import { ModifyModeSerializer } from './net/snapshot/modifyMode.serializer';
import { loadAllResources, type ResourceIndex } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import { PlayerManager } from '@flyff/world-core';
import { ZoneManager } from '@flyff/world-core';
import { SpawnManager } from '@flyff/world-core';
import { VisibilityService } from '@flyff/world-core';
import { FlightService } from '@flyff/world-core';
import { PlayerSnapshotSerializer } from './net/snapshot/playerSnapshot.serializer';
import { PeerSnapshotSerializer } from './net/snapshot/peerSnapshot.serializer';
import { SetExperienceSerializer } from '@flyff/combat';
import { SetLevelSerializer } from '@flyff/combat';
import { TaskBarSnapshotSerializer } from './net/snapshot/taskbar.serializer';
import { NpcSnapshotSerializer } from '@flyff/npc';
import { DestObjSerializer } from '@flyff/combat';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';
import { JoinService } from './services/join.service';
import { ChangeJobServiceImpl } from './services/changeJob.service';
import { QuestService } from '@flyff/quest';
import { JoinHandler } from './handlers/join.handler';
import { MapKeyService } from '@flyff/npc';
import { MapKeyHandler } from '@flyff/npc';
import { QueryPlayerDataService } from './services/queryPlayerData.service';
import { QueryPlayerDataHandler } from './handlers/queryPlayerData.handler';
import { SnapshotService } from './services/snapshot.service';
import { SnapshotHandler } from './handlers/snapshot.handler';
import { MovementService } from './services/movement.service';
import { PlayerMovedHandler } from './handlers/playerMoved.handler';
import { PlayerBehaviorHandler } from './handlers/playerBehavior.handler';
import { PlayerBehavior2Handler } from './handlers/playerBehavior2.handler';
import { ChatService } from './services/chat.service';
import { ChatHandler } from './handlers/chat.handler';
import { CommandService } from './services/command.service';
import { MotionService } from './services/motion.service';
import { MotionHandler } from './handlers/motion.handler';
import { MoverFocusService } from './services/moverFocus.service';
import { MoverFocusHandler } from './handlers/moverFocus.handler';
import { GmChatLogService } from './services/gmChatLog.service';
import { GmChatLogHandler } from './handlers/gmChatLog.handler';
import { QueryEquipService } from './services/queryEquip.service';
import { QueryEquipHandler } from './handlers/queryEquip.handler';
import { CheerService } from './services/cheer.service';
import { CheeringHandler } from './handlers/cheering.handler';
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
import { DuelService } from '@flyff/combat';
import { DuelManager } from '@flyff/combat';
import { DuelHandler } from '@flyff/combat';
import { PartyManager } from '@flyff/party';
import { PartyService } from '@flyff/party';
import { PartyHandler } from '@flyff/party';
import { DropService } from '@flyff/inventory';
import { InventoryService } from '@flyff/inventory';
import { LootService } from '@flyff/inventory';
import { ItemManager } from '@flyff/inventory';
import { VISIBILITY_RADIUS, TID_EVE_ENDQUEST } from '@flyff/world-core';
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
import { RepairService } from '@flyff/inventory';
import { RepairHandler } from '@flyff/inventory';
import { TradeService } from '@flyff/inventory';
import { TradeHandler } from '@flyff/inventory';
import { VendorService } from '@flyff/inventory';
import { VendorHandler } from '@flyff/inventory';
import { FriendService, FriendHandler, CampusService, CampusHandler, CAMPUS_BUFF_BY_LEVEL } from '@flyff/social';
import { BankService } from '@flyff/npc';
import { BankHandler } from '@flyff/npc';
import { TaskBarService } from './services/taskbar.service';
import { TaskBarHandler } from './handlers/taskbar.handler';
import { EndSkillQueueHandler } from './handlers/endSkillQueue.handler';
import { ReqLeaveHandler } from './handlers/reqLeave.handler';
import { SkillTaskBarHandler } from './handlers/skillTaskbar.handler';
import { ShopService } from '@flyff/npc';
import { ShopHandler } from '@flyff/npc';
import { NpcBuffService } from '@flyff/npc';
import { NpcBuffHandler } from '@flyff/npc';
import { RemoveQuestHandler } from '@flyff/quest';
import { QuestCheckHandler } from '@flyff/quest';
import { QuestHelperHandler } from '@flyff/quest';
import { NoticeSerializer, buildGoldText, buildDefinedText } from './net/snapshot/notice.serializer';
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
  adminListener: AdminListener;
  adminCommandService: AdminCommandService;
  mailService: MailService;
  mailHandler: MailHandler;
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
  visibilityService: VisibilityService;
  queryPlayerDataService: QueryPlayerDataService;
  queryPlayerDataHandler: QueryPlayerDataHandler;
  snapshotService: SnapshotService;
  snapshotHandler: SnapshotHandler;
  movementService: MovementService;
  playerMovedHandler: PlayerMovedHandler;
  playerBehaviorHandler: PlayerBehaviorHandler;
  playerBehavior2Handler: PlayerBehavior2Handler;
  chatService: ChatService;
  chatHandler: ChatHandler;
  commandService: CommandService;
  motionService: MotionService;
  motionHandler: MotionHandler;
  moverFocusService: MoverFocusService;
  moverFocusHandler: MoverFocusHandler;
  gmChatLogService: GmChatLogService;
  gmChatLogHandler: GmChatLogHandler;
  queryEquipService: QueryEquipService;
  queryEquipHandler: QueryEquipHandler;
  cheerService: CheerService;
  cheeringHandler: CheeringHandler;
  tradeService: TradeService;
  tradeHandler: TradeHandler;
  friendService: FriendService;
  friendHandler: FriendHandler;
  campusService: CampusService;
  campusHandler: CampusHandler;
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
  lootService: LootService;
  dropService: DropService;
  playerSetDestObjHandler: PlayerSetDestObjHandler;
  meleeAttackHandler: MeleeAttackHandler;
  rangeAttackHandler: RangeAttackHandler;
  duelHandler: DuelHandler;
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
  npcBuffHandler: NpcBuffHandler;
  taskbarHandler: TaskBarHandler;
  endSkillQueueHandler: EndSkillQueueHandler;
  reqLeaveHandler: ReqLeaveHandler;
  skillTaskbarHandler: SkillTaskBarHandler;
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
  const buffRepo = new BuffRepository(db);
  const mailRepo = new MailRepository(db);
  const presenceRepo = new PresenceRepository(db);
  const friendRepo = new FriendRepository(db);
  const campusRepo = new CampusRepository(db);
  // A hard crash leaves this process's presence rows behind. Clearing them at
  // boot means the admin panel never shows a ghost as online for the 60 s the
  // staleness window would otherwise take to expire them.
  void presenceRepo
    .clearByServer(config.server.id)
    .catch((err: unknown) => logger.warn({ err }, 'stale presence cleanup failed'));

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
  const peerSnapshotSerializer = new PeerSnapshotSerializer();

  // SpawnManager <-> VisibilityService is mutually referential: spawn/despawn
  // must go through the visibility tracker (so `m_known` stays truthful), and
  // the tracker queries the spawn table for the zone's movers. The slot breaks
  // the construction cycle -- both callbacks fire only after both exist.
  const visibilitySlot: { svc: VisibilityService | null } = { svc: null };

  // Boot the spawn table before the TCP listener opens so the first JOIN sees a
  // populated zone. Static NPCs (with outfit) + monster spawn points come from
  // the loaded zone YAML + mover resource index.
  const spawnManager = new SpawnManager({
    resources,
    // Respawn: ADD_OBJ to in-range players that don't already know the mover.
    onSpawn: (mover) => visibilitySlot.svc?.onMoverSpawn(mover),
    // Corpse despawn: after CORPSE_DESPAWN_MS, DEL_OBJ to everyone tracking it.
    onDespawn: (mover) => visibilitySlot.svc?.onMoverDespawn(mover),
  });
  const visibilityService = new VisibilityService({
    playerManager, zoneManager, spawnManager,
    buildAddMovers: (movers) => npcSnapshotSerializer.build(movers),
    buildAddPeers: (players) => peerSnapshotSerializer.build(players),
    buildRemove: (objids) => peerSnapshotSerializer.buildRemove(objids),
  });
  visibilitySlot.svc = visibilityService;
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

  // Item-acquire chat-line notifier (SNAPSHOTTYPE_TEXT). v19 C++ sends no
  // item-name text on pickup or quest reward -- only CREATEITEM + sound -- so
  // this is an emulator-side addition for a visible "you acquired X" log line.
  // Shared by LootService (ground piles) and QuestService (reward items).
  const noticeSerializer = new NoticeSerializer();
  const notifyItemAcquire = (player: CPlayer, itemId: number, count: number) => {
    const name = resources.items.items.get(itemId)?.name ?? `Item ${itemId}`;
    playerManager.sendTo(player, noticeSerializer.build(count > 1 ? `${name} x${count}` : name));
  };
  // `TID_GAME_TROUPEREAPITEM` equivalent: tell a party peer who received a
  // distributed drop. Same emulator-side text channel as `notifyItemAcquire`.
  const notifyPeerItemAcquire = (
    peer: CPlayer, receiver: CPlayer, itemId: number, count: number,
  ) => {
    const name = resources.items.items.get(itemId)?.name ?? `Item ${itemId}`;
    const label = count > 1 ? `${name} x${count}` : name;
    playerManager.sendTo(peer, noticeSerializer.build(`${receiver.m_szName}: ${label}`));
  };

  const questSetLevelSerializer = new SetLevelSerializer();
  const questService = new QuestService({
    questRepo,
    quests: resources.quests,
    inventoryService,
    createItemSerializer,
    journal,
    inventoryRepo,
    // Quest-reward exp gains broadcast SETEXPERIENCE (self) + SETLEVEL
    // (vicinity, level-up only) so the bar updates live. Matches the C++
    // AddExperienceSolo tail (Mover.cpp:6254 + LevelUpSetting -> AddSetLevel).
    onExpGain: (player, leveled) => {
      playerManager.sendTo(player, setExperienceSerializer.build(player.m_idPlayer, {
        exp: player.m_nExp, level: player.m_nLevel,
        skillLevel: player.m_nSkillLevel, skillPoint: player.m_nSkillPoint,
      }));
      if (leveled) {
        zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          questSetLevelSerializer.build(player.m_idPlayer, player.m_nLevel),
          player,
        );
      }
    },
    onItemReward: (player, itemId, count) => notifyItemAcquire(player, itemId, count),
    // C++ `__SetQuestState` on QS_END emits AddDefinedText(TID_EVE_ENDQUEST,
    // "\"%s\"", title) (ScriptHelper.cpp:895). Resolve the quest's IDS title
    // token to display text + wrap in literal quotes exactly as the C++
    // vsnprintf("\"%s\"", title) does.
    onComplete: (player, _questId, titleToken) => {
      const title = resources.questText.get(titleToken) ?? titleToken;
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, TID_EVE_ENDQUEST, `"${title}"`));
    },
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
    visibilityService,
  });

  // Monster idle-wander FSM (C++ CAIMonster::StateIdle). Emits one DESTPOS per
  // new destination; the client walks itself. Monsters only -- town NPCs/guards
  // are skipped. Self-driven 1 s timer; `tick(now)` is public for the future
  // unified 50 ms loop. Stopped on shutdown via index.ts (no leaked timer).
  const aiSystem = new AISystem({
    spawnManager, zoneManager, playerManager,
    // v19 RA_SAFETY gate: true if the target's position is inside any of the
    // zone's `regions` tagged `type: safe` (AABB check on the ground plane).
    // Backed by `worlds/zones/*.yml` -> `resources.zones.byNumericId`.
    safeZone: (zoneId, pos) => {
      const z = resources.zones.byNumericId.get(zoneId);
      if (!z?.regions) return false;
      for (const r of z.regions) {
        if (r.type !== 'safe') continue;
        const b = r.bounds;
        if (pos.x >= b.min.x && pos.x <= b.max.x
          && pos.z >= b.min.z && pos.z <= b.max.z) return true;
      }
      return false;
    },
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
    buffRepo,
    skills: resources.skills,
    getItem: (id: number) => resources.items.items.get(id),
    getSetItem: (id: number) => resources.setItems.byItemId.get(id),
    playerManager,
    zoneManager,
    handoffSource: clusterListener,
    presenceRepo,
    serverId: config.server.id,
    // mailHandler is constructed further down (it needs inventoryService).
    // Wrapped in a closure so the reference resolves at call time, after
    // compose() has returned -- never during this constructor.
    mailHandler: { sendMailBox: (player: CPlayer) => mailHandler.sendMailBox(player) },
    // Same late-resolution trick: friendService/campusService are composed below.
    // Friend first -- the roster blob is what makes the messenger window usable.
    socialJoin: async (player: CPlayer) => {
      await friendService.onJoin(player);
      await campusService.onJoin(player);
    },
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

  const cheerService = new CheerService({
    playerManager, zoneManager,
    getItemProp: (id: number) => resources.items.items.get(id),
  });
  // Passive HP/MP/FP regen -- C++ `CMover::ProcessRecovery` stand branch. Fires
  // every 3 s for players untouched by combat for 10 s. Self-driven 1 s timer
  // (public `tick(now)` for the future unified 50 ms loop); stopped on shutdown.
  // Also drives `CMover::CheckTickCheer` (cheer-point regen, Mover.cpp:9069) --
  // C++ calls it from the same per-user tick (User.cpp:438).
  // Campus point regen rides the recovery loop, as C++ drives
  // `RecoveryCampusPoint` from the same per-user tick as `ProcessRecovery`
  // (`WORLDSERVER/User.cpp:432-433`). Late-bound -- campusService is built below.
  const campusRecoverSlot: { fn: ((p: CPlayer, now: number) => void) | null } = { fn: null };
  const recoverySystem = new RecoverySystem({
    playerManager, cheerService,
    campusService: { recoverPoints: (p, now) => campusRecoverSlot.fn?.(p, now) },
  });
  recoverySystem.start();
  const buffSystem = new BuffSystem({ playerManager, zoneManager });
  const pkDecaySystem = new PkDecaySystem({ playerManager, charRepo });
  buffSystem.start();
  pkDecaySystem.start();

  const mapKeyService = new MapKeyService({ playerManager });
  const mapKeyHandler = new MapKeyHandler(mapKeyService, visibilityService);
  const queryPlayerDataService = new QueryPlayerDataService({ playerManager });
  const queryPlayerDataHandler = new QueryPlayerDataHandler(queryPlayerDataService);

  // In-world movement + peer-broadcast handlers (Phases 3-5).
  const snapshotService = new SnapshotService({ zoneManager, playerManager, visibilityService });
  const snapshotHandler = new SnapshotHandler(playerManager, snapshotService);
  // ItemManager + LootService created before MovementService: movement runs the
  // dest-obj arrival check (v19 pickup has no packet -- client walks to the pile
  // via PLAYERSETDESTOBJ, server loots on arrival) every position update.
  const itemManager = new ItemManager({ zoneManager });
  // Party -- created before LootService + CombatService so the loot-share
  // (sameParty) and exp-share (partyExp) seams can close over the party
  // manager / service. `grantExpAmount` is bound to CombatService, which is
  // built further below; capture it via a slot that's filled once combat exists.
  const partyManager = new PartyManager();
  const combatGrantSlot: { fn: ((p: CPlayer, amount: number) => void) | null } = { fn: null };
  // CampusService is composed after CombatService (it needs the repos wired
  // below), so the level-up seam is late-bound the same way `combatGrantSlot` is.
  const campusLevelUpSlot: { fn: ((p: CPlayer) => void) | null } = { fn: null };
  const partyService = new PartyService({
    playerManager, partyManager,
    grantExpAmount: (p, amount) => combatGrantSlot.fn!(p, amount),
  });
  // Shared same-party predicate: loot ownership (IsLoot), the combat hit-share
  // pooling, and anything else that asks "are these two in one party".
  const sameParty = (a: number, b: number): boolean => {
    const pa = partyManager.getByMember(a);
    return pa !== undefined && pa.members.includes(b);
  };
  const lootService = new LootService({
    inventoryService, itemManager, playerManager, zoneManager,
    onAcquireItem: (player, itemId, count) => notifyItemAcquire(player, itemId, count),
    onPeerAcquireItem: notifyPeerItemAcquire,
    onGoldPickup: (player, plus, total) =>
      playerManager.sendTo(player, buildGoldText(player.m_idPlayer, plus, total)),
    sameParty,
    // Party item/gold distribution (`SubLootDropMobParty` + `PickupGold` party
    // branch). PartyService satisfies the structural `PartyLootShare` surface.
    party: partyService,
  });
  const movementService = new MovementService({
    zoneManager,
    onMoved: (p) => questTracker.onPlayerMoved(p),
    lootService,
    visibilityService,
  });
  const playerMovedHandler = new PlayerMovedHandler(playerManager, movementService);
  const playerBehaviorHandler = new PlayerBehaviorHandler(playerManager, movementService);

  // Phase 6 -- remaining v19 C->S handlers (chat, motion, target, movement
  // variants, query/getpos, script dialog, revival). See PROGRESS.md for
  // the audit that scoped these.
  const commandService = new CommandService({
    playerManager, spawnManager, questService, journal,
    inventoryService, charRepo, inventoryRepo, zoneManager, visibilityService,
    getItemByName: (name: string) => resources.items.byName.get(name),
    // `/cn <id|name>` -- C++ tries `GetMoverPropEx(id)` on a numeric token,
    // else `GetMoverProp(name)` (FuncTextCmd.cpp:2940-2946).
    lookupMover: (token: string) => {
      const id = Number.parseInt(token, 10);
      return Number.isInteger(id) && String(id) === token
        ? resources.movers.movers.get(id)
        : resources.movers.byName.get(token);
    },
  });
  const chatService = new ChatService({ zoneManager, commandService });
  const chatHandler = new ChatHandler(playerManager, chatService);
  const motionService = new MotionService({ zoneManager });
  const motionHandler = new MotionHandler(playerManager, motionService);
  const moverFocusService = new MoverFocusService({ playerManager });
  const moverFocusHandler = new MoverFocusHandler(playerManager, moverFocusService);
  const gmChatLogService = new GmChatLogService();
  const gmChatLogHandler = new GmChatLogHandler(playerManager, gmChatLogService);
  const queryEquipService = new QueryEquipService({ playerManager, zoneManager });
  const queryEquipHandler = new QueryEquipHandler(playerManager, queryEquipService);
  const cheeringHandler = new CheeringHandler(playerManager, cheerService);
  const targetService = new TargetService({ spawnManager });
  const setTargetHandler = new SetTargetHandler(playerManager, targetService);
  const leaveHandler = new LeaveHandler();
  const playerCorrHandler = new PlayerCorrHandler(playerManager, movementService);
  const playerMoved2Handler = new PlayerMoved2Handler(playerManager, movementService);
  const playerBehavior2Handler = new PlayerBehavior2Handler(playerManager, movementService);
  const playerAngleHandler = new PlayerAngleHandler(playerManager, movementService);
  const queryGetPosService = new QueryGetPosService();
  const queryGetPosHandler = new QueryGetPosHandler(playerManager, queryGetPosService);
  const queryGetDestObjService = new QueryGetDestObjService(playerManager, new DestObjSerializer());
  const queryGetDestObjHandler = new QueryGetDestObjHandler(playerManager, queryGetDestObjService);
  const getPosHandler = new GetPosHandler(playerManager, movementService);
  // Stats -- MODIFY_STATUS allocates STR/STA/DEX/INT from m_nRemainGP (OnModifyStatus).
  // Declared here (ahead of the skill handlers that follow) because
  // ChangeJobServiceImpl needs it for the `InitStat()` dialog call.
  const statService = new StatService({ playerManager, charRepo, journal });
  const changeJobService = new ChangeJobServiceImpl({
    charRepo, skills: resources.skills, playerManager, zoneManager, journal, statService,
  });
  const scriptDlgService = new ScriptDlgService({
    spawnManager, dialogs: resources.dialogs, quests: resources.quests, questService,
    defines: resources.defines, questText: resources.questText,
    changeJobService,
  });
  const scriptDlgHandler = new ScriptDlgHandler(playerManager, scriptDlgService);
  const revivalHandler = new RevivalHandler(playerManager, revivalService);
  const pkModeService = new PkModeService({ playerManager, zoneManager });
  const pkModeHandler = new PkModeHandler(playerManager, pkModeService);

  // `needsItem` lets a slot skip the level-difference nerf when the killer has
  // an unsatisfied `SetEndCondItem` for that item -- quest pieces stay farmable
  // after you out-level the mob (C++ regular-drop roll has no level term).
  const dropService = new DropService({
    resources, itemManager,
    // A thunk, not a value: a GM changing the rate at runtime (or a future
    // hot-reload of world config) takes effect on the next kill, no restart.
    rates: () => ({ dropRate: config.world.dropRate, goldRate: config.world.goldRate }),
    needsItem: (killer, itemId) => questTracker.needsItem(killer, itemId),
  });
  // Duel manager + service -- created before CombatService so the PvP-kill seam
  // can clear active-duel flags on a lethal blow (in addition to revival).
  const duelManager = new DuelManager();
  const duelService = new DuelService({ playerManager, duelManager });
  const combatService = new CombatService({
    spawnManager, zoneManager, playerManager, charRepo, journal, questTracker, dropService,
    getItem: (id: number) => resources.items.items.get(id),
    // Hand PvP kills to the revival loop (flag victim dead + broadcast + open
    // revive dialog) AND tear down any active duel. Mirrors the AISystem
    // `onPlayerDeath` seam.
    onPvpKill: (victim, killerObjid) => {
      revivalService.onPlayerDeath(victim, killerObjid);
      duelService.onPlayerDeath(victim);
    },
    // Party exp-share seam -- delegates to PartyService.distributeExp, which
    // splits the kill exp among nearby party members (proximity + level gate).
    // Returns null when the killer has no party -> combat runs its solo grant.
    partyExp: (killer, mover, baseExp) => partyService.distributeExp(killer, mover, baseExp),
    // Pools co-party attackers' recorded damage into one share before the split.
    sameParty,
    // Campus reward + graduation on level-up (CCampusHelper::SetLevelUpReward).
    onLevelUp: (player) => campusLevelUpSlot.fn?.(player),
  });
  // Fill the late-bound exp-applier slot so party share routes through the
  // SAME grantExpAmount path as solo kills (one exp-application code path).
  combatGrantSlot.fn = (p, amount) => combatService.grantExpAmount(p, amount);
  const meleeAttackService = new MeleeAttackService({ zoneManager, combatService });
  const rangeAttackService = new RangeAttackService({ zoneManager, combatService });
  const playerSetDestObjHandler = new PlayerSetDestObjHandler(playerManager, movementService);
  const meleeAttackHandler = new MeleeAttackHandler(playerManager, meleeAttackService);
  const rangeAttackHandler = new RangeAttackHandler(playerManager, rangeAttackService);
  const duelHandler = new DuelHandler({ playerManager, duelService });
  const partyHandler = new PartyHandler({ playerManager, partyService });
  // Skills -- USESKILL cast + DOUSESKILLPOINT learn (v19 damage-skill MVP).
  const skillService = new SkillService({
    skills: resources.skills,
    spawnManager, zoneManager, playerManager, combatService,
    skillRepo, charRepo, journal,
  });
  const useSkillHandler = new UseSkillHandler(playerManager, skillService);
  const doUseSkillPointHandler = new DoUseSkillPointHandler(playerManager, skillService);
  // MODIFY_STATUS allocation handler -- `statService` is created earlier (it is a
  // dependency of ChangeJobServiceImpl's `InitStat()` path).
  const modifyStatusHandler = new ModifyStatusHandler(playerManager, statService);
  // Phase E -- ground-item pickup (PACKETTYPE_ACTMSG / OBJMSG_PICKUP).
  const actMsgHandler = new ActMsgHandler({ playerManager, itemManager, inventoryService });

  // Inventory ops -- move (swap) / drop item / drop gold.
  const moveItemHandler = new MoveItemHandler({ playerManager, inventoryService });
  const dropItemHandler = new DropItemHandler({ playerManager, itemManager, inventoryService });
  const dropGoldHandler = new DropGoldHandler({ playerManager, itemManager, inventoryService });
  const removeItemHandler = new RemoveItemHandler({ playerManager, inventoryService });

  // Flight is the PARTS_RIDE equip side effect: board/broom mount gate +
  // OBJSTAF_FLY transition. No separate mount system exists in v19.
  const flightService = new FlightService({ zones: resources.zones });

  // Equipment -- equip/unequip + stat fold into combat.
  const equipService = new EquipService({
    inventoryRepo, journal,
    getItem: (id: number) => resources.items.items.get(id),
    getSetItem: (id: number) => resources.setItems.byItemId.get(id),
    sendTo: (player, buf) => playerManager.sendTo(player, buf),
    broadcastAround: (player, buf) =>
      zoneManager.broadcastAround(player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, buf),
    flight: flightService,
  });
  const doEquipHandler = new DoEquipHandler({
    playerManager, zoneManager, equipService,
    getItem: (id: number) => resources.items.items.get(id),
    isFlightSpeedValid: (prop, claimed) => flightService.isFlightSpeedValid(prop, claimed),
    notify: (player, tid) => playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
  });

  // Use-item -- DOUSEITEM router (equip / potion+food / buff-skill-warp-text).
  const consumableService = new ConsumableService(inventoryService);
  const useItemService = new UseItemService({
    equipService, consumableService, inventoryService,
    getItem: (id: number) => resources.items.items.get(id),
    potionCooldownMs: config.consumable.potionCooldownMs,
    playerManager, zoneManager,
  });
  const doUseItemHandler = new DoUseItemHandler({
    playerManager, zoneManager, useItemService,
    getItem: (id: number) => resources.items.items.get(id),
    isFlightSpeedValid: (prop, claimed) => flightService.isFlightSpeedValid(prop, claimed),
    notify: (player, tid) => playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
  });

  // Enchant -- PACKETTYPE_ENCHANT refine (Sunstone) + element (card). Reuses
  // inventoryService.consume for the material + journals the target slot's
  // absolute end-state (refine/element) for crash-safe WAL recovery.
  const enchantService = new EnchantService({
    inventoryRepo, journal,
    getItem: (id: number) => resources.items.items.get(id),
    consume: (player, slot, count) => inventoryService.consume(player, slot, count),
  });
  const enchantHandler = new EnchantHandler({ playerManager, enchantService });

  // Repair -- PACKETTYPE_REPAIRITEM bulk blacksmith fix. Reuses the inventory
  // stat/persist primitives; journals each repaired slot's absolute end-state.
  const repairService = new RepairService({
    inventoryRepo, journal,
    getItem: (id: number) => resources.items.items.get(id),
    spendGold: (player, amount) => inventoryService.spendGold(player, amount),
  });
  const repairHandler = new RepairHandler({ playerManager, repairService });

  // Trade -- the 10-opcode CVTInfo state machine. Items stay in the bag until
  // commit (re-validated then); gold is debited at stake time and refunded by
  // every abort path, so TradeService.onDisconnect must run on leave.
  const tradeService = new TradeService({
    playerManager, inventoryRepo, journal,
    getItemProp: (id: number) => resources.items.items.get(id),
    sendDefinedText: (player, tid) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
  });
  const tradeHandler = new TradeHandler(playerManager, tradeService);

  // Vendor (private shop) -- the 6-opcode CVTInfo vendor half, sibling of
  // trade. In-memory only; the shop closes on disconnect, so
  // VendorService.onDisconnect must run on leave (next to trade's).
  const vendorService = new VendorService({
    playerManager, zoneManager, inventoryService,
    getItemProp: (id: number) => resources.items.items.get(id),
    sendDefinedText: (player, tid) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
  });
  const vendorHandler = new VendorHandler(playerManager, vendorService);

  // Friend roster (CRTMessenger) -- 6 opcodes + presence pushes. Roster edges are
  // written through immediately (no WAL, matching C++ which has no batch save).
  const friendService = new FriendService({
    playerManager, friendRepo, charRepo,
    sendDefinedText: (player, tid, args) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, args ?? '')),
  });
  const friendHandler = new FriendHandler(playerManager, friendService);

  // Campus / mentoring (CCampusHelper) -- 4 client opcodes. C++ round-trips every
  // mutation through the DB server; with one process the service writes directly
  // but keeps the persist-then-notify order.
  const campusService = new CampusService({
    playerManager, campusRepo, charRepo,
    isQuestComplete: (player, questId) => player.isCompleteQuest(questId),
    applyCampusBuff: (player, itemId) => {
      // IK3_TS_BUFF campus buff -- rides the existing item-buff path. The buff
      // items (II_TS_BUFF_POWER_LOVE01-03) carry their own DST effects.
      const prop = resources.items.items.get(itemId);
      if (!prop?.effects?.length) return;
      const effects = prop.effects.map((e) =>
        e.chg === undefined ? { dst: e.dst, adj: e.adj } : { dst: e.dst, adj: e.adj, chg: e.chg });
      player.m_buffs.addItemBuff(itemId, (prop.duration ?? 0) * 1_000, effects, Date.now());
    },
    removeCampusBuff: (player) => {
      for (const id of Object.values(CAMPUS_BUFF_BY_LEVEL)) player.m_buffs.remove(id);
    },
    sendDefinedText: (player, tid, args) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, args ?? '')),
  });
  const campusHandler = new CampusHandler(playerManager, campusService);
  // Close the level-up seam now that campusService exists. Fire-and-forget: a
  // reward write must never block or reject the exp grant that triggered it.
  campusRecoverSlot.fn = (player: CPlayer, now: number) => {
    void campusService.recoverPoints(player, now)
      .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer },
        'campus point recovery failed'));
  };
  campusLevelUpSlot.fn = (player: CPlayer) => {
    void campusService.onLevelUp(player)
      .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer },
        'campus level-up reward failed'));
  };
  // Boot-time campus load -- the equivalent of the DB server pushing
  // PACKETTYPE_CAMPUS_ALL into each world. Fire-and-forget: an empty campus map
  // is a valid state, and a failure must not block the listener.
  void campusService.bootstrap()
    .catch((err: unknown) => logger.warn({ err }, 'campus bootstrap failed'));

  // Bank -- open + deposit/withdraw item & gold (account-shared).
  const bankService = new BankService({ bankRepo, inventoryRepo, journal });
  const bankHandler = new BankHandler({ playerManager, bankService });

  // Taskbar -- hotkey shortcut bind/clear. Write-through persists the grid to
  // `characters.taskbar` on every add/remove; hydrate happens in JoinService.
  const taskbarService = new TaskBarService(
    (charId, json) => charRepo.update(charId, { taskbar: json }),
  );
  const taskbarHandler = new TaskBarHandler({ playerManager, taskbarService });
  const endSkillQueueHandler = new EndSkillQueueHandler(playerManager);
  const reqLeaveHandler = new ReqLeaveHandler(playerManager);
  const skillTaskbarHandler = new SkillTaskBarHandler({ playerManager, taskbarService });

  // NPC vendor shop -- open/close + buy/sell.
  const shopService = new ShopService({
    spawnManager,
    inventoryService,
    getItem: (id: number) => resources.items.items.get(id),
    shopCostRate: config.world.shopCostRate,
  });
  const shopHandler = new ShopHandler({ playerManager, shopService, createItemSerializer });

  // NPC buff-pang (__NPC_BUFF) -- applies a configured skill list on right-click.
  const npcBuffService = new NpcBuffService({
    spawnManager,
    characterInc: resources.characterInc,
    skills: resources.skills,
    skillService,
  });
  const npcBuffHandler = new NpcBuffHandler(playerManager, npcBuffService);

  // Phase 4 -- C->S quest handlers (REMOVEQUEST / QUEST_CHECK / QUESTHELPER).
  const removeQuestHandler = new RemoveQuestHandler(playerManager, questService);
  const questCheckHandler = new QuestCheckHandler(playerManager, questService);
  const questHelperHandler = new QuestHelperHandler(playerManager, spawnManager);

  // Mail (post) -- admin->player only. The mailbox is pulled by the client
  // (QUERYMAILBOX on window open) and pushed on JOIN / after an admin insert.
  // MODE_MAILBOX is the only new-mail indicator (no push packet in vanilla).
  const mailService = new MailService({ mailRepo, inventoryService });
  const modifyModeSerializer = new ModifyModeSerializer();
  const adminSetPosSerializer = new SetPosSerializer();
  const mailHandler = new MailHandler({
    playerManager,
    mailService,
    onModeChanged: (player, mode) =>
      playerManager.broadcastAll(modifyModeSerializer.build(player.m_idPlayer, mode)),
  });

  // Admin-panel commands over `admin:command` (HMAC-signed via IpcBus). The
  // route in @flyff/admin is the only authorization gate -- the world trusts
  // any correctly-signed envelope (see adminListener's security note).
  const adminCommandService = new AdminCommandService({
    playerManager,
    setPosSer: adminSetPosSerializer,
    zones: resources.zones,
    refreshVisibility: (player) => visibilityService.refresh(player.m_idPlayer, true),
    mailHandler,
    // Only `kickAll` uses this -- single kicks let the socket-close hook flush.
    saveAndLeave: (charId) => joinService.disconnectByCharId(charId),
    // Mirrors the dispatcher's onDisconnect hook (index.ts). `saveAndLeave`
    // removes the player from PlayerManager, so the hook that fires on the
    // deferred socket close can no longer resolve them -- without this, a drain
    // skips the trade gold refund and the staked penya is lost on replay.
    beforeLeave: (player) => {
      partyService.onDisconnect(player);
      tradeService.onDisconnect(player);
      vendorService.onDisconnect(player);
      friendService.onDisconnect(player.m_idPlayer);
      campusService.onDisconnect(player.m_idPlayer);
      visibilityService.remove(player);
    },
  });
  const adminListener = new AdminListener({ sink: adminCommandService });

  return {
    config,
    logger,
    clusterRegistrar,
    clusterListener,
    adminListener,
    adminCommandService,
    mailService,
    mailHandler,
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
    visibilityService,
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
    moverFocusService,
    moverFocusHandler,
    gmChatLogService,
    gmChatLogHandler,
    queryEquipService,
    queryEquipHandler,
    cheerService,
    cheeringHandler,
    targetService,
    setTargetHandler,
    leaveHandler,
    playerCorrHandler,
    playerMoved2Handler,
    playerBehavior2Handler,
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
    lootService,
    dropService,
    playerSetDestObjHandler,
    meleeAttackHandler,
    rangeAttackHandler,
    duelHandler,
    partyManager,
    partyService,
    partyHandler,
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
    repairHandler,
    tradeService,
    tradeHandler,
    vendorService,
    vendorHandler,
    friendService,
    friendHandler,
    campusService,
    campusHandler,
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
    journal,
    journalReplayer,
  };
}
