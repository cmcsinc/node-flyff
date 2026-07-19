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
  };
}
