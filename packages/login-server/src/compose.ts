import type { Socket } from 'node:net';
import { createLogger, type Logger, loadConfig, type LoginServerConfig, MemoryCache, createEventBus, type EventBus, LoginServerConfigSchema} from '@flyff/core';
import { createDb, type DbConfig, AccountRepository } from '@flyff/database';
import { ClusterRegistry } from './ipc/clusterRegistry';
import { ServerListService } from './services/serverList.service';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { AuthHandler } from './handlers/auth.handler';
import { ServerListHandler } from './handlers/serverList.handler';

interface LoginEvents {
  'login:success': [{ accountId: number; account: string; socket: Socket; handoffToken: string }];
  [event: string]: unknown[];
}

/**
 * Login server composition result.
 *
 * Contains all wired dependencies for the login server.
 */
export interface LoginComposeResult {
  config: LoginServerConfig;
  logger: Logger;
  eventBus: EventBus<LoginEvents>;
  clusterRegistry: ClusterRegistry;
  serverListService: ServerListService;
  authService: AuthService;
  tokenService: TokenService;
  authHandler: AuthHandler;
  serverListHandler: ServerListHandler;
}

/**
 * Compose the login server dependency graph.
 *
 * This is the composition root -- all singletons are wired here.
 *
 * @returns Wired dependencies
 */
export async function compose(): Promise<LoginComposeResult> {
  // Load configuration
  const config = await loadConfig('login-server', LoginServerConfigSchema);
  const logger = createLogger({ service: 'login-server', serverId: config.server.id });
  const eventBus = createEventBus<LoginEvents>();

  // Create database connection
  const dbConfig: DbConfig = {
    client: config.database.client,
    connection: config.database.client === 'better-sqlite3'
      ? config.database.filename
      // `url` is `.default('')` in the schema, so it is a string -- empty means
      // "not configured", hence the truthiness check rather than `??`.
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

  // Initialize cluster registry
  const clusterRegistry = new ClusterRegistry({
    serverId: config.server.id,
    internalPort: config.registration.internalPort,
    allowedClusters: config.registration.allowedClusters,
    ipcSecret: config.ipc.secret,
    heartbeatTimeoutMs: config.registration.heartbeatTimeoutMs,
    logger,
  });

  // Initialize cache
  const cache = new MemoryCache();

  // Initialize services
  const serverListService = new ServerListService();
  serverListService.init({
    clusterRegistry,
    staticServerList: config.serverList,
  });

  const authService = new AuthService(
    cache,
    accountRepo
  );

  const tokenService = new TokenService(
    cache,
    config.ipc.secret
  );

  // Initialize handlers
  const authHandler = new AuthHandler(
    authService,
    tokenService,
    eventBus
  );

  const serverListHandler = new ServerListHandler(serverListService);

  // Listen for login success events to send server list
  eventBus.on('login:success', (data: { accountId: number; account: string; socket: Socket; handoffToken: string }) => {
    serverListHandler.sendServerList(data.socket, data.accountId, data.account);
  });

  return {
    config,
    logger,
    eventBus,
    clusterRegistry,
    serverListService,
    authService,
    tokenService,
    authHandler,
    serverListHandler,
  };
}
