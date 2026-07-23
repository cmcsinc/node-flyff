import { compose } from './compose';
import { buildLoginClientServer } from './clientServer';

async function main(): Promise<void> {
  const { config, logger, clusterRegistry, authHandler } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });

  await clusterRegistry.start();

  const { server } = buildLoginClientServer({ authHandler, logger });
  server.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'Login client server listening');
  });
}

void main();
