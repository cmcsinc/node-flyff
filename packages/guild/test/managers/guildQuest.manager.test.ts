/**
 * GuildQuestProcessor tests -- the arena registry, its two deadlines, and the
 * rect geometry.
 *
 * The geometry numbers here are the SHIPPED ones from `propGuildQuest.inc`, so
 * the y-swap assertions are load-bearing rather than illustrative.
 *
 * @module managers/guildQuest.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  GuildQuestProcessor, ptInRect,
  GQP_WORMON, GQP_GETITEM,
  GUILD_QUEST_WORMON_MS, GUILD_QUEST_GETITEM_MS, GUILD_QUEST_SCAN_DEBOUNCE,
  type GuildQuestPropLike,
} from '../../src/managers/guildQuest.manager';

/** `QUEST_WARMON_LV1` as shipped -- id 1, Madrigal (`WI_WORLD_MADRIGAL` = 1). */
const WARMON: GuildQuestPropLike = {
  id: 1,
  worldId: 1,
  wormonId: 20,
  pos: { x: 3892.785, y: 78.038, z: 3960.506 },
  // `Region = 3787, 4064, 4000, 3843` after `SetRect(x1, y2, x2, y1)`.
  rect: { left: 3787, top: 3843, right: 4000, bottom: 4064 },
};

/** A second arena in another world, to exercise the worldId filter. */
const OTHER: GuildQuestPropLike = {
  id: 2, worldId: 7, wormonId: 21,
  pos: { x: 10, y: 0, z: 10 },
  rect: { left: 0, top: 0, right: 100, bottom: 100 },
};

function mk(nowRef: { ms: number }, props: GuildQuestPropLike[] = [WARMON]): GuildQuestProcessor {
  return new GuildQuestProcessor(props, () => nowRef.ms);
}

/** A point inside the shipped rect. */
const INSIDE = { x: 3892, z: 3960 };

describe('GuildQuestProcessor', () => {
  describe('prop table', () => {
    it('round-trips props by id', () => {
      const p = mk({ ms: 0 }, [WARMON, OTHER]);
      assert.equal(p.getProp(1)?.wormonId, 20);
      assert.equal(p.getProp(2)?.wormonId, 21);
      assert.equal(p.getProp(99), undefined);
      assert.equal(p.allProps().length, 2);
    });

    it('rectOf returns the y-swapped rect', () => {
      const p = mk({ ms: 0 });
      assert.deepEqual(p.rectOf(1), WARMON.rect);
      assert.equal(p.rectOf(99), undefined);
    });
  });

  describe('open', () => {
    it('refuses an unknown quest id and creates no elem', () => {
      // C++ calls `Error("")` and returns without touching the slot
      // (`guildquest.cpp:184`).
      const p = mk({ ms: 0 });
      assert.equal(p.open(99, 0, 14, 1, 10, 0x40000001), undefined);
      assert.equal(p.isQuesting(99), false);
      assert.equal(p.all().length, 0);
    });

    it('stamps the 60-minute deadline and the two outcome states', () => {
      const now = { ms: 1_000_000 };
      const p = mk(now);
      const e = p.open(1, 0, 14, 1, 10, 0x40000001);
      assert.ok(e);
      assert.equal(e.process, GQP_WORMON);
      assert.equal(e.endsAt, now.ms + GUILD_QUEST_WORMON_MS);
      assert.equal(GUILD_QUEST_WORMON_MS, 60 * 60 * 1000, 'MIN( 60 ) -- guildquest.cpp:200');
      assert.equal(e.state, 0);
      assert.equal(e.ns, 14, 'success state');
      assert.equal(e.nf, 1, 'failure state');
      assert.equal(e.guildId, 10);
      assert.equal(e.bossObjid, 0x40000001);
      assert.equal(e.count, 0);
    });

    it('isQuesting is per quest id and GUILD-BLIND', () => {
      // This is the world-exclusivity rule: `IsQuesting` tests one global slot
      // (`guildquest.cpp:242-253`), so with a single defined quest exactly one
      // guild holds the arena for the whole world. A second guild asking gets
      // the same `true` -- there is no per-guild dimension to query.
      const p = mk({ ms: 0 });
      p.open(1, 0, 14, 1, 10, 0x40000001);
      assert.equal(p.isQuesting(1), true);
      assert.equal(p.isQuesting(2), false, 'a different quest id is unaffected');
      assert.equal(p.get(1)?.guildId, 10, 'and the holder is guild 10, not the asker');
    });
  });

  describe('toGetItem', () => {
    it('switches to the 20-minute loot window and zeroes four fields', () => {
      const now = { ms: 500 };
      const p = mk(now);
      const e = p.open(1, 5, 14, 1, 10, 0x40000001);
      assert.ok(e);
      now.ms = 900;
      p.toGetItem(e);
      assert.equal(e.process, GQP_GETITEM);
      assert.equal(e.endsAt, 900 + GUILD_QUEST_GETITEM_MS);
      assert.equal(GUILD_QUEST_GETITEM_MS, 20 * 60 * 1000, 'MIN( 20 ) -- Mover.cpp:7505');
      // `Mover.cpp:7506-7508` zeroes all of these.
      assert.equal(e.ns, 0);
      assert.equal(e.nf, 0);
      assert.equal(e.state, 0);
      assert.equal(e.bossObjid, undefined, 'objidWormon = NULL_ID');
    });

    it('clearing the objid makes a second death lookup miss', () => {
      const p = mk({ ms: 0 });
      const e = p.open(1, 0, 14, 1, 10, 0x40000001);
      assert.ok(e);
      p.toGetItem(e);
      const stillMatches = p.all().some((x) => x.bossObjid === 0x40000001);
      assert.equal(stillMatches, false);
    });
  });

  describe('close', () => {
    it('removes the arena; a second close is a no-op', () => {
      const p = mk({ ms: 0 });
      p.open(1, 0, 14, 1, 10, 0x40000001);
      assert.equal(p.close(1), true);
      assert.equal(p.isQuesting(1), false);
      assert.equal(p.close(1), false);
    });
  });

  describe('isExpired', () => {
    it('is strictly `endsAt < now` -- exactly-equal is NOT expired', () => {
      // `pElem->dwEndTime < dwTickCount` (`guildquest.cpp:37`).
      const now = { ms: 0 };
      const p = mk(now);
      const e = p.open(1, 0, 14, 1, 10, 0x40000001);
      assert.ok(e);
      assert.equal(p.isExpired(e, e.endsAt - 1), false);
      assert.equal(p.isExpired(e, e.endsAt), false, 'boundary: equal is not past');
      assert.equal(p.isExpired(e, e.endsAt + 1), true);
    });
  });

  describe('bumpScan', () => {
    it('suppresses the first nine calls and clears on the tenth, forever after', () => {
      // `if( ++pElem->nCount < 10 ) continue;` (`guildquest.cpp:88`). C++ never
      // resets `nCount`, so once cleared every later tick scans.
      const p = mk({ ms: 0 });
      const e = p.open(1, 0, 14, 1, 10, 0x40000001);
      assert.ok(e);
      assert.equal(GUILD_QUEST_SCAN_DEBOUNCE, 10);
      for (let i = 1; i <= 9; i++) {
        assert.equal(p.bumpScan(e), false, `call ${i} still debounced`);
      }
      assert.equal(p.bumpScan(e), true, 'tenth call clears');
      assert.equal(p.bumpScan(e), true, 'and stays cleared');
      assert.equal(e.count, 11);
    });
  });
});

describe('ptInRect', () => {
  const r = WARMON.rect;

  it('is left/top INCLUSIVE and right/bottom EXCLUSIVE', () => {
    // Win32 `CRect::PtInRect` semantics -- the reason the y-swap must happen
    // first: an unswapped rect has top > bottom and every point is outside.
    assert.equal(ptInRect(r, { x: r.left, z: r.top }), true, 'top-left corner in');
    assert.equal(ptInRect(r, { x: r.left - 1, z: r.top }), false, 'left edge exclusive below');
    assert.equal(ptInRect(r, { x: r.right, z: r.top }), false, 'right edge exclusive');
    assert.equal(ptInRect(r, { x: r.right - 1, z: r.top }), true);
    assert.equal(ptInRect(r, { x: r.left, z: r.top - 1 }), false, 'above top is out');
    assert.equal(ptInRect(r, { x: r.left, z: r.bottom }), false, 'bottom edge exclusive');
    assert.equal(ptInRect(r, { x: r.left, z: r.bottom - 1 }), true);
  });

  it('the swapped rect is non-empty -- top < bottom', () => {
    assert.ok(r.top < r.bottom, 'SetRect(x1, y2, x2, y1) is what makes this hold');
    assert.equal(ptInRect(r, INSIDE), true);
  });

  it('ignores y -- a flying player above the arena is inside', () => {
    // `PtInRect` is fed `{ (int)vPos.x, (int)vPos.z }` (`guildquest.cpp:276`),
    // so altitude never enters the test.
    assert.equal(ptInRect(r, { x: 3892, z: 3960 }), true);
  });
});

describe('rectAt / isQuestRegion', () => {
  it('rectAt finds the quest id containing the point', () => {
    const p = mk({ ms: 0 }, [WARMON, OTHER]);
    assert.equal(p.rectAt(INSIDE), 1);
    assert.equal(p.rectAt({ x: 10, z: 10 }), 2);
    assert.equal(p.rectAt({ x: -5000, z: -5000 }), undefined);
  });

  it('filters on worldId when one is given', () => {
    const p = mk({ ms: 0 }, [WARMON, OTHER]);
    assert.equal(p.rectAt(INSIDE, 1), 1, 'right world');
    assert.equal(p.rectAt(INSIDE, 7), undefined, 'same point, wrong world');
    assert.equal(p.rectAt({ x: 10, z: 10 }, 7), 2);
  });

  it('isQuestRegion is a PROP scan -- true with NO arena open', () => {
    // `CProject::IsGuildQuestRegion` (`Project.cpp:4635`) walks the prop table,
    // not the live elems, which is why the rect suppresses teleports and summons
    // whether or not anyone is questing. This is the distinction from
    // `rectAt` + `get`.
    const p = mk({ ms: 0 });
    assert.equal(p.isQuesting(1), false, 'nothing live');
    assert.equal(p.isQuestRegion(INSIDE), true);
    assert.equal(p.isQuestRegion(INSIDE, 1), true);
    assert.equal(p.isQuestRegion(INSIDE, 7), false);
    assert.equal(p.isQuestRegion({ x: 0, z: 0 }), false);
  });
});
