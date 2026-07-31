import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  itemRows,
  moverRows,
  skillRows,
  dropRows,
  setItemRows,
  zoneRows,
  dialogueRows,
  BELLI_INFO,
} from "../lib/resource-rows";

/**
 * These run against the real `packages/resources/data`, because the bugs this
 * module exists to prevent are all "the shipped data does not look the way the
 * page assumed" — a token left unresolved, a name defaulted to `"?"`, a numeric
 * flattened to a display string. A fixture would assume the same shape twice.
 */

describe("itemRows", () => {
  const rows = itemRows();

  it("parses every item with both kind labels resolved", () => {
    assert.ok(rows.length > 1000, `expected the full item set, got ${String(rows.length)}`);
    for (const r of rows) {
      assert.ok(r.id > 0, `item ${r.name} has no id`);
      // A label must never still be the raw symbol-with-prefix.
      assert.doesNotMatch(r.kind2, /^IK2_/, `unresolved IK2 label on item ${String(r.id)}`);
      assert.doesNotMatch(r.kind3, /^IK3_/, `unresolved IK3 label on item ${String(r.id)}`);
    }
  });

  it("never substitutes a placeholder for a missing name", () => {
    assert.equal(rows.filter((r) => r.name === "?").length, 0);
  });

  it("sorts by id", () => {
    assert.deepEqual([...rows].sort((a, b) => a.id - b.id).map((r) => r.id), rows.map((r) => r.id));
  });
});

describe("moverRows", () => {
  const rows = moverRows();

  it("labels belligerence and flags sight-aggro consistently", () => {
    assert.ok(rows.length > 100);
    for (const r of rows) {
      if (r.belli === 0) {
        assert.equal(r.belliLabel, "", "belligerence 0 must read as absent, not as a label");
        assert.equal(r.belliSym, "");
        assert.equal(r.aggro, false);
        continue;
      }
      const info = BELLI_INFO.get(r.belli);
      assert.ok(info, `unmapped belligerence ${String(r.belli)} on ${r.key}`);
      assert.equal(r.belliLabel, info.label);
      assert.equal(r.belliSym, info.symbol);
      // ACTIVE_BELLI in @flyff/entities: only the four ACTIVEATTACK* values
      // sight-aggro. 11/12/13 counterattack via the damage path only.
      assert.equal(r.aggro, [3, 5, 6, 7].includes(r.belli), `aggro wrong for ${info.symbol}`);
    }
  });

  it("gives every mover a unique MI_ key, even where ids collide", () => {
    // defineObj.h reuses ids 56-59 across two MI_* blocks, so the row key must be
    // the symbol; this asserts the symbol is actually usable as one.
    const keys = rows.map((r) => r.key).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, "MI_ keys must be unique");
    assert.ok(new Set(rows.map((r) => r.id)).size < rows.length, "expected the known id collisions");
  });
});

describe("skillRows", () => {
  it("carries the job marker from the source file onto every row", () => {
    const rows = skillRows();
    assert.ok(rows.length > 100);
    assert.ok(rows.every((r) => r.job.length > 0), "every skill file declares a _job");
    assert.ok(new Set(rows.map((r) => r.job)).size > 5, "expected several job files");
  });
});

describe("dropRows", () => {
  const rows = dropRows();

  it("resolves the MI_ key to a monster name", () => {
    assert.ok(rows.length > 100);
    const resolved = rows.filter((r) => r.moverName.length > 0).length;
    assert.ok(resolved > rows.length * 0.9, `only ${String(resolved)}/${String(rows.length)} names resolved`);
  });

  it("keeps the penya range numeric so the column sorts as a number", () => {
    for (const r of rows) {
      assert.equal(typeof r.goldMin, "number");
      assert.equal(typeof r.goldMax, "number");
      assert.ok(r.goldMax >= r.goldMin, `inverted penya range on ${r.key}`);
    }
  });
});

describe("setItemRows", () => {
  it("resolves every nameId through propItemEtc.txt.txt", () => {
    const rows = setItemRows();
    assert.ok(rows.length > 100);
    const unresolved = rows.filter((r) => !r.name);
    assert.deepEqual(
      unresolved.map((r) => r.nameId),
      [],
      "a set name must never surface as its IDS_ token",
    );
  });
});

describe("zoneRows", () => {
  it("resolves the world id to a display name and keeps the slug", () => {
    const rows = zoneRows();
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.ok(r.slug.length > 0, `zone ${String(r.id)} has no _id slug`);
      assert.doesNotMatch(r.world, /^WI_/, "world label must not be a raw symbol");
    }
  });
});

describe("dialogueRows", () => {
  it("skips index files and resolves NPC names for most dialogues", async () => {
    const rows = await dialogueRows();
    assert.ok(rows.length > 50);
    assert.ok(rows.every((r) => r.prefix.length > 0), "prefix-less index files must be skipped");
    assert.equal(new Set(rows.map((r) => r.ref)).size, rows.length, "row keys must be unique");
    assert.ok(rows.some((r) => r.npcName.length > 0), "expected some names to resolve");
    assert.ok(rows.every((r) => r.inert <= r.states), "inert count cannot exceed state count");
    // The shipped data has a large porting backlog; if this drops to zero the
    // inert detection has silently stopped matching the converter's output.
    assert.ok(
      rows.reduce((n, r) => n + r.inert, 0) > 100,
      "expected the known inert-state backlog to be detected",
    );
  });
});
