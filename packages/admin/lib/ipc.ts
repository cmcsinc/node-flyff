/**
 * Admin -> world IPC publisher.
 *
 * Mirrors `startIpcListeners` in packages/world-server/src/index.ts: one
 * `IpcBus` over either Redis (`CACHE_ADAPTER=redis`) or the dev-only LocalBus.
 * Every message is HMAC-SHA256 signed by `IpcBus` with `IPC_SECRET`.
 *
 * SECURITY: the world trusts any correctly-signed envelope, so the GM
 * authorization gate lives in the API route, never here.
 *
 * Node runtime only (`ioredis`/`node:net`). Never import from a component or
 * middleware — routes using this must set `export const runtime = "nodejs"`.
 *
 * @module lib/ipc
 */

import type { IpcBus } from '@flyff/ipc';

/** Command payloads accepted by the world's `AdminListener`. */
export type AdminCommand =
  | { kind: 'kick'; charId: number }
  | { kind: 'teleport'; charId: number; x?: number; z?: number }
  | { kind: 'mail_pushed'; charId: number }
  | { kind: 'kick_all'; reason?: string };

/** Channel name — must match `ADMIN_COMMAND_CHANNEL` on the world side. */
const ADMIN_COMMAND_CHANNEL = 'admin:command';

/** Structural logger accepted by `createLocalBus`. */
const ignoreLog = (): void => undefined;
const busLogger = {
  info: ignoreLog,
  warn: ignoreLog,
  error: ignoreLog,
  debug: ignoreLog,
};

let busPromise: Promise<IpcBus | null> | null = null;

async function createBus(): Promise<IpcBus | null> {
  const secret = process.env.IPC_SECRET;
  if (!secret || secret.length < 16) return null;

  const { IpcBus: Bus, createLocalBus } = await import('@flyff/ipc');

  if (process.env.CACHE_ADAPTER === 'redis') {
    // Same dynamic-import + structural-cast dance as the world server: ioredis
    // is optional at build time and its class shape is wider than IpcRedis.
    interface IpcRedisLike {
      on(event: 'message', h: (channel: string, data: string) => void): void;
      publish(channel: string, data: string): Promise<number>;
      subscribe(channel: string): Promise<void>;
      unsubscribe(channel: string): Promise<void>;
      quit(): Promise<void>;
    }
    // `ioredis` is a direct dep (same version @flyff/ipc pins) because pnpm's
    // strict node_modules won't let the admin process resolve a peer's
    // dependency at runtime. Kept in `serverExternalPackages` so it is never
    // bundled — the memory/LocalBus dev path never loads it.
    const Redis = (await import('ioredis')).default as unknown as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => IpcRedisLike;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    return new Bus(redis, secret, 'admin');
  }

  const localBus = await createLocalBus({
    host: process.env.LOCAL_BUS_HOST ?? '127.0.0.1',
    port: Number(process.env.LOCAL_BUS_PORT ?? 6390),
    logger: busLogger,
  });
  return new Bus(localBus, secret, 'admin');
}

/**
 * Module-level lazy singleton. Resolves to `null` when the transport can't be
 * set up (no `IPC_SECRET`, Redis unreachable, LocalBus bind failure) so callers
 * can report "world offline" instead of throwing a 500.
 */
export async function getAdminBus(): Promise<IpcBus | null> {
  if (!busPromise) {
    busPromise = createBus().catch(() => null);
  }
  return busPromise;
}

/**
 * Publish one admin command. Returns `false` when the bus is unavailable or the
 * publish threw — commands are fire-and-forget, the caller decides whether that
 * is fatal (kick/teleport: yes; mail nudge: no, the row is already persisted).
 */
export async function publishAdminCommand(cmd: AdminCommand): Promise<boolean> {
  const bus = await getAdminBus();
  if (!bus) return false;
  try {
    await bus.publish(ADMIN_COMMAND_CHANNEL, cmd);
    return true;
  } catch {
    return false;
  }
}
