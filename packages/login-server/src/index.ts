import { compose } from './compose.js';

async function main(): Promise<void> {
  const { config, logger, clusterRegistry } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });

  await clusterRegistry.start();
  logger.info({ port: config.server.port }, 'Server started on port');
}

void main();
