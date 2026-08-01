import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  LogHub,
  parseSpawnRequest,
  pushRing,
  tokensMatch,
  type LogLine,
} from "../lib/supervisor-shared";

describe("parseSpawnRequest", () => {
  it("accepts a well-formed request and normalises env", () => {
    const out = parseSpawnRequest({
      id: "world_1",
      type: "world",
      configFile: "/repo/config/instances/world_1.json",
      env: { EXP_RATE: "5" },
    });
    assert.ok(!("error" in out));
    assert.equal(out.req.id, "world_1");
    assert.deepEqual(out.req.env, { EXP_RATE: "5" });
  });

  it("rejects traversal ids, unknown types, and non-string env values", () => {
    for (const bad of [
      null,
      { id: "../etc", type: "world", configFile: "x" },
      { id: "world_1", type: "gateway", configFile: "x" },
      { id: "world_1", type: "world", configFile: "" },
      { id: "world_1", type: "world", configFile: "x", env: { lower: "1" } },
      { id: "world_1", type: "world", configFile: "x", env: { OK: 5 } },
    ]) {
      assert.ok("error" in parseSpawnRequest(bad), `should reject: ${JSON.stringify(bad)}`);
    }
  });
});

describe("pushRing", () => {
  it("keeps only the newest `max` entries", () => {
    const ring: LogLine[] = [];
    for (let i = 1; i <= 5; i++) pushRing(ring, { seq: i, ts: 0, line: `l${i}` }, 3);
    assert.deepEqual(
      ring.map((l) => l.seq),
      [3, 4, 5],
    );
  });
});

describe("tokensMatch", () => {
  it("matches an identical token and rejects mismatches without throwing", () => {
    const token = randomBytes(32).toString("hex");
    assert.equal(tokensMatch(token, token), true);
    assert.equal(tokensMatch(`${token}x`, token), false);
    assert.equal(tokensMatch("short", token), false);
    assert.equal(tokensMatch(undefined, token), false);
    assert.equal(tokensMatch(["a"], token), false);
    assert.equal(tokensMatch("", ""), false);
  });
});

describe("LogHub", () => {
  it("serves lines after a cursor and splits multi-line chunks", () => {
    const hub = new LogHub();
    hub.push("world_1", "a\nb\n");
    const all = hub.since("world_1", 0);
    assert.deepEqual(
      all.map((l) => l.line),
      ["a", "b"],
    );
    assert.deepEqual(
      hub.since("world_1", all[0]!.seq).map((l) => l.line),
      ["b"],
    );
    assert.deepEqual(hub.since("other", 0), []);
  });

  it("clear() empties the buffer so a fresh reader sees nothing", () => {
    // The reported bug: clearing only browser state came back on reload,
    // because the next read started from seq 0 against a still-full ring.
    const hub = new LogHub();
    hub.push("world_1", "old line");
    hub.clear("world_1");
    assert.deepEqual(hub.since("world_1", 0), []);
    hub.push("world_1", "new line");
    assert.deepEqual(
      hub.since("world_1", 0).map((l) => l.line),
      ["new line"],
    );
  });

  it("wait() resolves on the next push, not on a timer", async () => {
    const hub = new LogHub();
    let resolved = false;
    const waited = hub.wait("world_1", 60_000).then(() => {
      resolved = true;
    });
    assert.equal(resolved, false);
    hub.push("world_1", "live");
    await waited;
    assert.deepEqual(
      hub.since("world_1", 0).map((l) => l.line),
      ["live"],
    );
  });

  it("wait() resolves on clear and on abort, and each waiter fires once", async () => {
    const hub = new LogHub();
    let cancel = (): void => {};
    const aborted = hub.wait("a", 60_000, (fn) => {
      cancel = fn;
    });
    cancel();
    await aborted;

    const cleared = hub.wait("b", 60_000);
    hub.clear("b");
    await cleared;

    // A woken waiter must not be woken again by the next push.
    let count = 0;
    const once = hub.wait("c", 60_000).then(() => {
      count++;
    });
    hub.push("c", "1");
    await once;
    hub.push("c", "2");
    assert.equal(count, 1);
  });

  it("wait() resolves after its timeout when nothing arrives", async () => {
    const hub = new LogHub();
    await hub.wait("idle", 10);
    assert.deepEqual(hub.since("idle", 0), []);
  });

  it("bounds each instance's ring independently", () => {
    const hub = new LogHub(2);
    hub.push("world_1", "1\n2\n3");
    hub.push("world_2", "x");
    assert.deepEqual(
      hub.since("world_1", 0).map((l) => l.line),
      ["2", "3"],
    );
    assert.deepEqual(
      hub.since("world_2", 0).map((l) => l.line),
      ["x"],
    );
  });

  it("drops blank lines and mirrors each kept line to onLine", () => {
    const hub = new LogHub();
    const seen: string[] = [];
    const added = hub.push("world_1", "head\n\n\ntail", (l) => seen.push(l));
    assert.deepEqual(seen, ["head", "tail"]);
    assert.deepEqual(
      added.map((l) => l.line),
      ["head", "tail"],
    );
  });
});
