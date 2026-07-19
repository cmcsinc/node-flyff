/**
 * ClusterListener — World side of the cluster→world player handoff.
 *
 * Subscribes to the `player:handoff` channel on the shared `IpcBus`. The bus
 * verifies the HMAC signature and 30s freshness (rule 07) before this listener
 * ever sees the payload — so by the time `onHandoff` runs, the message is
 * authenticated. Here we only validate the payload *shape* and stash the
 * pending handoff for single-use consumption when the player's JOIN arrives.
 *
 * The handoff is single-use: `consume(token)` deletes the entry so a captured
 * token cannot be replayed for a second join.
 *
 * @module ipc/clusterListener
 */

import { createLogger } from '@flyff/core/logger.js';

/** IPC channel carrying the cluster→world handoff (rule 07 naming `<domain>:<action>`). */
export const PLAYER_HANDOFF_CHANNEL = 'player:handoff';

/** Minimal bus port the listener needs — `IpcBus` satisfies it. */
export interface ClusterBusPort {
  subscribe<T>(channel: string, handler: (payload: T, from: string) => void | Promise<void>): Promise<void>;
  unsubscribe(channel: string): void;
}

/** Handoff payload contract — matches `CharSelectService.prejoin`. */
export interface PlayerHandoff {
  charId: number;
  token: string;
  worldId: string;
}

/** Result handed to the join path when a token is redeemed. */
export interface ConsumedHandoff {
  charId: number;
  worldId: string;
}

interface PendingEntry {
  worldId: string;
  expiresAt: number;
}

/** Default handoff TTL — must be ≥ the cluster-side token cache TTL (60s). */
const DEFAULT_HANDOFF_TTL_MS = 90_000;

function isHandoff(p: unknown): p is PlayerHandoff {
  if (p === null || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  const charId = o['charId'];
  const token = o['token'];
  const worldId = o['worldId'];
  return (
    typeof charId === 'number' && Number.isInteger(charId) && charId > 0 &&
    typeof token === 'string' && token.length > 0 &&
    typeof worldId === 'string' && worldId.length > 0
  );
}

export interface ClusterListenerDeps {
  /** IPC bus. Optional at construction; `start()` is a no-op until it's set. */
  bus?: ClusterBusPort;
  handoffTtlMs?: number;
}

export class ClusterListener {
  private readonly log = createLogger({ module: 'cluster-listener' });
  private readonly pending = new Map<number, PendingEntry>();
  private readonly ttlMs: number;
  private bus: ClusterBusPort | undefined;

  constructor(deps: ClusterListenerDeps) {
    this.ttlMs = deps.handoffTtlMs ?? DEFAULT_HANDOFF_TTL_MS;
    this.bus = deps.bus;
  }

  /** Inject the bus at runtime (after Redis is connected). */
  setBus(bus: ClusterBusPort): void {
    this.bus = bus;
  }

  /** Subscribe to the handoff channel. Call once on world startup. */
  async start(): Promise<void> {
    if (!this.bus) {
      this.log.warn('No IPC bus — player:handoff listener not started');
      return;
    }
    await this.bus.subscribe<PlayerHandoff>(PLAYER_HANDOFF_CHANNEL, (payload, from) =>
      this.onHandoff(payload, from),
    );
    this.log.info({ channel: PLAYER_HANDOFF_CHANNEL }, 'Listening for player handoffs');
  }

  /** Stop receiving handoffs. */
  stop(): void {
    this.bus?.unsubscribe(PLAYER_HANDOFF_CHANNEL);
    this.pending.clear();
  }

  /** Bus callback — shape-validate and stash. HMAC already verified by the bus. */
  private onHandoff(payload: unknown, from: string): void {
    if (!isHandoff(payload)) {
      this.log.warn({ from }, 'Malformed player:handoff payload — dropping');
      return;
    }
    this.pending.set(payload.charId, {
      worldId: payload.worldId,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.log.debug({ charId: payload.charId, from }, 'Player handoff received');
  }

  /**
   * Redeem the handoff for a character. Single-use — the entry is deleted on
   * read so the same character cannot join twice on one handoff. The client
   * carries no token (matches the C++ JOIN flow where trust is the cache
   * relay, not a client credential); the signed IPC publish is the auth.
   * Returns null if `charId` is unknown or the handoff expired.
   */
  consumeByCharId(charId: number): ConsumedHandoff | null {
    const entry = this.pending.get(charId);
    if (!entry) return null;
    this.pending.delete(charId);
    if (Date.now() > entry.expiresAt) return null;
    return { charId, worldId: entry.worldId };
  }
}
