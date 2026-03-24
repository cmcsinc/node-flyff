import { createLogger, type Logger, loadConfig, type LoginServerConfig } from '@flyff/core';
import { LoginServerConfigSchema } from '@flyff/core/config/schemas/login';
import { ClusterRegistry } from './ipc/clusterRegistry.js';
import { ServerListService } from './services/serverList.service.js';

export interface LoginComposeResult {
  config: LoginServerConfig;
  logger: Logger;
  clusterRegistry: ClusterRegistry;
  serverListService: ServerListService;
}

export async function compose(): Promise<LoginComposeResult> {
  const config = await loadConfig('login-server', LoginServerConfigSchema);
  const logger = createLogger({ service: 'login-server', serverId: config.server.id });

  const clusterRegistry = new ClusterRegistry({
    serverId: config.server.id,
    internalPort: config.registration.internalPort,
    allowedClusters: config.registration.allowedClusters,
    ipcSecret: config.ipc.secret,
    heartbeatTimeoutMs: config.registration.heartbeatTimeoutMs,
    logger,
  });

  const serverListService = new ServerListService();
  serverListService.init({
    clusterRegistry,
    staticServerList: config.serverList,
  });

  return {
    config,
    logger,
    clusterRegistry,
    serverListService,
  };
}
