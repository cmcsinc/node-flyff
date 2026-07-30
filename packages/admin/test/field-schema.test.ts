/**
 * Field schema: type preservation and enum resolution.
 *
 * These guard the two ways a resource editor can corrupt game data: widening a
 * type (float angle round-tripping to an int, empty input becoming 0) and
 * silently mislabelling an enum.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  coerce,
  getMeta,
  getOptions,
  optionLabel,
  resolveKind,
  stepFor,
  GROUP_ORDER,
} from "../lib/field-schema";

describe("resolveKind", () => {
  it("honours the declared kind over the value shape", () => {
    // `angle: 0` is an integer at rest but must still edit as a float.
    assert.equal(resolveKind("angle", 0), "float");
    // `equip_slot: 5` is a number but must render as a slot picker.
    assert.equal(resolveKind("equip_slot", 5), "enum");
    assert.equal(resolveKind("source", "Speak();"), "readonly");
  });

  it("infers int vs float for unknown keys", () => {
    assert.equal(resolveKind("zzz", 3), "int");
    assert.equal(resolveKind("zzz", 3.5), "float");
  });

  it("infers vector3 and range from object keys", () => {
    assert.equal(resolveKind("zzz", { x: 1, y: 2, z: 3 }), "vector3");
    assert.equal(resolveKind("zzz", { min: 1, max: 2 }), "range");
    assert.equal(resolveKind("zzz", { a: 1 }), "object");
  });

  it("splits scalar lists from object tables", () => {
    assert.equal(resolveKind("zzz", [1, 2]), "list");
    assert.equal(resolveKind("zzz", [{ a: 1 }]), "table");
  });

  it("never resolves to a JSON escape hatch", () => {
    const kinds = new Set(
      [0, 1.5, true, "s", [], [1], [{ a: 1 }], { x: 1, y: 2, z: 3 }, { a: 1 }, null].map((v) =>
        resolveKind("zzz", v),
      ),
    );
    for (const k of kinds) {
      assert.ok(
        ["int", "float", "bool", "text", "list", "table", "object", "vector3", "range"].includes(k),
        `unexpected kind ${k}`,
      );
    }
  });
});

describe("coerce", () => {
  it("truncates to an integer for int fields", () => {
    assert.equal(coerce("int", "5"), 5);
    assert.equal(coerce("int", "5.9"), 5);
    assert.equal(coerce("int", "-3"), -3);
  });

  it("keeps float precision", () => {
    assert.equal(coerce("float", "0.48"), 0.48);
    assert.equal(coerce("float", "1e-3"), 0.001);
  });

  it("returns null for an empty numeric input rather than 0", () => {
    assert.equal(coerce("int", ""), null);
    assert.equal(coerce("float", "   "), null);
  });

  it("returns null for unparseable numbers", () => {
    assert.equal(coerce("int", "abc"), null);
    assert.equal(coerce("float", "--"), null);
  });

  it("passes text through untouched", () => {
    assert.equal(coerce("text", " MaFl_Helper "), " MaFl_Helper ");
  });
});

describe("stepFor", () => {
  it("snaps ints to 1 and leaves floats free", () => {
    assert.equal(stepFor("int"), "1");
    assert.equal(stepFor("float"), "any");
  });
});

describe("enum registries", () => {
  it("resolves DST ids to names with the raw value visible", () => {
    assert.equal(optionLabel("dst", 35), "HP Max (35)");
    assert.equal(optionLabel("dst", 1), "STR (1)");
  });

  it("resolves equip slots", () => {
    assert.equal(optionLabel("parts", 11), "Shield (11)");
  });

  it("falls back to the raw value for an unmapped id", () => {
    assert.equal(optionLabel("dst", 9999), "9999");
  });

  it("returns null for an unknown registry", () => {
    assert.equal(getOptions("nope"), null);
    assert.equal(getOptions(undefined), null);
  });

  it("caches the built option list", () => {
    assert.equal(getOptions("dst"), getOptions("dst"));
  });

  it("orders numeric registries by value", () => {
    const opts = getOptions("dst")!;
    const values = opts.map((o) => Number(o.value));
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
  });
});

describe("getMeta", () => {
  it("humanises unknown keys into the Other section", () => {
    assert.deepEqual(getMeta("some_new_field"), { label: "Some New Field", group: "Other" });
  });

  it("assigns every declared field to a known section", () => {
    for (const key of ["id", "position", "angle", "effects", "gold", "job_req"]) {
      assert.ok(GROUP_ORDER.includes(getMeta(key).group), `${key} → ${getMeta(key).group}`);
    }
  });
});
