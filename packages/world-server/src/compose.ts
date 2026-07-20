import { createLogger, type Logger, loadConfig, type WorldServerConfig } from '@flyff/core';
import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
import { createDb, type DbConfig, CharacterRepository } from '@flyff/database';
import { ClusterRegistrar } from './ipc/clusterRegistrar.js';
import { ClusterListener } from './ipc/clusterListener.js';
import { loadAllResources, type ResourceIndex } from '@flyff/resources';
import { PlayerManager } from './managers/player.manager.js';
import { ZoneManager } from './managers/zone.manager.js';
import { PlayerSnapshotSerializer } from './net/snapshot/playerSnapshot.serializer.js';
import { JoinService } from './services/join.service.js';
import { JoinHandler } from './handlers/join.handler.js';
import { MapKeyService } from './services/mapKey.service.js';
import { MapKeyHandler } from './handlers/mapKey.handler.js';
import { QueryPlayerDataService } from './services/queryPlayerData.service.js';
import { QueryPlayerDataHandler } from './handlers/queryPlayerData.handler.js';
import { SnapshotService } from './services/snapshot.service.js';
import { SnapshotHandler } from './handlers/snapshot.handler.js';
import { MovementService } from './services/movement.service.js';
import { PlayerMovedHandler } from './handlers/playerMoved.handler.js';
import { PlayerBehaviorHandler } from './handlers/playerBehavior.handler.js';
import { ChatService } from './services/chat.service.js';
import { ChatHandler } from './handlers/chat.handler.js';
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
import { GetPosHandler } from './handlers/getPos.handler.js';
import { ScriptDlgService } from './services/scriptDlg.service.js';
import { ScriptDlgHandler } from './handlers/scriptDlg.handler.js';
import { RevivalService } from './services/revival.service.js';
import { RevivalHandler } from './handlers/revival.handler.js';

export interface WorldComposeResult {
  config: WorldServerConfig;
  logger: Logger;
  clusterRegistrar: ClusterRegistrar;
  clusterListener: ClusterListener;
  resources: ResourceIndex;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  snapshotSerializer: PlayerSnapshotSerializer;
  joinService: JoinService;
  joinHandler: JoinHandler;
  mapKeyService: MapKeyService;
  mapKeyHandler: MapKeyHandler;
  queryPlayerDataService: QueryPlayerDataService;
  queryPlayerDataHandler: QueryPlayerDataHandler;
  snapshotService: SnapshotService;
  snapshotHandler: SnapshotHandler;
  movementService: MovementService;
  playerMovedHandler: PlayerMovedHandler;
  playerBehaviorHandler: PlayerBehaviorHandler;
  chatService: ChatService;
  chatHandler: ChatHandler;
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
  getPosHandler: GetPosHandler;
  scriptDlgService: ScriptDlgService;
  scriptDlgHandler: ScriptDlgHandler;
  revivalService: RevivalService;
  revivalHandler: RevivalHandler;
}

export async function compose(): Promise<WorldComposeResult> {
  const config = await loadConfig('world-server', WorldServerConfigSchema);
  const logger = createLogger({ service: 'world-server', serverId: config.server.id });

  // Load game resources (items, movers, skills, zones)
  logger.info('Loading game resources...');
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

  // In-memory world state + enter-world stack.
  const playerManager = new PlayerManager();
  const zoneManager = new ZoneManager();
  const clusterListener = new ClusterListener({});
  const snapshotSerializer = new PlayerSnapshotSerializer();
  const joinService = new JoinService({
    charRepo,
    playerManager,
    zoneManager,
    handoffSource: clusterListener,
  });
  const joinHandler = new JoinHandler(joinService, snapshotSerializer);

  const mapKeyService = new MapKeyService({ playerManager });
  const mapKeyHandler = new MapKeyHandler(mapKeyService);
  const queryPlayerDataService = new QueryPlayerDataService({ playerManager });
  const queryPlayerDataHandler = new QueryPlayerDataHandler(queryPlayerDataService);

  // In-world movement + peer-broadcast handlers (Phases 3-5).
  const snapshotService = new SnapshotService({ zoneManager });
  const snapshotHandler = new SnapshotHandler(playerManager, snapshotService);
  const movementService = new MovementService({ zoneManager });
  const playerMovedHandler = new PlayerMovedHandler(playerManager, movementService);
  const playerBehaviorHandler = new PlayerBehaviorHandler(playerManager, movementService);

  // Phase 6 — remaining v15 C→S handlers (chat, motion, target, movement
  // variants, query/getpos, script dialog, revival). See PROGRESS.md for
  // the audit that scoped these.
  const chatService = new ChatService({ zoneManager });
  const chatHandler = new ChatHandler(playerManager, chatService);
  const motionService = new MotionService({ zoneManager });
  const motionHandler = new MotionHandler(playerManager, motionService);
  const targetService = new TargetService();
  const setTargetHandler = new SetTargetHandler(playerManager, targetService);
  const leaveHandler = new LeaveHandler();
  const playerCorrHandler = new PlayerCorrHandler(playerManager, movementService);
  const playerMoved2Handler = new PlayerMoved2Handler(playerManager, movementService);
  const playerAngleHandler = new PlayerAngleHandler(playerManager, movementService);
  const queryGetPosService = new QueryGetPosService();
  const queryGetPosHandler = new QueryGetPosHandler(playerManager, queryGetPosService);
  const getPosHandler = new GetPosHandler(playerManager, movementService);
  const scriptDlgService = new ScriptDlgService();
  const scriptDlgHandler = new ScriptDlgHandler(playerManager, scriptDlgService);
  const revivalService = new RevivalService();
  const revivalHandler = new RevivalHandler(playerManager, revivalService);

  return {
    config,
    logger,
    clusterRegistrar,
    clusterListener,
    resources,
    playerManager,
    zoneManager,
    snapshotSerializer,
    joinService,
    joinHandler,
    mapKeyService,
    mapKeyHandler,
    queryPlayerDataService,
    queryPlayerDataHandler,
    snapshotService,
    snapshotHandler,
    movementService,
    playerMovedHandler,
    playerBehaviorHandler,
    chatService,
    chatHandler,
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
    getPosHandler,
    scriptDlgService,
    scriptDlgHandler,
    revivalService,
    revivalHandler,
  };
}
