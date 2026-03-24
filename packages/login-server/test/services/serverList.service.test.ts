/**
 * Tests for ServerListService.
 *
 * ClusterRegistry is replaced with a lightweight mock that implements only
 * the `getOnlineClusters()` method used by the service.
 *
 * @module login-server/services/serverList.service.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { ServerListService } from '../../src/services/serverList.service.js';
import type { ClusterEntry } from '../../src/ipc/clusterRegistry.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal ClusterRegistry mock.
 * Only `getOnlineClusters` is used by ServerListService — all other methods
 * are absent and will throw if accidentally called.
 */
function makeRegistryMock(onlineClusters: ClusterEntry[]) {
  return {
    getOnlineClusters: () => onlineClusters,
  };
}

/**
 * Builds a realistic `ClusterEntry` with sane defaults.
 * Individual tests override only the fields they care about.
 */
function makeClusterEntry(overrides: Partial<ClusterEntry> = {}): ClusterEntry {
  return {
    serverId: 'cluster-1',
    name: 'Madrigal',
    publicIp: '127.0.0.1',
    publicPort: 38100,
    players: 42,
    maxPlayers: 500,
    worlds: [
      {
        channelId: 1,
        name: 'Channel 1',
        players: 42,
        maxPlayers: 500,
        status: 'online',
      },
    ],
    status: 'online',
    registeredAt: new Date('2026-01-01'),
    lastHeartbeatMs: Date.now(),
    // Tests that need `socket` can override — the service never touches it
    socket: null as unknown as import('node:net').Socket,
    ...overrides,
  };
}

/** A static config entry for the same cluster name as makeClusterEntry(). */
const staticMadrigal = {
  name: 'Madrigal',
  ip: '10.0.0.1',
  port: 38100,
  channels: 1,
};

/** A static config entry for a second cluster not online in tests. */
const staticAqualia = {
  name: 'Aqualia',
  ip: '10.0.0.2',
  port: 38100,
  channels: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(
  onlineClusters: ClusterEntry[],
  staticServerList: typeof staticMadrigal[] = [],
): ServerListService {
  const svc = new ServerListService();
  svc.init({
    // Cast: the mock satisfies the narrow interface the service actually uses.
    clusterRegistry: makeRegistryMock(onlineClusters) as unknown as import('../ipc/clusterRegistry.js').ClusterRegistry,
    staticServerList,
  });
  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServerListService.getServerList()', () => {
  it('returns all static entries as offline when no clusters are live', () => {
    const svc = makeService([], [staticMadrigal, staticAqualia]);
    const list = svc.getServerList();

    assert.equal(list.length, 2);

    // Both must be offline
    for (const entry of list) {
      assert.equal(entry.status, 'offline');
      assert.equal(entry.players, 0);
      assert.equal(entry.maxPlayers, 0);
      assert.equal(entry.channelCount, 0);
      assert.deepEqual(entry.channels, []);
    }
  });

  it('returns the static entry ip/port when offline', () => {
    const svc = makeService([], [staticMadrigal]);
    const list = svc.getServerList();

    assert.equal(list.length, 1);
    assert.equal(list[0]?.ip, staticMadrigal.ip);
    assert.equal(list[0]?.port, staticMadrigal.port);
    assert.equal(list[0]?.name, staticMadrigal.name);
  });

  it('returns a live cluster entry with real player count and status online', () => {
    const live = makeClusterEntry({ players: 100, maxPlayers: 500 });
    const svc = makeService([live], [staticMadrigal]);
    const list = svc.getServerList();

    assert.equal(list.length, 1); // static Madrigal is replaced by live
    const entry = list[0];
    assert.ok(entry);
    assert.equal(entry.name, 'Madrigal');
    assert.equal(entry.status, 'online');
    assert.equal(entry.players, 100);
    assert.equal(entry.maxPlayers, 500);
    assert.equal(entry.ip, '127.0.0.1'); // from dynamic entry, not static
  });

  it('dynamic entry overrides static entry for the same server name', () => {
    const live = makeClusterEntry({ name: 'Madrigal', players: 77 });
    const svc = makeService([live], [staticMadrigal]);
    const list = svc.getServerList();

    // Only one entry for Madrigal — not two
    const madrigalEntries = list.filter(e => e.name === 'Madrigal');
    assert.equal(madrigalEntries.length, 1);

    // The dynamic entry wins
    assert.equal(madrigalEntries[0]?.status, 'online');
    assert.equal(madrigalEntries[0]?.players, 77);
  });

  it('shows static-only entries alongside live entries when names differ', () => {
    const live = makeClusterEntry({ name: 'Madrigal', players: 50 });
    // Aqualia has no live cluster — should appear as offline
    const svc = makeService([live], [staticMadrigal, staticAqualia]);
    const list = svc.getServerList();

    assert.equal(list.length, 2);

    const madrigal = list.find(e => e.name === 'Madrigal');
    const aqualia = list.find(e => e.name === 'Aqualia');

    assert.ok(madrigal);
    assert.ok(aqualia);
    assert.equal(madrigal.status, 'online');
    assert.equal(aqualia.status, 'offline');
  });

  it('returns 1 entry with empty static config and 1 live cluster', () => {
    const live = makeClusterEntry();
    const svc = makeService([live], []);
    const list = svc.getServerList();

    assert.equal(list.length, 1);
    assert.equal(list[0]?.name, 'Madrigal');
    assert.equal(list[0]?.status, 'online');
  });

  it('returns empty list when both static and dynamic are empty', () => {
    const svc = makeService([], []);
    const list = svc.getServerList();
    assert.equal(list.length, 0);
  });

  it('sorts online entries before offline entries', () => {
    // Aqualia is offline (static only), Madrigal is online (live)
    const live = makeClusterEntry({ name: 'Madrigal' });
    const svc = makeService([live], [staticAqualia]);
    const list = svc.getServerList();

    assert.equal(list[0]?.status, 'online');
    assert.equal(list[1]?.status, 'offline');
  });

  it('sorts entries with same status alphabetically by name', () => {
    // Two online clusters
    const clusterA = makeClusterEntry({ serverId: 'b', name: 'Zenith' });
    const clusterB = makeClusterEntry({ serverId: 'a', name: 'Alpha' });
    const svc = makeService([clusterA, clusterB], []);
    const list = svc.getServerList();

    assert.equal(list[0]?.name, 'Alpha');
    assert.equal(list[1]?.name, 'Zenith');
  });

  it('exposes channel breakdown from live world entries', () => {
    const live = makeClusterEntry({
      worlds: [
        { channelId: 1, name: 'Ch.1', players: 20, maxPlayers: 250, status: 'online' },
        { channelId: 2, name: 'Ch.2', players: 10, maxPlayers: 250, status: 'online' },
      ],
      players: 30,
      maxPlayers: 500,
    });
    const svc = makeService([live], []);
    const list = svc.getServerList();

    const entry = list[0];
    assert.ok(entry);
    assert.equal(entry.channelCount, 2);
    assert.equal(entry.channels.length, 2);
    assert.equal(entry.channels[0]?.id, 1);
    assert.equal(entry.channels[1]?.id, 2);
  });

  it('channelCount counts only online world channels', () => {
    const live = makeClusterEntry({
      worlds: [
        { channelId: 1, name: 'Ch.1', players: 10, maxPlayers: 250, status: 'online' },
        { channelId: 2, name: 'Ch.2', players: 0, maxPlayers: 250, status: 'maintenance' },
      ],
      players: 10,
      maxPlayers: 500,
    });
    const svc = makeService([live], []);
    const list = svc.getServerList();
    // maintenance channel does not count toward channelCount
    assert.equal(list[0]?.channelCount, 1);
  });
});

// ---------------------------------------------------------------------------
// getClusterByName()
// ---------------------------------------------------------------------------

describe('ServerListService.getClusterByName()', () => {
  it('returns dynamic entry when cluster is live', () => {
    const live = makeClusterEntry({ name: 'Madrigal', players: 99 });
    const svc = makeService([live], [staticMadrigal]);
    const result = svc.getClusterByName('Madrigal');

    assert.ok(result !== null);
    assert.equal(result.status, 'online');
    assert.equal(result.players, 99);
  });

  it('returns static offline entry when cluster is not live', () => {
    const svc = makeService([], [staticMadrigal]);
    const result = svc.getClusterByName('Madrigal');

    assert.ok(result !== null);
    assert.equal(result.status, 'offline');
    assert.equal(result.players, 0);
  });

  it('returns null for an unknown server name', () => {
    const svc = makeService([], [staticMadrigal]);
    const result = svc.getClusterByName('DoesNotExist');
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// hasOnlineCluster()
// ---------------------------------------------------------------------------

describe('ServerListService.hasOnlineCluster()', () => {
  it('returns false when no clusters are live', () => {
    const svc = makeService([], [staticMadrigal]);
    assert.equal(svc.hasOnlineCluster(), false);
  });

  it('returns true when at least one cluster is live', () => {
    const svc = makeService([makeClusterEntry()], []);
    assert.equal(svc.hasOnlineCluster(), true);
  });
});

// ---------------------------------------------------------------------------
// getTotalPlayerCount()
// ---------------------------------------------------------------------------

describe('ServerListService.getTotalPlayerCount()', () => {
  it('returns 0 when no clusters are live', () => {
    const svc = makeService([], []);
    assert.equal(svc.getTotalPlayerCount(), 0);
  });

  it('sums players across all live clusters', () => {
    const c1 = makeClusterEntry({ serverId: 'c1', name: 'Alpha', players: 50 });
    const c2 = makeClusterEntry({ serverId: 'c2', name: 'Beta', players: 30 });
    const svc = makeService([c1, c2], []);
    assert.equal(svc.getTotalPlayerCount(), 80);
  });
});
