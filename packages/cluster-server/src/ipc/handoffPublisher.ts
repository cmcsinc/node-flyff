/**
 * Cluster->World player handoff publisher.
 *
 * Implements the `HandoffPublisher` port consumed by `CharSelectService`. On
 * PRE_JOIN success the cluster publishes a signed `player:handoff` envelope on
 * the shared `IpcBus`; the world-side `ClusterListener` redeems it when the
 * client's JOIN arrives (rule 07 -- HMAC + 30 s freshness enforced by the bus).
 *
 * The bus is optional at construction (mirrors the world-side `ClusterListener`
 * pattern): if Redis is not configured the publish is a logged no-op so the
 * cluster still boots and char-select still works in `memory` dev mode. The
 * signed-envelope construction stays in the bus layer, not here.
 *
 * @module ipc/handoffPublisher
 */

import { createLogger } from '@flyff/core/logger.js';
import type { HandoffPublisher } from '../services/charSelect.service.js';

/** IPC channel carrying the cluster->world handoff (rule 07 `<domain>:<action>`). */
export const PLAYER_HANDOFF_CHANNEL = 'player:handoff';

/** Minimal bus port the publisher needs -- `IpcBus` satisfies it. */
export interface PublisherBusPort {
  publish<T>(channel: string, payload: T): Promise<void>;
}

const logger = createLogger({ module: 'handoff-publisher' });

export class ClusterHandoffPublisher implements HandoffPublisher {
  private bus: PublisherBusPort | undefined;

  constructor(deps: { bus?: PublisherBusPort } = {}) {
    this.bus = deps.bus;
  }

  /** Inject the bus at runtime (after Redis is connected). */
  setBus(bus: PublisherBusPort): void {
    this.bus = bus;
  }

  async publish(charId: number, token: string, worldId: string): Promise<void> {
    if (!this.bus) {
      logger.warn(
        { charId, worldId },
        'player:handoff dropped (no IPC bus -- cache adapter != redis)',
      );
      return;
    }
    await this.bus.publish(PLAYER_HANDOFF_CHANNEL, { charId, token, worldId });
    logger.debug({ charId, worldId }, 'player:handoff published');
  }
}
