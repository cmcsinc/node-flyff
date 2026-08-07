import { createLogger, type Logger, loadConfig, type WorldServerConfig } from '@flyff/core';
import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
import { createDb, type DbConfig, CharacterRepository, AccountRepository, Journal, QuestRepository, InventoryRepository, BankRepository, SkillRepository, BuffRepository, MailRepository, PresenceRepository, FriendRepository, CampusRepository, PartyRepository, GuildRepository, GuildBankRepository, GuildWarRepository, GuildQuestRepository } from '@flyff/database';
import { ClusterRegistrar } from './ipc/clusterRegistrar';
import { ClusterListener } from './ipc/clusterListener';
import { AdminListener } from './ipc/adminListener';
import { AdminCommandService } from './services/adminCommand.service';
import { MailService, MailHandler } from '@flyff/mail';
import { SetPosSerializer } from './net/snapshot/setPos.serializer';
import { ModifyModeSerializer } from './net/snapshot/modifyMode.serializer';
import { loadAllResources, type ResourceIndex } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import { AUTH, hasAuthority } from '@flyff/entities';
import { PlayerManager } from '@flyff/world-core';
import { ZoneManager } from '@flyff/world-core';
import { SpawnManager } from '@flyff/world-core';
import { VisibilityService } from '@flyff/world-core';
import { buildStateMode } from '@flyff/world-core';
import { MAX_INVENTORY } from '@flyff/world-core';
import { MAX_GOLD } from '@flyff/core/constants/limits';
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
import { DestPollService } from './services/destPoll.service';
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
import { StateModeHandler } from './handlers/stateMode.handler';
import { MeleeAttackService } from '@flyff/combat';
import { RangeAttackService } from '@flyff/combat';
import { CombatService } from '@flyff/combat';
import { DuelService } from '@flyff/combat';
import { DuelManager } from '@flyff/combat';
import { DuelHandler } from '@flyff/combat';
import { PartyManager } from '@flyff/party';
import { PartyService } from '@flyff/party';
import { PartyHandler } from '@flyff/party';
import { GuildManager } from '@flyff/guild';
import { GuildWarManager, GuildWarService } from '@flyff/guild';
import { GuildQuestProcessor, GuildQuestService } from '@flyff/guild';
import { GuildService } from '@flyff/guild';
import { GuildHandler } from '@flyff/guild';
import { GuildContributionService, IK3_GEM, type GemStack } from '@flyff/guild';
import { GuildBankService } from '@flyff/guild';
import { GuildSalarySystem } from './systems/guildSalary.system';
import { GuildWarSystem } from './systems/guildWar.system';
import { GuildQuestSystem } from './systems/guildQuest.system';
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
import { BlinkwingService } from '@flyff/inventory';
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
import { BlinkwingSystem } from './systems/blinkwing.system';
import { PkDecaySystem } from './systems/pkDecay.system';
import { PetSystem } from './systems/pet.system';

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
  destPollService: DestPollService;
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
  stateModeHandler: StateModeHandler;
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
  // Present in the returned object since their features shipped but never added
  // to this interface, so `index.ts` could not destructure them (and the
  // handlers were silently missing from `buildWorldClientServer`).
  enchantHandler: EnchantHandler;
  repairHandler: RepairHandler;
  vendorService: VendorService;
  vendorHandler: VendorHandler;
  partyManager: PartyManager;
  partyService: PartyService;
  partyHandler: PartyHandler;
  guildManager: GuildManager;
  guildService: GuildService;
  guildContributionService: GuildContributionService;
  guildBankService: GuildBankService;
  guildHandler: GuildHandler;
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
  guildSalarySystem: GuildSalarySystem;
  guildWarManager: GuildWarManager;
  guildWarService: GuildWarService;
  guildWarSystem: GuildWarSystem;
  guildQuestProcessor: GuildQuestProcessor;
  guildQuestService: GuildQuestService;
  guildQuestSystem: GuildQuestSystem;
  blinkwingSystem: BlinkwingSystem;
  blinkwingService: BlinkwingService;
  pkDecaySystem: PkDecaySystem;
  petSystem: PetSystem;
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
  const partyRepo = new PartyRepository(db);
  const guildRepo = new GuildRepository(db);
  const guildBankRepo = new GuildBankRepository(db);
  const guildWarRepo = new GuildWarRepository(db);
  const guildQuestRepo = new GuildQuestRepository(db);
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
    getItem: (id: number) => resources.items.items.get(id),
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
      // Durable party (migration 022): re-push the roster to a returning member
      // and flip their PP_REMOVE flag back to online for everyone else. Also
      // clears a stale `m_idParty` when the party is gone (C++ party.cpp:1196).
      // Same fire-and-forget path as the friend/campus pushes above, so the
      // packets land after the JOIN self-spawn. The self ADD_OBJ therefore
      // carries no `m_idparty`; the client takes it from this PARTYMEMBER
      // instead (`g_pPlayer->m_idparty = g_Party.m_uPartyId`, DPClient.cpp:4937),
      // which is also how C++ restores it on character load.
      partyService.onJoin(player);
      // Guild (migration 023): ALL_GUILDS seeds the client's guild-name cache
      // (every peer ADD_OBJ carrying an idGuild resolves against it), then the
      // player's own GUILD + the online-roster push. Same fire-and-forget
      // ordering as party -- the self ADD_OBJ carries no guild block, the
      // client takes it from these snapshots.
      guildService.onJoin(player);
      // Guild war (migration 025) -- `CUser::AddMyGuildWar`, sent THIRD after
      // ALL_GUILDS then GUILD (`User.cpp:330-332`). Also re-stamps `m_idWar` on
      // the mover, which C++ gets for free from the CoreServer player record.
      // Silent for the overwhelmingly common case of no war.
      guildWarService.onJoin(player);
      // `CUser::AdjustGuildQuest` (`User.cpp:3652`) -- a player who logs in
      // inside an arena rect they have no claim to is ejected to a revival point.
      // No-op outside the rect, which is everyone.
      guildQuestService.adjustOnEnter(player);
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
    playerManager, zoneManager, cheerService,
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
  // Walk-to-destination position refresh (QUERYGETPOS). The client sends no
  // movement packet while auto-walking to a dest object -- following a player,
  // approaching a mob/NPC, walking to a pile -- so without this the server's
  // `m_vPos` stays at the click point and every range gate reads it stale.
  const destPollService = new DestPollService({ playerManager });
  const snapshotService = new SnapshotService({ zoneManager, visibilityService, destPollService });
  const snapshotHandler = new SnapshotHandler(playerManager, snapshotService);
  // ItemManager + LootService created before MovementService: movement runs the
  // dest-obj arrival check (v19 pickup has no packet -- client walks to the pile
  // via PLAYERSETDESTOBJ, server loots on arrival) every position update.
  const itemManager = new ItemManager({ zoneManager });
  // Party -- created before LootService + CombatService so the loot-share
  // (sameParty) and exp-share (partyExp) seams can close over the party
  // manager / service. `grantExpAmount` is bound to CombatService, which is
  // built further below; capture it via a slot that's filled once combat exists.
  const partyManager = new PartyManager(partyRepo);
  const combatGrantSlot: { fn: ((p: CPlayer, amount: number) => void) | null } = { fn: null };
  // CampusService is composed after CombatService (it needs the repos wired
  // below), so the level-up seam is late-bound the same way `combatGrantSlot` is.
  const campusLevelUpSlot: { fn: ((p: CPlayer) => void) | null } = { fn: null };
  const partyService = new PartyService({
    playerManager, partyManager,
    grantExpAmount: (p, amount) => combatGrantSlot.fn!(p, amount),
    // `s_fPartyExpRate` -- party-LEVEL exp rate only (the member exp split has
    // its own curve). A thunk so a runtime change applies on the next kill.
    partyExpRate: () => config.world.partyExpRate,
  });
  // Guild -- independent of the party/combat seams (no exp or loot share), so
  // it composes in one shot right after the party service. GuildService owns
  // both halves of the C++ split: the CoreServer authority checks and the
  // world-server relay.
  const guildManager = new GuildManager(guildRepo);
  // Guild war registry. Composed BEFORE GuildService because every roster guard
  // in that service asks it whether the guild is at war (`pGuild->GetWar()` in
  // C++ -- a registry lookup, not an `m_idWar != 0` test).
  const guildWarManager = new GuildWarManager(guildWarRepo);
  const guildService = new GuildService({
    playerManager, zoneManager, guildManager, guildWarManager,
    // Refusal texts -- `CDPCacheSrvr::SendDefinedText`. Without this every guild
    // guard refuses silently and a rejected click looks like a dead button.
    sendDefinedText: (player, tid, args) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, args ?? '')),
    // `CUser::IsAuthHigher( AUTH_GAMEMASTER )` -- gates guild logos above 20
    // (DPSrvr.cpp:1833). Ordinal compare on the ASCII rank byte, same as every
    // other `/cmd` gate in this codebase.
    isGameMaster: (p: CPlayer) => hasAuthority(p.m_bAuthority, AUTH.GAMEMASTER),
  });

  // Guild contribution -- penya/gem donation, guild level-up, the 21:00 payroll.
  // Split from GuildService because it is the only guild code that touches the
  // bag; the inventory surface is passed as a structural port so `@flyff/guild`
  // never imports `@flyff/inventory`.
  const guildContributionService = new GuildContributionService({
    playerManager, guildManager,
    sendDefinedText: (player, tid, args) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, args ?? '')),
    inventory: {
      getGold: (p: CPlayer) => p.m_nGold,
      spendGold: (p: CPlayer, amount: number) => inventoryService.spendGold(p, amount),
      // C++ walks the whole bag and donates EVERY gem stack it finds
      // (`DPSrvr.cpp:1885`). `item_lv` is emitted only for IK3_GEM rows, which is
      // also the kind filter, so a missing grade yields 0 PXP and the stack is
      // skipped rather than consumed for nothing.
      findGems: (p: CPlayer) => {
        const out: GemStack[] = [];
        for (let slot = 0; slot < MAX_INVENTORY; slot++) {
          const s = p.m_Inventory[slot];
          if (!s || s.count <= 0) continue;
          const def = resources.items.items.get(s.itemId);
          if (def?.item_kind3 !== IK3_GEM) continue;
          out.push({ slot, itemId: s.itemId, count: s.count, itemLv: def.item_lv ?? 0 });
        }
        return out;
      },
      removeItem: (p: CPlayer, slot: number, count: number) =>
        inventoryService.removeItem(p, slot, count).ok,
    },
  });

  // Guild bank -- the 42-slot shared warehouse. The penya pool is `guild.gold`
  // (the same field level-up spends), so no separate balance is threaded here.
  const guildBankService = new GuildBankService({
    playerManager, guildManager, spawnManager, repo: guildBankRepo,
    sendDefinedText: (player, tid, args) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, args ?? '')),
    inventory: {
      getSlot: (p: CPlayer, slot: number) =>
        slot >= 0 && slot < MAX_INVENTORY ? (p.m_Inventory[slot] ?? null) : null,
      removeItem: (p: CPlayer, slot: number, count: number) =>
        inventoryService.removeItem(p, slot, count).ok,
      addItem: (p: CPlayer, item) => {
        // `m_Inventory.Add` returns the destination slot; ours reports changes.
        const r = inventoryService.addItem(p, item.itemId, item.count);
        return r.ok ? (r.changes[0]?.slot ?? -1) : -1;
      },
      addGold: (p: CPlayer, amount: number) => inventoryService.addGold(p, amount),
      canAddGold: (p: CPlayer, amount: number) => p.m_nGold + amount <= MAX_GOLD,
      // `OnPutItemGuildBank`'s refused-chain (`DPSrvr.cpp:3598-3627`). Quest items
      // are the one gate our slot model can express today; bound / in-use /
      // charged / `PARTS_RIDE`-on-vagrant are not modelled on the slot, same
      // ponytail the vendor listing check carries.
      isDepositBlocked: (p: CPlayer, slot: number) => {
        const item = p.m_Inventory[slot];
        if (!item) return true;
        return resources.items.items.get(item.itemId)?.item_kind3 === 'IK3_QUEST';
      },
    },
  });
  void guildBankService
    .hydrate()
    .catch((err: unknown) => logger.warn({ err }, 'guild bank hydrate failed'));

  // The 21:00 payroll poll (`CGuildMng::Process`). Hour-granular, so a
  // one-minute interval cannot miss the 21:00 or 22:00 boundary.
  const guildSalarySystem = new GuildSalarySystem({ contributionService: guildContributionService });
  guildSalarySystem.start();

  // Guild war -- declare/accept/surrender/truce plus the expiry tick.
  //
  // `isWarEnabled` is the port of the runtime `EVE_GUILDWAR` event flag, which
  // vanilla v19 ships at 0 (`flyffevent.h`; only the world boot-script token
  // `GUILDWAR` ever sets it). A thunk, not a captured boolean, so a future GM
  // command can flip it without recomposing.
  //
  // Note we additionally gate DECLARATION on the flag, which C++ does not: there
  // the flag guards only `IsWarTarget` and the expiry tick, so a war declared
  // with the flag off would lock every roster mutation on both guilds and never
  // end. Recorded in docs/c++-fidelity-audit.md.
  const guildWarService = new GuildWarService({
    playerManager, zoneManager, guildManager, guildWarManager,
    isWarEnabled: () => config.world.guildWarEnabled,
    // Nine declare gates all refuse; without the text a failed declaration is
    // indistinguishable from a bug.
    sendDefinedText: (player, tid, args) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, args ?? '')),
  });
  // The war tick. Armed unconditionally -- `GuildWarService.tick` re-checks the
  // flag itself (as the C++ call site does), and with no wars live the callback
  // is an empty Map walk once a second.
  const guildWarSystem = new GuildWarSystem({ warService: guildWarService });
  guildWarSystem.start();

  // ── Guild quest (the boss arena) ─────────────────────────────────────────
  //
  // `isQuestEnabled` is the port of the runtime `EVE_WORMON` flag, which vanilla
  // v19 ships at 0 (`flyffevent.h`; only the boot-script token `WORMON` sets it).
  // A thunk for the same reason as `isWarEnabled`.
  //
  // The rect table comes from the loaded props, which is where C++ builds it too
  // -- `AddQuestRect` is called inline during the prop parse
  // (`Project.cpp:1260`), so by the time any world state exists the rects are
  // already static.
  const guildQuestProcessor = new GuildQuestProcessor(resources.guildQuest.byId.values());
  const guildQuestSetPos = new SetPosSerializer();
  const guildQuestService = new GuildQuestService({
    playerManager, guildManager,
    processor: guildQuestProcessor,
    spawn: {
      spawnMonster: (moverId, pos, zoneId, activeAttack) =>
        spawnManager.spawnMonster(moverId, pos, zoneId, activeAttack),
      kill: (id, opts) => spawnManager.kill(id, opts),
    },
    teleport: {
      // Same-world SETPOS + forced view re-diff -- the arena and every revival
      // point it ejects to are in Madrigal, so REPLACE is never needed here.
      teleport: (player, pos) => {
        player.m_vPos = { ...pos };
        player._dirty.add('x'); player._dirty.add('y'); player._dirty.add('z');
        playerManager.sendTo(player, guildQuestSetPos.build(player.m_idPlayer, pos));
        visibilityService.refresh(player.m_idPlayer, true);
      },
      // `GetNearRevivalPos` (`guild.cpp:1000`) collapsed to the zone's single
      // revival point, matching RevivalService's own note: the nearest-point
      // tables are unported.
      revivalPos: (player) => resources.zones.byNumericId.get(player.m_nZoneId)?.revival.position,
    },
    isQuestEnabled: () => config.world.guildQuestEnabled,
  });
  guildManager.setQuestRepo(guildQuestRepo);
  const guildQuestSystem = new GuildQuestSystem({ questService: guildQuestService });
  guildQuestSystem.start();

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
  // Looter pet (`IK3_PET` / `CAIPet`) -- created after LootService so it can
  // route pickups through the owner's own DoLoot path, as C++ does.
  const petSystem = new PetSystem({
    playerManager, zoneManager, spawnManager, itemManager, lootService, inventoryService,
    notify: (player, tid) => playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
  });
  petSystem.start();
  const movementService = new MovementService({
    zoneManager,
    onMoved: (p) => questTracker.onPlayerMoved(p),
    lootService,
    visibilityService,
    destPollService,
  });
  const playerMovedHandler = new PlayerMovedHandler(playerManager, movementService);
  const playerBehaviorHandler = new PlayerBehaviorHandler(playerManager, movementService);

  // Phase 6 -- remaining v19 C->S handlers (chat, motion, target, movement
  // variants, query/getpos, script dialog, revival). See PROGRESS.md for
  // the audit that scoped these.
  const commandService = new CommandService({
    playerManager, spawnManager, questService, journal,
    inventoryService, charRepo, inventoryRepo, zoneManager, visibilityService,
    // `/te` -- zone index for the coord gate + the `y == 0` terrain-height
    // sentinel `CWorld::_replace` resolves via `GetFullHeight`.
    zones: resources.zones,
    // `/g` guild chat + `/cg` GM guild create -- the server-side half of the
    // TCM_BOTH `TextCmd_GuildChat` (guild chat has no C->S opcode of its own).
    guildService,
    // `/sgq` -- ledger-only, per the C++ command. See the dep's note.
    guildQuest: {
      setStateByGuildName: (name, questId, state) =>
        guildQuestService.setStateByGuildName(name, questId, state),
    },
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
  const statService = new StatService({ playerManager, zoneManager, charRepo, journal });
  const changeJobService = new ChangeJobServiceImpl({
    charRepo, skills: resources.skills, playerManager, zoneManager, journal, statService,
  });
  const scriptDlgService = new ScriptDlgService({
    spawnManager, dialogs: resources.dialogs, quests: resources.quests, questService,
    defines: resources.defines, questText: resources.questText,
    changeJobService,
    // The guild script predicates (`ScriptLib.cpp:401,415,431,443,782,790`).
    // Both membership checks are REGISTRY lookups in C++, so `getByMember`
    // (which resolves through the roster) is the faithful shape -- not
    // `m_idGuild != 0`. `questState` returns `-1` for an absent entry, which is
    // load-bearing at `NpcScript.cpp:2059`.
    guild: {
      isMember: (charId) => guildManager.getByMember(charId) !== undefined,
      isMaster: (charId) => guildManager.getByMember(charId)?.masterId === charId,
      hasQuest: (charId, questId) => {
        const g = guildManager.getByMember(charId);
        return g !== undefined && guildManager.getQuest(g.id, questId) !== undefined;
      },
      questState: (charId, questId) => {
        const g = guildManager.getByMember(charId);
        if (!g) return -1;
        return guildManager.getQuest(g.id, questId)?.state ?? -1;
      },
      isWormonServer: () => config.world.guildQuestEnabled,
      monHuntStart: (charId, questId, state, ns, nf) => {
        const player = playerManager.get(charId);
        if (!player) return false;
        return guildQuestService.start(player, questId, state, ns, nf).ok;
      },
    },
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
  // `CMover::CanDuel` refuses while either side is in a guild war
  // (TID_GAME_GUILDWARERRORDUEL, `Mover.cpp:7174`) -- a duel would otherwise let
  // two warring players opt out of the war's targeting rules.
  const duelService = new DuelService({
    playerManager, duelManager,
    isInWar: (player) => guildWarService.isInWar(player),
    sendDefinedText: (player, tid) =>
      playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
  });
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
    // HITTYPE_WAR -- `CMover::IsWarTarget` (`MoverAttack.cpp:2047`). Grants PvP
    // consent between two warring guilds regardless of PK mode, and (via
    // `GetPVPCase`) routes the kill to `SubWar` instead of `SubPK`, so a war
    // death costs the killer no PK value.
    isWarTarget: (attacker, target) => guildWarService.isWarTarget(attacker, target),
    // ...and the flip side: being in a war makes you un-PK-able by anyone OUTSIDE
    // it (`MoverAttack.cpp:1945`). Checked after `isWarTarget`, so the enemy
    // guild stays attackable.
    isInWar: (player) => guildWarService.isInWar(player),
    onWarDeath: (victim) => guildWarService.onWarDeath(victim),
    // Guild-quest arena: a monster death may be the boss. Cheap when no arena is
    // live (an empty Map scan).
    onGuildQuestBossKilled: (bossObjid) => guildQuestService.onBossKilled(bossObjid),
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
  const guildHandler = new GuildHandler({
    playerManager, guildService,
    contributionService: guildContributionService,
    bankService: guildBankService,
    warService: guildWarService,
  });
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
  // Blinkwing teleport scrolls (IK2_BLINKWING). The teleport + STATEMODE frames
  // are injected because @flyff/inventory must not depend on world-server, where
  // SetPosSerializer + VisibilityService live (same seam as AdminCommandService).
  const blinkwingSetPosSerializer = new SetPosSerializer();
  const blinkwingService = new BlinkwingService({
    inventoryService, playerManager,
    getItem: (id: number) => resources.items.items.get(id),
    zones: resources.zones,
    // Same-world SETPOS + forced view re-diff -- identical to `/teleport`
    // (command.service applyReplace). Cross-world is refused upstream.
    teleport: (player, pos) => {
      player.m_vPos = { ...pos };
      player._dirty.add('x'); player._dirty.add('y'); player._dirty.add('z');
      playerManager.sendTo(player, blinkwingSetPosSerializer.build(player.m_idPlayer, pos));
      visibilityService.refresh(player.m_idPlayer, true);
    },
    broadcastStateMode: (player, flag, itemId) =>
      zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        buildStateMode(player.m_idPlayer, player.m_dwStateMode, flag, itemId),
      ),
    notify: (player, tid) => playerManager.sendTo(player, buildDefinedText(player.m_idPlayer, tid, '')),
    // `prj.IsGuildQuestRegion` -- refuses the Return scroll inside an arena rect
    // (`MoverSkill.cpp:2842`). The only one of the C++'s eight suppression sites
    // whose feature exists in this port.
    isGuildQuestRegion: (pos, worldId) => guildQuestService.isQuestRegion(pos, worldId),
  });
  const useItemService = new UseItemService({
    equipService, consumableService, inventoryService,
    getItem: (id: number) => resources.items.items.get(id),
    potionCooldownMs: config.consumable.potionCooldownMs,
    playerManager, zoneManager,
    togglePet: (player, itemObjid, linkKind) => petSystem.toggle(player, itemObjid, linkKind),
    blinkwingService,
  });
  // Channel-completion poll -- fires the teleport when `m_nReadyTime` elapses
  // (C++ drives this from the per-user tick, `User.cpp:382`).
  const blinkwingSystem = new BlinkwingSystem({ playerManager, blinkwingService });
  blinkwingSystem.start();
  // Client-side channel abort (move / jump / hit) -- PACKETTYPE_STATEMODE.
  const stateModeHandler = new StateModeHandler(playerManager, blinkwingService);
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

  // Durable party rosters (migration 022) -- reload every persisted party before
  // the first client can JOIN, so a returning member's `onJoin` finds their
  // party. Best-effort: a failure leaves the manager empty rather than blocking
  // boot, and new parties still form normally.
  void partyManager
    .hydrate()
    .catch((err: unknown) => logger.warn({ err }, 'party hydrate failed'));
  // Guilds ARE durable in C++ too (CoreServer reloads GUILD_TBL at boot), so
  // this is a faithful port rather than a divergence. Same fire-and-forget
  // shape: a failed hydrate logs and leaves the registry empty.
  //
  // Wars ride the same chain, and the ORDER matters: `relinkAfterHydrate`
  // re-derives each guild's `m_idWar`/`m_idEnemyGuild` from the loaded war rows
  // (exactly as the tail of the C++ load query does), so the guild registry must
  // be populated first. A war naming a guild that no longer exists is dropped
  // there rather than left dangling.
  void guildManager
    .hydrate()
    .then(() => guildWarManager.hydrate())
    .then(() => { guildWarService.relinkAfterHydrate(); })
    // Quest ledgers index into guilds, so they load last. C++ round-trips this
    // separately too (`SendQueryGuildQuest`, `ThreadMng.cpp:248`) and only when
    // the flag is on; we always load, because a flag flipped on later must not
    // silently see an empty ledger.
    .then(() => guildManager.hydrateQuests())
    .catch((err: unknown) => logger.warn({ err }, 'guild hydrate failed'));

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
      destPollService.cancel(player.m_idPlayer);
      petSystem.onOwnerGone(player);
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
    blinkwingSystem,
    blinkwingService,
    pkDecaySystem,
    petSystem,
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
    destPollService,
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
    stateModeHandler,
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
    guildManager,
    guildService,
    guildContributionService,
    guildBankService,
    guildSalarySystem,
    guildWarManager,
    guildWarService,
    guildWarSystem,
    guildQuestProcessor,
    guildQuestService,
    guildQuestSystem,
    guildHandler,
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
