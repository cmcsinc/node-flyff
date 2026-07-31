/**
 * Zone spawn + zone-metadata write paths.
 *
 * Both share one property worth testing directly: the zone files carry
 * hand-written header and region comments (including the note recording why the
 * bogus "Flaris Safe Zone" was removed), and a `stringify(parse(file))` write
 * silently deletes them. Each case runs against a temp copy of a minimal zone.
 *
 * The metadata write has a second property to pin: it must leave the placement
 * collections byte-identical. A zone save that rewrote 948 spawns would make
 * every diff unreviewable even when it happened to be semantically correct.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  writeSpawnToFile,
  deleteSpawnFromFile,
  nextSpawnId,
  blankSpawn,
} from "../lib/spawns";
import { writeZoneMetaToFile, zoneMeta, ZONE_META_KEYS } from "../lib/zones";
import { parseZoneRef } from "../lib/zone-seq";

const ZONE_YAML = `# worlds/zones/test.yml
# Hand-written header that must survive edits.
_version: "1.0"
_id: test
_id_numeric: 1
name: Test
name_id: ZONE_TEST
world_id: madrigal
bounds:
  min:
    x: -100
    y: -50
    z: -100
  max:
    x: 100
    y: 50
    z: 100
revival:
  position:
    x: 10
    y: 0
    z: 10
  radius: 5
spawns:
  # a leading comment inside the sequence
  - id: 1
    mover_id: 528
    position:
      x: 1
      y: 2
      z: 3
    radius: 49.5
    count: 10
    delay: 55000
  - id: 3
    mover_id: 529
    position:
      x: 4
      y: 5
      z: 6
    radius: 0
    count: 1
    delay: 30000
npcs:
  - id: 1
    mover_id: 220
    character_key: MaFl_DrEstern
    position:
      x: 7
      y: 8
      z: 9
    angle: 0
    functions: []
regions:
  # NOTE: this comment records why a region was removed. It must survive.
  - id: 2
    name: Test Arena
    type: pvp
    bounds:
      min:
        x: 0
        y: 0
        z: 0
      max:
        x: 10
        y: 10
        z: 10
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zone-test-"));
  file = join(dir, "test.yml");
  writeFileSync(file, ZONE_YAML, "utf-8");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function doc(): Record<string, any> {
  return parseYaml(readFileSync(file, "utf-8"));
}

function text(): string {
  return readFileSync(file, "utf-8");
}

describe("parseZoneRef", () => {
  it("splits zone and entry id", () => {
    assert.deepEqual(parseZoneRef("flaris:12"), { zoneId: "flaris", entryId: 12 });
  });

  it("maps :new to a null id", () => {
    assert.deepEqual(parseZoneRef("flaris:new"), { zoneId: "flaris", entryId: null });
  });

  it("rejects malformed refs", () => {
    for (const bad of ["", "flaris", ":12", "flaris:", "flaris:0", "flaris:-1", "flaris:x"]) {
      assert.equal(parseZoneRef(bad), null, bad);
    }
  });
});

describe("writeSpawnToFile", () => {
  it("preserves file comments", () => {
    writeSpawnToFile(file, 1, { ...blankSpawn(), mover_id: 999, count: 3, delay: 1000 });
    assert.match(text(), /Hand-written header that must survive edits/);
    assert.match(text(), /a leading comment inside the sequence/);
    assert.match(text(), /records why a region was removed/);
  });

  it("replaces in place without touching siblings", () => {
    writeSpawnToFile(file, 1, { ...blankSpawn(), mover_id: 999, count: 3, delay: 1000 });
    const spawns = doc().spawns;
    assert.equal(spawns.length, 2);
    assert.equal(spawns[0].mover_id, 999);
    assert.equal(spawns[0].count, 3);
    assert.equal(spawns[1].mover_id, 529);
  });

  it("appends with the lowest free id", () => {
    const id = writeSpawnToFile(file, null, blankSpawn());
    assert.equal(id, 2);
    assert.equal(doc().spawns.length, 3);
    assert.equal(doc().spawns.at(-1).id, 2);
  });

  it("keeps float precision on radius", () => {
    writeSpawnToFile(file, 1, { ...blankSpawn(), radius: 49.5 });
    assert.equal(doc().spawns[0].radius, 49.5);
  });

  it("rejects a spawn the client would choke on", () => {
    // mover_id 0 has no propMover row -> OnAddObj null-derefs on materialize.
    assert.throws(() => writeSpawnToFile(file, 1, { ...blankSpawn(), mover_id: 0 }));
    assert.throws(() => writeSpawnToFile(file, 1, { ...blankSpawn(), count: 0 }));
    assert.throws(() => writeSpawnToFile(file, 1, { ...blankSpawn(), delay: 0 }));
    assert.throws(() => writeSpawnToFile(file, 1, { ...blankSpawn(), radius: -1 }));
  });

  it("leaves the file untouched when validation fails", () => {
    const before = text();
    assert.throws(() => writeSpawnToFile(file, 1, { ...blankSpawn(), mover_id: 0 }));
    assert.equal(text(), before);
  });
});

describe("deleteSpawnFromFile", () => {
  it("removes only the named entry", () => {
    assert.equal(deleteSpawnFromFile(file, 1), true);
    const spawns = doc().spawns;
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].id, 3);
    assert.match(text(), /Hand-written header that must survive edits/);
  });

  it("reports a miss rather than throwing", () => {
    assert.equal(deleteSpawnFromFile(file, 77), false);
  });
});

describe("nextSpawnId", () => {
  it("fills the lowest gap", () => {
    assert.equal(nextSpawnId([1, 3]), 2);
    assert.equal(nextSpawnId([]), 1);
  });
});

describe("zoneMeta", () => {
  it("strips the placement collections", () => {
    const meta = zoneMeta(doc());
    assert.equal("spawns" in meta, false);
    assert.equal("npcs" in meta, false);
    assert.equal(meta.name, "Test");
    assert.deepEqual(Object.keys(meta), ZONE_META_KEYS.filter((k) => k !== "portals" && k !== "weather"));
  });
});

describe("writeZoneMetaToFile", () => {
  it("preserves comments and the placement collections", () => {
    writeZoneMetaToFile(file, { name: "Renamed" });
    assert.match(text(), /Hand-written header that must survive edits/);
    assert.match(text(), /a leading comment inside the sequence/);
    assert.match(text(), /records why a region was removed/);
    // The whole point: an 11k-line placement list must not be rewritten.
    assert.deepEqual(doc().spawns, parseYaml(ZONE_YAML).spawns);
    assert.deepEqual(doc().npcs, parseYaml(ZONE_YAML).npcs);
  });

  it("writes only the submitted keys", () => {
    writeZoneMetaToFile(file, { name: "Renamed" });
    assert.equal(doc().name, "Renamed");
    // Untouched keys keep their on-disk value rather than a schema default.
    assert.equal(doc().name_id, "ZONE_TEST");
    assert.equal(doc().revival.radius, 5);
  });

  it("does not invent the keys it was not given", () => {
    writeZoneMetaToFile(file, { name: "Renamed" });
    // `portals` has a `.default([])` in the schema; an unsubmitted key must not
    // materialize from it.
    assert.equal("portals" in doc(), false);
  });

  it("round-trips nested objects and float precision", () => {
    writeZoneMetaToFile(file, { revival: { position: { x: 1.25, y: 0, z: -2.5 }, radius: 7 } });
    assert.deepEqual(doc().revival, { position: { x: 1.25, y: 0, z: -2.5 }, radius: 7 });
  });

  it("rejects metadata the loader would refuse", () => {
    assert.throws(() => writeZoneMetaToFile(file, { name_id: "FLARIS" }), /ZONE_/);
    assert.throws(() => writeZoneMetaToFile(file, { _id_numeric: 0 }));
    assert.throws(() =>
      writeZoneMetaToFile(file, { revival: { position: { x: 0, y: 0, z: 0 }, radius: 0 } }),
    );
  });

  it("leaves the file untouched when validation fails", () => {
    const before = text();
    assert.throws(() => writeZoneMetaToFile(file, { name_id: "FLARIS" }));
    assert.equal(text(), before);
  });
});
