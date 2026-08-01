/**
 * AdminListener -- world side of the admin-panel -> world command channel.
 *
 * The admin panel (a separate Next.js process) publishes HMAC-signed commands
 * on `admin:command`. `IpcBus` verifies the signature and the 30 s freshness
 * window (rule 07) before this listener sees anything, so `onCommand` only
 * shape-validates and dispatches.
 *
 * SECURITY: `IPC_SECRET` is the only authentication on the bus. Any process
 * holding it can issue any command here, so the per-action GM authorization
 * MUST be enforced in the admin route -- the world trusts a correctly-signed
 * envelope unconditionally. Commands are fire-and-forget: if the world is down
 * the publish is silently dropped (the admin panel reports "offline" instead).
 *
 * @module ipc/adminListener
 */

import { createLogger } from '@flyff/core/logger';

/** IPC channel carrying admin-panel commands (rule 07 naming `<domain>:<action>`). */
export const ADMIN_COMMAND_CHANNEL = 'admin:command';

/** Minimal bus port -- `IpcBus` satisfies it. Mirrors `ClusterBusPort`. */
export interface AdminBusPort {
  subscribe<T>(channel: string, handler: (payload: T, from: string) => void | Promise<void>): Promise<void>;
  unsubscribe(channel: string): void;
}

/** Disconnect a character. Graceful: the socket-close hook flushes state. */
export interface AdminKickCommand {
  kind: 'kick';
  charId: number;
}

/**
 * Move a character. `x`/`z` teleport to explicit coords; omitting both sends
 * them to their zone's revival point ("town").
 */
export interface AdminTeleportCommand {
  kind: 'teleport';
  charId: number;
  x?: number;
  z?: number;
}

/**
 * A mail row was just inserted for this character -- re-push the mailbox and
 * re-evaluate `MODE_MAILBOX` so an online player sees it immediately instead of
 * on next login.
 */
export interface AdminMailPushedCommand {
  kind: 'mail_pushed';
  charId: number;
}

/**
 * Disconnect EVERY online player, flushing each one's state first. For
 * maintenance drains before a restart. `reason` is a free-form audit label.
 *
 * Unlike every other command here this one carries no `charId` -- it is
 * server-wide, so `isCommand` validates it on its own branch.
 */
export interface AdminKickAllCommand {
  kind: 'kick_all';
  reason?: string;
}

export type AdminCommand =
  | AdminKickCommand
  | AdminTeleportCommand
  | AdminMailPushedCommand
  | AdminKickAllCommand;

/** What the listener delegates to. Implemented by `AdminCommandService`. */
export interface AdminCommandSink {
  kick(charId: number): void;
  teleport(charId: number, x?: number, z?: number): void;
  mailPushed(charId: number): void;
  kickAll(reason?: string): Promise<unknown>;
}

/** Free-form audit label; bounded so a bogus payload can't bloat the log. */
const MAX_REASON_LEN = 200;

function isCommand(p: unknown): p is AdminCommand {
  if (p === null || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  // Server-wide commands carry no charId -- check them before the charId gate.
  if (o['kind'] === 'kick_all') {
    const reason = o['reason'];
    return reason === undefined || (typeof reason === 'string' && reason.length <= MAX_REASON_LEN);
  }
  const charId = o['charId'];
  if (typeof charId !== 'number' || !Number.isInteger(charId) || charId <= 0) return false;
  switch (o['kind']) {
    case 'kick':
    case 'mail_pushed':
      return true;
    case 'teleport': {
      // Coords are optional (omitted = revival point), but if present both must
      // be finite and positive -- the C++ `VecInWorld` guard
      // (FuncTextCmd.cpp:2439) rejects x<=0 / z<=0 as off-terrain.
      const x = o['x'];
      const z = o['z'];
      if (x === undefined && z === undefined) return true;
      return (
        typeof x === 'number' && Number.isFinite(x) && x > 0 &&
        typeof z === 'number' && Number.isFinite(z) && z > 0
      );
    }
    default:
      return false;
  }
}

export interface AdminListenerDeps {
  /** IPC bus. Optional at construction; `start()` is a no-op until it's set. */
  bus?: AdminBusPort;
  sink: AdminCommandSink;
}

export class AdminListener {
  private readonly log = createLogger({ module: 'admin-listener' });
  private bus: AdminBusPort | undefined;

  constructor(private readonly deps: AdminListenerDeps) {
    this.bus = deps.bus;
  }

  /** Inject the bus at runtime (after the transport is connected). */
  setBus(bus: AdminBusPort): void {
    this.bus = bus;
  }

  /** Subscribe to the admin channel. Call once on world startup. */
  async start(): Promise<void> {
    if (!this.bus) {
      this.log.warn('No IPC bus -- admin:command listener not started');
      return;
    }
    await this.bus.subscribe<AdminCommand>(ADMIN_COMMAND_CHANNEL, (payload, from) =>
      this.onCommand(payload, from),
    );
    this.log.info({ channel: ADMIN_COMMAND_CHANNEL }, 'Listening for admin commands');
  }

  /** Stop receiving admin commands. */
  stop(): void {
    this.bus?.unsubscribe(ADMIN_COMMAND_CHANNEL);
  }

  /** Bus callback -- shape-validate and dispatch. HMAC already verified. */
  private onCommand(payload: unknown, from: string): void {
    if (!isCommand(payload)) {
      this.log.warn({ from }, 'Malformed admin:command payload -- dropping');
      return;
    }
    this.log.info(
      { from, kind: payload.kind, ...(payload.kind === 'kick_all' ? {} : { charId: payload.charId }) },
      'Admin command received',
    );
    try {
      switch (payload.kind) {
        case 'kick':
          this.deps.sink.kick(payload.charId);
          break;
        case 'teleport':
          this.deps.sink.teleport(payload.charId, payload.x, payload.z);
          break;
        case 'mail_pushed':
          this.deps.sink.mailPushed(payload.charId);
          break;
        case 'kick_all':
          // Async, and the bus is fire-and-forget -- catch here or the rejection
          // escapes to `unhandledRejection`.
          this.deps.sink.kickAll(payload.reason).catch((err: unknown) => {
            this.log.error({ err }, 'Admin kick_all failed');
          });
          break;
      }
    } catch (err) {
      this.log.error({ err, kind: payload.kind }, 'Admin command failed');
    }
  }
}
