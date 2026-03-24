import { createLogger, type Logger, loadConfig, type ClusterServerConfig } from '@flyff/core';
import { ClusterServerConfigSchema } from '@flyff/core/config/schemas/cluster';
import { LoginRegistrar } from './ipc/loginRegistrar.js';
import { WorldRegistry } from './ipc/worldRegistry.js';
import { WorldListService } from './services/worldList.service.js';

export interface ClusterComposeResult {
  config: ClusterServerConfig;
  logger: Logger;
  worldRegistry: WorldRegistry;
  loginRegistrar: LoginRegistrar;
  worldListService: WorldListService;
}

export async function compose(): Promise<ClusterComposeResult> {
  const config = await loadConfig('cluster-server', ClusterServerConfigSchema);
  const logger = createLogger({ service: 'cluster-server', serverId: config.server.id });

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

  return {
    config,
    logger,
    worldRegistry,
    loginRegistrar,
    worldListService,
  };
}
