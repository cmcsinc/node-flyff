/**
 * WorldListService -- Cluster Server query layer for live world state.
 *
 * Provides the Cluster Server's handlers and game logic with a clean,
 * typed API over the raw `WorldRegistry` map. Used when:
 *  - Building the channel-selection response for the game client
 *  - Choosing which world channel to route a player to on character select
 *  - Checking if a specific world is reachable before issuing a player token
 *
 * @module cluster-server/services/worldList.service
 */

import type { WorldRegistry, WorldEntry } from '../ipc/worldRegistry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summarised, serialisable view of a world channel -- safe to send over IPC. */
export interface WorldChannelView {
  readonly serverId: string;
  readonly name: string;
  readonly publicIp: string;
  readonly publicPort: number;
  readonly players: number;
  readonly maxPlayers: number;
  readonly channelId: number;
  /** Whether the world is accepting new players. */
  readonly isAvailable: boolean;
}

export interface WorldListServiceDeps {
  worldRegistry: WorldRegistry;
}

// ---------------------------------------------------------------------------
// WorldListService
// ---------------------------------------------------------------------------

/**
 * Query service for the live world channel list maintained by `WorldRegistry`.
 *
 * All methods are synchronous -- the `WorldRegistry` maintains the in-memory
 * state; no async DB or Redis calls are needed here.
 *
 * @example
 * ```ts
 * // In a packet handler:
 * const worlds = worldListService.getAvailableChannels();
 * // -> build SNSP_CHAR_SELECT_RESP with world IP/port
 * ```
 */
export class WorldListService {
  #deps!: WorldListServiceDeps;

  /** Dependency injection -- call once from compose.ts. */
  init(deps: WorldListServiceDeps): void {
    this.#deps = deps;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns all online world channels sorted by channelId.
   * This is the list shown to clients in the channel selector.
   */
  getAvailableChannels(): WorldChannelView[] {
    return this.#deps.worldRegistry
      .getOnlineWorlds()
      .sort((a, b) => a.channelId - b.channelId)
      .map(toView);
  }

  /**
   * Returns the best available world to route a new player to.
   * Selection strategy: least loaded online world that is not at capacity.
   *
   * @returns The world entry to use, or `null` if all channels are full / offline.
   */
  getBestAvailableWorld(): WorldChannelView | null {
    const worlds = this.#deps.worldRegistry
      .getOnlineWorlds()
      .filter(w => w.players < w.maxPlayers)
      .sort((a, b) => a.players / a.maxPlayers - b.players / b.maxPlayers);

    return worlds[0] !== undefined ? toView(worlds[0]) : null;
  }

  /**
   * Returns a specific world channel by its `channelId`, or `null` if it is
   * not online. Used when a client explicitly picks a channel.
   *
   * @param channelId - The 1-based channel number chosen by the client.
   */
  getChannelById(channelId: number): WorldChannelView | null {
    const world = this.#deps.worldRegistry
      .getOnlineWorlds()
      .find(w => w.channelId === channelId);

    return world !== undefined ? toView(world) : null;
  }

  /**
   * Returns a world by its server ID.
   * Used internally to verify a world is still online before issuing tokens.
   */
  getByServerId(serverId: string): WorldChannelView | null {
    const world = this.#deps.worldRegistry.getWorld(serverId);
    return world && world.status === 'online' ? toView(world) : null;
  }

  /** Total number of players across all online channels. */
  getTotalPlayerCount(): number {
    return this.#deps.worldRegistry
      .getOnlineWorlds()
      .reduce((sum, w) => sum + w.players, 0);
  }

  /** Returns true if at least one online, non-full channel exists. */
  hasCapacity(): boolean {
    return this.#deps.worldRegistry
      .getOnlineWorlds()
      .some(w => w.players < w.maxPlayers);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toView(entry: WorldEntry): WorldChannelView {
  return {
    serverId: entry.serverId,
    name: entry.name,
    publicIp: entry.publicIp,
    publicPort: entry.publicPort,
    players: entry.players,
    maxPlayers: entry.maxPlayers,
    channelId: entry.channelId,
    isAvailable: entry.status === 'online' && entry.players < entry.maxPlayers,
  };
}
