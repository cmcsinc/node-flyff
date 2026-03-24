import { compose } from './compose.js';

async function main(): Promise<void> {
  const { config, logger, worldRegistry, loginRegistrar } = await compose();

  process.on('unhandledRejection', err => {
    logger.error({ err }, 'Unhandled promise rejection');
    process.exit(1);
  });

  await worldRegistry.start();
  loginRegistrar.start();
  logger.info({ port: config.server.port }, 'Server started on port');
}

void main();
