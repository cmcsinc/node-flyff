/**
 * ServerListService — Login Server query layer for the live cluster/server list.
 *
 * Merges two sources of truth:
 *  1. **Static config** (`serverList` from `login-server.json`) — always present,
 *     acts as a fallback if no cluster has dynamically registered yet.
 *  2. **Dynamic registry** (`ClusterRegistry`) — live online clusters with real
 *     player counts and channel data, updated every heartbeat.
 *
 * Dynamic entries always win over static config entries for the same `serverId`.
 * Static entries are shown with `players: 0` and `status: 'offline'` when no
 * live cluster matches — this allows the server list to show "offline" rather
 * than disappearing entirely during a cluster restart.
 *
 * Used by `LoginServer`'s `SNSP_SERVER_LIST` packet builder to populate the
 * server selection screen that players see after authenticating.
 *
 * @module login-server/services/serverList.service
 */

import type { ClusterRegistry, ClusterEntry } from '../ipc/clusterRegistry.js';
import type { ClusterEntrySchema } from '@flyff/core/config';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StaticClusterEntry = z.infer<typeof ClusterEntrySchema>;

/** View of a cluster server entry as sent to game clients via SNSP_SERVER_LIST. */
export interface ServerListEntry {
  /** Display name shown in the client server-selection screen. */
  readonly name: string;
  /** Public IP the client should connect to. */
  readonly ip: string;
  /** Public port the client should connect to. */
  readonly port: number;
  /** Total players currently online across all channels. */
  readonly players: number;
  /** Total capacity across all channels. */
  readonly maxPlayers: number;
  /** Number of world channels online under this cluster. */
  readonly channelCount: number;
  /** Whether the server is accepting new connections. */
  readonly status: 'online' | 'offline' | 'maintenance';
  /** Channel-level breakdown (if dynamic data is available). */
  readonly channels: ReadonlyArray<{
    readonly id: number;
    readonly name: string;
    readonly players: number;
    readonly maxPlayers: number;
    readonly status: 'online' | 'offline' | 'maintenance';
  }>;
}

export interface ServerListServiceDeps {
  /** Dynamic cluster registry populated by live registrations. */
  clusterRegistry: ClusterRegistry;
  /** Static cluster list from config — used as fallback / placeholder. */
  staticServerList: StaticClusterEntry[];
}

// ---------------------------------------------------------------------------
// ServerListService
// ---------------------------------------------------------------------------

/**
 * Merges static config with live dynamic data to produce the server list
 * shown to game clients.
 *
 * @example
 * ```ts
 * // In LoginServer SNSP_LOGIN_WORLD handler:
 * const list = serverListService.getServerList();
 * // → serialize to SNSP_SERVER_LIST packet
 * ```
 */
export class ServerListService {
  #deps!: ServerListServiceDeps;

  init(deps: ServerListServiceDeps): void {
    this.#deps = deps;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the merged server list.
   *
   * **Priority**: dynamic (live) entries override static entries by server name.
   * Static-only entries appear as offline placeholders.
   */
  getServerList(): ServerListEntry[] {
    const live = this.#deps.clusterRegistry.getOnlineClusters();
    const statics = this.#deps.staticServerList;

    // Build a set of names covered by live registrations
    const liveNames = new Set(live.map(c => c.name));

    const result: ServerListEntry[] = [];

    // 1. All live dynamic clusters
    for (const entry of live) {
      result.push(fromDynamic(entry));
    }

    // 2. Static entries not covered by any live cluster (offline placeholders)
    for (const s of statics) {
      if (!liveNames.has(s.name)) {
        result.push(fromStatic(s));
      }
    }

    // Sort: online first, then alphabetical by name
    return result.sort((a, b) => {
      if (a.status === 'online' && b.status !== 'online') return -1;
      if (a.status !== 'online' && b.status === 'online') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Returns a single cluster entry by name, or `null` if not found.
   * Used when the client selects a specific server from the list.
   */
  getClusterByName(name: string): ServerListEntry | null {
    // Dynamic first
    const liveCluster = this.#deps.clusterRegistry
      .getOnlineClusters()
      .find(c => c.name === name);

    if (liveCluster) return fromDynamic(liveCluster);

    // Static fallback
    const staticEntry = this.#deps.staticServerList.find(s => s.name === name);
    if (staticEntry) return fromStatic(staticEntry);

    return null;
  }

  /** True if at least one cluster is online. */
  hasOnlineCluster(): boolean {
    return this.#deps.clusterRegistry.getOnlineClusters().length > 0;
  }

  /** Total players across all online clusters. */
  getTotalPlayerCount(): number {
    return this.#deps.clusterRegistry
      .getOnlineClusters()
      .reduce((sum, c) => sum + c.players, 0);
  }
}

// ---------------------------------------------------------------------------
// Internal mappers
// ---------------------------------------------------------------------------

function fromDynamic(entry: ClusterEntry): ServerListEntry {
  return {
    name: entry.name,
    ip: entry.publicIp,
    port: entry.publicPort,
    players: entry.players,
    maxPlayers: entry.maxPlayers,
    channelCount: entry.worlds.filter(w => w.status === 'online').length,
    status: entry.status,
    channels: entry.worlds.map(w => ({
      id: w.channelId,
      name: w.name,
      players: w.players,
      maxPlayers: w.maxPlayers,
      status: w.status,
    })),
  };
}

function fromStatic(entry: StaticClusterEntry): ServerListEntry {
  return {
    name: entry.name,
    ip: entry.ip,
    port: entry.port,
    players: 0,
    maxPlayers: 0,
    channelCount: 0,
    status: 'offline',
    channels: [],
  };
}
