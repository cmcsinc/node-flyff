import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { VisibilityService, REFRESH_STEP } from '../../src/services/visibility.service';
import type { CMover, CPlayer, Vec3 } from '@flyff/entities';

/** One packet write recorded per recipient. */
interface Sent { charId: number; kind: string; ids: number[] }

/** `loaded` mirrors `m_vicinitySent`: false until the client's first MAP_KEY. */
function makePlayer(id: number, pos: Vec3, loaded = false): CPlayer {
  return {
    m_idPlayer: id,
    m_nZoneId: 1,
    m_vPos: pos,
    m_vicinitySent: loaded,
    m_known: new Set<number>(),
  } as unknown as CPlayer;
}

function mover(id: number, pos: Vec3): CMover {
  return { m_idMover: id, m_nZoneId: 1, m_vPos: pos } as unknown as CMover;
}

function distSq2(a: Vec3, b: Vec3): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/**
 * Harness: real radius filters, fake serializers that record which ids went to
 * whom. `sent` is the assertion surface -- one entry per socket write.
 */
function harness(players: CPlayer[], movers: CMover[], radius = 100) {
  const sent: Sent[] = [];
  // Tag each fake packet so the recipient/kind/ids are recoverable from `sent`.
  let pending: { kind: string; ids: number[] } | null = null;
  const tag = (kind: string, ids: number[]): Buffer => {
    pending = { kind, ids };
    return Buffer.from([ids.length]);
  };
  const playerManager = {
    get: (id: number): CPlayer | undefined => players.find((p) => p.m_idPlayer === id),
    all: (): CPlayer[] => players,
    sendTo: (p: CPlayer): void => {
      assert.ok(pending, 'sendTo called without a freshly built packet');
      sent.push({ charId: p.m_idPlayer, ...pending });
      pending = null;
    },
  };
  const zoneManager = {
    playersNear: (pos: Vec3, zoneId: number, r: number, except?: CPlayer): CPlayer[] =>
      players.filter((p) => p !== except && p.m_nZoneId === zoneId && distSq2(p.m_vPos, pos) <= r * r),
  };
  const svc = new VisibilityService({
    playerManager, zoneManager,
    spawnManager: { inZone: (z: number) => movers.filter((m) => m.m_nZoneId === z) },
    buildAddMovers: (ms) => tag('addMovers', ms.map((m) => m.m_idMover)),
    buildAddPeers: (ps) => tag('addPeers', ps.map((p) => p.m_idPlayer)),
    buildRemove: (ids) => tag('remove', [...ids]),
    radius,
  } as never);
  return { svc, sent, forCharId: (id: number): Sent[] => sent.filter((s) => s.charId === id) };
}

describe('VisibilityService', () => {
  let alice: CPlayer;
  let bob: CPlayer;

  beforeEach(() => {
    alice = makePlayer(1, { x: 0, y: 0, z: 0 });
    bob = makePlayer(2, { x: 10, y: 0, z: 0 }, true); // already past MAP_KEY
  });

  describe('enterWorld', () => {
    it('streams peers and movers, and links the peer back symmetrically', () => {
      const npc = mover(500, { x: 20, y: 0, z: 0 });
      const h = harness([alice, bob], [npc]);

      assert.equal(h.svc.enterWorld(1), true);

      // Alice learns Bob (peer) + the NPC (mover); Bob learns Alice (reverse link).
      assert.deepEqual(h.forCharId(1), [
        { charId: 1, kind: 'addPeers', ids: [2] },
        { charId: 1, kind: 'addMovers', ids: [500] },
      ]);
      assert.deepEqual(h.forCharId(2), [{ charId: 2, kind: 'addPeers', ids: [1] }]);
      assert.deepEqual([...alice.m_known].sort(), [2, 500]);
      assert.deepEqual([...bob.m_known], [1]);
    });

    it('is a one-shot: a repeat MAP_KEY sends nothing but still succeeds', () => {
      const h = harness([alice, bob], []);
      h.svc.enterWorld(1);
      const before = h.sent.length;

      assert.equal(h.svc.enterWorld(1), true);

      assert.equal(h.sent.length, before);
    });

    it('reports failure for an unknown charId (session desync -> caller drops)', () => {
      const h = harness([alice], []);
      assert.equal(h.svc.enterWorld(999), false);
    });

    it('skips the reverse link for a peer still loading the world', () => {
      const loading = makePlayer(2, { x: 10, y: 0, z: 0 }); // still loading
      const h = harness([alice, loading], []);

      h.svc.enterWorld(1);

      // Alice sees the loading peer, but the peer gets no ADD_OBJ (would deref
      // a null g_pWorld in CDPClient::OnAddObj).
      assert.deepEqual(h.forCharId(1), [{ charId: 1, kind: 'addPeers', ids: [2] }]);
      assert.deepEqual(h.forCharId(2), []);
      assert.equal(loading.m_known.size, 0);
    });
  });

  describe('refresh', () => {
    it('does nothing before the first MAP_KEY (m_vicinitySent false)', () => {
      const loading = makePlayer(1, { x: 0, y: 0, z: 0 }); // still loading
      const h = harness([loading, bob], []);

      h.svc.refresh(1);

      assert.deepEqual(h.sent, []);
    });

    it('DEL_OBJs a peer that walked out of range, on both sides', () => {
      const h = harness([alice, bob], []);
      h.svc.enterWorld(1);
      h.sent.length = 0;

      alice.m_vPos = { x: 5000, y: 0, z: 0 };
      h.svc.refresh(1);

      assert.deepEqual(h.forCharId(1), [{ charId: 1, kind: 'remove', ids: [2] }]);
      assert.deepEqual(h.forCharId(2), [{ charId: 2, kind: 'remove', ids: [1] }]);
      assert.equal(alice.m_known.has(2), false);
      assert.equal(bob.m_known.has(1), false);
    });

    it('DEL_OBJs movers left behind and ADD_OBJs those at the destination', () => {
      const here = mover(500, { x: 0, y: 0, z: 0 });
      const there = mover(501, { x: 5000, y: 0, z: 0 });
      const h = harness([alice], [here, there]);
      h.svc.enterWorld(1);
      h.sent.length = 0;

      alice.m_vPos = { x: 5000, y: 0, z: 0 };
      h.svc.refresh(1);

      assert.deepEqual(h.forCharId(1), [
        { charId: 1, kind: 'addMovers', ids: [501] },
        { charId: 1, kind: 'remove', ids: [500] },
      ]);
      assert.deepEqual([...alice.m_known], [501]);
    });

    it('re-sends nothing when the view is unchanged (no duplicate ADD_OBJ)', () => {
      const npc = mover(500, { x: 20, y: 0, z: 0 });
      const h = harness([alice, bob], [npc]);
      h.svc.enterWorld(1);
      h.sent.length = 0;

      // Move far enough to clear the step gate but not out of anyone's range.
      alice.m_vPos = { x: REFRESH_STEP + 1, y: 0, z: 0 };
      h.svc.refresh(1);

      assert.deepEqual(h.sent, []);
    });

    it('skips the diff until the player has moved a full REFRESH_STEP', () => {
      const far = mover(500, { x: 5000, y: 0, z: 0 });
      const h = harness([alice], [far]);
      h.svc.enterWorld(1);
      h.sent.length = 0;

      // A sub-step nudge toward the mover: gate holds, nothing streams.
      alice.m_vPos = { x: REFRESH_STEP - 1, y: 0, z: 0 };
      h.svc.refresh(1);
      assert.deepEqual(h.sent, []);

      // force bypasses the gate (teleport path) -- still out of range here.
      alice.m_vPos = { x: 5000, y: 0, z: 0 };
      h.svc.refresh(1, true);
      assert.deepEqual(h.forCharId(1), [{ charId: 1, kind: 'addMovers', ids: [500] }]);
    });
  });

  describe('mover spawn / despawn', () => {
    it('ADD_OBJs a respawn only to in-range players that do not know it', () => {
      const npc = mover(500, { x: 20, y: 0, z: 0 });
      const outOfRange = makePlayer(3, { x: 5000, y: 0, z: 0 }, true);
      alice.m_vicinitySent = true; // spawn pushes only to loaded clients
      const h = harness([alice, outOfRange], [npc]);

      h.svc.onMoverSpawn(npc);

      assert.deepEqual(h.forCharId(1), [{ charId: 1, kind: 'addMovers', ids: [500] }]);
      assert.deepEqual(h.forCharId(3), []);
      assert.equal(alice.m_known.has(500), true);

      // Second spawn call for a known mover is a no-op (no duplicate ADD_OBJ).
      h.sent.length = 0;
      h.svc.onMoverSpawn(npc);
      assert.deepEqual(h.sent, []);
    });

    it('DEL_OBJs a despawn to everyone tracking it and forgets it', () => {
      const npc = mover(500, { x: 20, y: 0, z: 0 });
      const h = harness([alice], [npc]);
      h.svc.enterWorld(1);
      h.sent.length = 0;

      h.svc.onMoverDespawn(npc);

      assert.deepEqual(h.forCharId(1), [{ charId: 1, kind: 'remove', ids: [500] }]);
      assert.equal(alice.m_known.has(500), false);
    });
  });

  describe('remove (disconnect)', () => {
    it('DEL_OBJs the leaver from peers and clears their own known-set', () => {
      const h = harness([alice, bob], [mover(500, { x: 20, y: 0, z: 0 })]);
      h.svc.enterWorld(1);
      h.sent.length = 0;

      h.svc.remove(alice);

      assert.deepEqual(h.forCharId(2), [{ charId: 2, kind: 'remove', ids: [1] }]);
      assert.equal(alice.m_known.size, 0);
      assert.equal(bob.m_known.has(1), false);
    });
  });
});
