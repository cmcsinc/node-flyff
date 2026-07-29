import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
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
