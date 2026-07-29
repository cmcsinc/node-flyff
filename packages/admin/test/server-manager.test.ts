import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildInstanceConfig,
  deepMerge,
  isValidInstanceId,
  stripAnsi,
} from "../lib/server-manager";

describe("deepMerge", () => {
  it("merges nested objects last-wins and replaces arrays", () => {
    const out = deepMerge(
      { log: { level: "info", pretty: false }, list: [1, 2] },
      { log: { level: "debug" }, list: [3] },
    );
    assert.deepEqual(out, { log: { level: "debug", pretty: false }, list: [3] });
  });
});

describe("isValidInstanceId", () => {
  it("accepts safe slugs and rejects traversal / junk", () => {
    assert.equal(isValidInstanceId("world_2"), true);
    assert.equal(isValidInstanceId("cluster-1"), true);
    assert.equal(isValidInstanceId("../etc/passwd"), false);
    assert.equal(isValidInstanceId("w"), false);
    assert.equal(isValidInstanceId(""), false);
    assert.equal(isValidInstanceId(7), false);
  });
});

describe("stripAnsi", () => {
  it("removes colour escapes", () => {
    assert.equal(stripAnsi("\x1b[36m[login]\x1b[0m up"), "[login] up");
  });
});

describe("buildInstanceConfig", () => {
  const defaults = { log: { level: "info" }, cache: { adapter: "memory" } };
  const base = { server: { id: "world_1", host: "0.0.0.0", port: 5400 }, world: { expRate: 1 } };

  it("overrides server id/port and gives each world its own WAL journal", () => {
    const cfg = buildInstanceConfig(
      { id: "world_2", type: "world", label: "W2", port: 5401 },
      defaults,
      base,
    );
    assert.deepEqual(cfg.server, { id: "world_2", host: "0.0.0.0", port: 5401 });
    assert.deepEqual(cfg.wal, { journalPath: "./data/world_2_journal.sqlite3" });
    assert.deepEqual(cfg.log, { level: "info" });
  });

  it("applies user overrides last", () => {
    const cfg = buildInstanceConfig(
      {
        id: "world_3",
        type: "world",
        label: "W3",
        port: 5402,
        overrides: { world: { expRate: 5 }, registration: { channelId: 3 } },
      },
      defaults,
      base,
    );
    assert.deepEqual(cfg.world, { expRate: 5 });
    assert.deepEqual(cfg.registration, { channelId: 3 });
  });

  it("does not add a WAL journal for non-world types", () => {
    const cfg = buildInstanceConfig(
      { id: "cluster_2", type: "cluster", label: "C2", port: 28001 },
      defaults,
      { server: { id: "cluster_1", port: 28000 } },
    );
    assert.equal(cfg.wal, undefined);
  });
});
