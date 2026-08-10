import { createLogger, type Logger, loadConfig, type ClusterServerConfig, ClusterServerConfigSchema, GameError, MemoryCache } from '@flyff/core';
import { createDb, type DbConfig, AccountRepository, CharacterRepository, InventoryRepository } from '@flyff/database';

type Database = ConstructorParameters<typeof AccountRepository>[0];

function isDatabase(value: unknown): value is Database {
  return typeof value === 'function' && 'transaction' in value;
}
import { LoginRegistrar } from './ipc/loginRegistrar';
import { WorldRegistry } from './ipc/worldRegistry';
import { ClusterHandoffPublisher } from './ipc/handoffPublisher';
import { WorldListService } from './services/worldList.service';
import { CharListService } from './services/charList.service';
import { CharCreateService } from './services/charCreate.service';
import { CharSelectService } from './services/charSelect.service';
import { WorldHandoffTokenService } from './services/worldToken.service';
import { PlayerListSerializer } from './net/playerList.serializer';
import { CharHandler } from './handlers/char.handler';
import { AccountConnectionManager } from './managers/accountConnection.manager';

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
  accountConnections: AccountConnectionManager;
}

export async function compose(): Promise<ClusterComposeResult> {
  const config = await loadConfig('cluster-server', ClusterServerConfigSchema);
  const logger = createLogger({ service: 'cluster-server', serverId: config.server.id });

  // Database (character roster is cluster-owned in the vertical slice).
  const dbConfig: DbConfig = {
    client: config.database.client,
    connection: config.database.client === 'better-sqlite3'
      ? config.database.filename
      : config.database.url ?? {
          host: 'localhost',
          port: 3306,
          user: 'root',
          password: '',
          database: 'flyff',
        },
  };
  const db: unknown = createDb(dbConfig);
  if (!isDatabase(db)) throw new GameError('Database factory returned an invalid connection');
  const accountRepo = new AccountRepository(db);
  const charRepo = new CharacterRepository(db);
  const inventoryRepo = new InventoryRepository(db);

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
    publicIp: config.server.publicHost,
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
  const charListService = new CharListService(accountRepo, charRepo, inventoryRepo);
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
  });
  const accountConnections = new AccountConnectionManager();

  // CACHE_ADDR source: the public IP of the first online world server (what the
  // client dials on :5400). Null when none registered -> handler falls back to
  // 127.0.0.1 for single-box dev.
  const cacheAddrSource = {
    getCacheAddr: (): string | null => worldRegistry.getOnlineWorlds()[0]?.publicIp ?? null,
  };

  const charHandler = new CharHandler(
    charListService,
    charCreateService,
    charSelectService,
    playerListSerializer,
    accountConnections,
    cacheAddrSource,
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
    accountConnections,
  };
}
