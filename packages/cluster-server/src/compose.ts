import { createLogger, type Logger, loadConfig, type ClusterServerConfig, MemoryCache } from '@flyff/core';
import { ClusterServerConfigSchema } from '@flyff/core/config/schemas/cluster';
import { createDb, type DbConfig, AccountRepository, CharacterRepository } from '@flyff/database';
import { LoginRegistrar } from './ipc/loginRegistrar.js';
import { WorldRegistry } from './ipc/worldRegistry.js';
import { ClusterHandoffPublisher } from './ipc/handoffPublisher.js';
import { WorldListService } from './services/worldList.service.js';
import { CharListService } from './services/charList.service.js';
import { CharCreateService } from './services/charCreate.service.js';
import { CharSelectService } from './services/charSelect.service.js';
import { WorldHandoffTokenService } from './services/worldToken.service.js';
import { PlayerListSerializer } from './net/playerList.serializer.js';
import { CharHandler } from './handlers/char.handler.js';

export interface ClusterComposeResult {
  config: ClusterServerConfig;
  logger: Logger;
  worldRegistry: WorldRegistry;
  loginRegistrar: LoginRegistrar;
  worldListService: WorldListService;
  charListService: CharListService;
  charCreateService: CharCreateService;
  charSelectService: CharSelectService;
  charHandler: CharHandler;
  playerListSerializer: PlayerListSerializer;
  handoffPublisher: ClusterHandoffPublisher;
}

export async function compose(): Promise<ClusterComposeResult> {
  const config = await loadConfig('cluster-server', ClusterServerConfigSchema);
  const logger = createLogger({ service: 'cluster-server', serverId: config.server.id });

  // Database (character roster is cluster-owned in the vertical slice).
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
  const accountRepo = new AccountRepository(db);
  const charRepo = new CharacterRepository(db);

  // Cache for handoff tokens.
  const cache = new MemoryCache();

  const worldRegistry = new WorldRegistry({
    serverId: config.server.id,
    internalPort: config.registration.internalPort,
    allowedWorlds: config.registration.allowedWorlds,
    ipcSecret: config.ipc.secret,
    heartbeatTimeoutMs: config.registration.worldHeartbeatTimeoutMs,
    logger,
  });

  const loginRegistrar = new LoginRegistrar({
    serverId: config.server.id,
    serverName: config.server.id,
    publicIp: config.server.host,
    publicPort: config.server.port,
    ipcSecret: config.ipc.secret,
    loginHost: config.registration.loginHost,
    loginInternalPort: config.registration.loginInternalPort,
    reconnectIntervalMs: config.registration.reconnectIntervalMs,
    heartbeatIntervalMs: config.registration.heartbeatIntervalMs,
    worldRegistry,
    logger,
  });

  const worldListService = new WorldListService();
  worldListService.init({ worldRegistry });

  // Character select/create/delete/enter-world stack.
  const playerListSerializer = new PlayerListSerializer();
  const charListService = new CharListService(accountRepo, charRepo);
  const charCreateService = new CharCreateService(accountRepo, charRepo, {
    maxPerAccount: config.character.maxPerAccount,
    startMap: config.character.startMap,
    startX: config.character.startX,
    startY: config.character.startY,
    startZ: config.character.startZ,
    startLevel: config.character.startLevel,
  });
  const worldTokenService = new WorldHandoffTokenService(cache, config.ipc.secret);
  const handoffPublisher = new ClusterHandoffPublisher();
  const charSelectService = new CharSelectService({
    accountRepo,
    charRepo,
    tokenService: worldTokenService,
    handoffPublisher,
    worldId: config.server.id,
  });
  const charHandler = new CharHandler(
    charListService,
    charCreateService,
    charSelectService,
    playerListSerializer,
  );

  return {
    config,
    logger,
    worldRegistry,
    loginRegistrar,
    worldListService,
    charListService,
    charCreateService,
    charSelectService,
    charHandler,
    playerListSerializer,
    handoffPublisher,
  };
}
