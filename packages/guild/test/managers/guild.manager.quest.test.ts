/**
 * GuildManager quest-ledger tests -- `CGuild::SetQuest` / `FindQuest` /
 * `RemoveQuest` (`guild.cpp:909-979`) plus the `SendQueryGuildQuest` hydrate.
 *
 * Separate from `guild.manager.test.ts` so the ledger half stays reviewable on
 * its own.
 *
 * @module managers/guild.manager.quest.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { GuildManager, type GuildQuestPersistence } from '../../src/managers/guild.manager';

/** Recording persistence port. `fail` makes every call reject. */
function mkRepo(fail = false) {
  const upserts: Array<{ guildId: number; questId: number; state: number }> = [];
  const removes: Array<{ guildId: number; questId: number }> = [];
  let rows = new Map<number, { guildId: number; questId: number; state: number }[]>();
  const repo: GuildQuestPersistence = {
    loadAll: async () => (fail ? Promise.reject(new Error('boom')) : rows),
    upsert: async (guildId, questId, state) => {
      upserts.push({ guildId, questId, state });
      if (fail) throw new Error('boom');
    },
    remove: async (guildId, questId) => {
      removes.push({ guildId, questId });
      if (fail) throw new Error('boom');
    },
  };
  return { repo, upserts, removes, setRows: (r: typeof rows) => { rows = r; } };
}

/** Let a fire-and-forget rejection settle so it does not leak. */
const settle = (): Promise<void> => new Promise((r) => { setImmediate(r); });

describe('GuildManager quest ledger', () => {
  let guilds: GuildManager;
  let ga: number;

  beforeEach(() => {
    guilds = new GuildManager();
    ga = guilds.create('Alpha', 1, [2, 3])!.id;
  });

  it('a new guild starts with an empty ledger', () => {
    assert.deepEqual(guilds.get(ga)?.quests, []);
  });

  it('setQuest on an unknown guild returns undefined', () => {
    assert.equal(guilds.setQuest(9999, 1, 0), undefined);
  });

  it('appends, then UPDATES in place for the same quest id', () => {
    assert.equal(guilds.setQuest(ga, 1, 0)?.state, 0);
    assert.equal(guilds.get(ga)?.quests.length, 1);
    assert.equal(guilds.setQuest(ga, 1, 14)?.state, 14);
    assert.equal(guilds.get(ga)?.quests.length, 1, 'no duplicate slot');
    assert.equal(guilds.getQuest(ga, 1)?.state, 14);
  });

  it('holds several distinct quest ids', () => {
    guilds.setQuest(ga, 1, 0);
    guilds.setQuest(ga, 2, 5);
    assert.equal(guilds.get(ga)?.quests.length, 2);
    assert.equal(guilds.getQuest(ga, 2)?.state, 5);
  });

  it('getQuest returns undefined for an absent entry or guild', () => {
    assert.equal(guilds.getQuest(ga, 1), undefined);
    assert.equal(guilds.getQuest(9999, 1), undefined);
  });

  it('removeQuest splices; a second call and an unknown guild are false', () => {
    guilds.setQuest(ga, 1, 0);
    guilds.setQuest(ga, 2, 0);
    assert.equal(guilds.removeQuest(ga, 1), true);
    assert.equal(guilds.get(ga)?.quests.length, 1, 'no -1 tombstone hole');
    assert.equal(guilds.getQuest(ga, 1), undefined);
    assert.equal(guilds.removeQuest(ga, 1), false);
    assert.equal(guilds.removeQuest(9999, 2), false);
  });

  it('caps the ledger at 255 entries', () => {
    // `m_nQuestSize` is a **BYTE** (`guild.h:348`) against
    // `MAX_GUILD_QUEST == 256` (`guildquest.h:10`), so the original's own wire
    // count wraps at 256. The bound is defensive -- the shipped data defines one
    // quest -- but a silently-truncated count byte would desync the whole roster.
    for (let i = 1; i <= 255; i++) assert.ok(guilds.setQuest(ga, i, 0));
    assert.equal(guilds.get(ga)?.quests.length, 255);
    assert.equal(guilds.setQuest(ga, 256, 0), undefined, 'the 256th is refused');
    assert.equal(guilds.get(ga)?.quests.length, 255, 'and the array did not grow');
    // An UPDATE to an existing id still works at the cap.
    assert.equal(guilds.setQuest(ga, 1, 14)?.state, 14);
  });

  describe('persistence', () => {
    it('setQuest upserts and removeQuest removes', async () => {
      const { repo, upserts, removes } = mkRepo();
      guilds.setQuestRepo(repo);
      guilds.setQuest(ga, 1, 0);
      guilds.setQuest(ga, 1, 14);
      guilds.removeQuest(ga, 1);
      await settle();
      assert.deepEqual(upserts, [
        { guildId: ga, questId: 1, state: 0 },
        { guildId: ga, questId: 1, state: 14 },
      ]);
      assert.deepEqual(removes, [{ guildId: ga, questId: 1 }]);
    });

    it('a rejecting port does not throw out of the synchronous call', async () => {
      // Fire-and-forget: a DB failure must never break a live roster broadcast,
      // so each call swallows its rejection into a log line.
      const { repo } = mkRepo(true);
      guilds.setQuestRepo(repo);
      assert.doesNotThrow(() => { guilds.setQuest(ga, 1, 0); });
      assert.doesNotThrow(() => { guilds.removeQuest(ga, 1); });
      await settle();
      // In-memory state still advanced despite the failed writes.
      assert.equal(guilds.getQuest(ga, 1), undefined, 'removed in memory');
    });

    it('no port at all is pure in-memory', () => {
      assert.ok(guilds.setQuest(ga, 1, 0));
      assert.equal(guilds.getQuest(ga, 1)?.state, 0);
    });
  });

  describe('hydrateQuests', () => {
    it('is a no-op with no port', async () => {
      await guilds.hydrateQuests();
      assert.deepEqual(guilds.get(ga)?.quests, []);
    });

    it('lands entries on the right guilds', async () => {
      const gb = guilds.create('Beta', 100)!.id;
      const { repo, setRows } = mkRepo();
      setRows(new Map([
        [ga, [{ guildId: ga, questId: 1, state: 14 }, { guildId: ga, questId: 2, state: 0 }]],
        [gb, [{ guildId: gb, questId: 1, state: 1 }]],
      ]));
      guilds.setQuestRepo(repo);
      await guilds.hydrateQuests();
      assert.equal(guilds.get(ga)?.quests.length, 2);
      assert.equal(guilds.getQuest(ga, 1)?.state, 14);
      assert.equal(guilds.getQuest(gb, 1)?.state, 1);
    });

    it('DROPS rows for an unknown guild without throwing', async () => {
      // The C++ consumer reads unknown guilds' rows into a throwaway
      // `CGuild waste` purely to keep the stream aligned
      // (`DPDatabaseClient.cpp:2362`), i.e. it discards them too.
      const { repo, setRows } = mkRepo();
      setRows(new Map([
        [ga, [{ guildId: ga, questId: 1, state: 14 }]],
        [4242, [{ guildId: 4242, questId: 1, state: 0 }]],
      ]));
      guilds.setQuestRepo(repo);
      await assert.doesNotReject(() => guilds.hydrateQuests());
      assert.equal(guilds.getQuest(ga, 1)?.state, 14, 'the known guild still loaded');
      assert.equal(guilds.get(4242), undefined);
    });

    it('replaces rather than appends, so a re-hydrate is idempotent', async () => {
      const { repo, setRows } = mkRepo();
      setRows(new Map([[ga, [{ guildId: ga, questId: 1, state: 14 }]]]));
      guilds.setQuestRepo(repo);
      await guilds.hydrateQuests();
      await guilds.hydrateQuests();
      assert.equal(guilds.get(ga)?.quests.length, 1);
    });
  });
});
