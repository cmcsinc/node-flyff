import { createLogger, type Logger, loadConfig, type WorldServerConfig } from '@flyff/core';
import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
import { ClusterRegistrar } from './ipc/clusterRegistrar.js';
import { loadAllResources, type ResourceIndex } from '@flyff/resources';

export interface WorldComposeResult {
  config: WorldServerConfig;
  logger: Logger;
  clusterRegistrar: ClusterRegistrar;
  resources: ResourceIndex;
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
    publicIp: config.server.host,
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

  return {
    config,
    logger,
    clusterRegistrar,
    resources,
  };
}
