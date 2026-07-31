/**
 * Drop-chance display helpers.
 *
 * A drop table spans 0.0000140% to 100%, so the formatter has to stay meaningful
 * at both ends: a fixed-decimal format collapses the low tail to "0.000%" and a
 * significant-figures format gives 100% eight pointless digits. The odds line is
 * the number a GM actually reasons in ("one drop per ~7,000 kills").
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatChancePct, formatChanceOdds } from "../components/chance-cell";
import { roundPercentValue } from "../lib/field-schema";

describe("formatChancePct", () => {
  it("scales precision to the magnitude", () => {
    assert.equal(formatChancePct(100), "100.0%");
    assert.equal(formatChancePct(13.9698), "14.0%");
    assert.equal(formatChancePct(1.397), "1.40%");
    assert.equal(formatChancePct(0.139698), "0.140%");
  });

  it("keeps the low tail distinguishable instead of showing 0", () => {
    // The shipped floor. A toFixed(3) would render both of these as "0.000%".
    assert.equal(formatChancePct(0.0000139698), "0.000014%");
    assert.notEqual(formatChancePct(0.0000139698), formatChancePct(0.000139698));
  });

  it("never renders a nonzero chance as zero", () => {
    for (const pct of [0.0000139698, 0.0001, 0.001, 0.009]) {
      assert.notEqual(Number(formatChancePct(pct).replace("%", "")), 0, `${String(pct)} must not read as 0`);
    }
  });
});

describe("formatChanceOdds", () => {
  it("renders 1 in N, rounded once N is large", () => {
    // Below 10 a decimal is kept: "1 in 7" and "1 in 7.2" are meaningfully
    // different rates when you are tuning a common drop.
    assert.equal(formatChanceOdds(13.9698), "1 in 7.2");
    assert.equal(formatChanceOdds(50), "1 in 2.0");
    assert.equal(formatChanceOdds(0.0000139698), "1 in 7,158,299");
  });

  it("is empty at 100% and at 0, where odds are noise", () => {
    assert.equal(formatChanceOdds(100), "");
    assert.equal(formatChanceOdds(0), "");
    assert.equal(formatChanceOdds(-1), "");
  });
});

describe("roundPercentValue", () => {
  it("keeps 6 significant figures across the whole range", () => {
    assert.equal(roundPercentValue(13.96983145), 13.9698);
    assert.equal(roundPercentValue(0.00001396983), 0.0000139698);
    assert.equal(roundPercentValue(100), 100);
  });

  it("clamps to 0-100 rather than writing an out-of-range percent", () => {
    assert.equal(roundPercentValue(150), 100);
    assert.equal(roundPercentValue(-5), 0);
  });

  it("returns 0 for NaN and clamps Infinity", () => {
    // NaN would serialize into the YAML and fail the server-side schema.
    assert.equal(roundPercentValue(Number.NaN), 0);
    assert.equal(roundPercentValue(Number.POSITIVE_INFINITY), 100);
    assert.equal(roundPercentValue(Number.NEGATIVE_INFINITY), 0);
  });
});
