import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  parsePage, parsePerPage, paginate, DEFAULT_PER_PAGE,
} from "../lib/paginate";

describe("parsePage", () => {
  it("defaults to 1 on junk or out-of-range input", () => {
    assert.equal(parsePage(undefined), 1);
    assert.equal(parsePage(""), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-3"), 1);
  });

  it("floors fractional pages", () => {
    assert.equal(parsePage("3"), 3);
    assert.equal(parsePage("3.7"), 3);
  });
});

describe("parsePerPage", () => {
  it("accepts only whitelisted sizes", () => {
    assert.equal(parsePerPage("100"), 100);
    assert.equal(parsePerPage("37"), DEFAULT_PER_PAGE);
    assert.equal(parsePerPage(undefined), DEFAULT_PER_PAGE);
    assert.equal(parsePerPage("99999"), DEFAULT_PER_PAGE);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);

  it("slices the requested page", () => {
    const p = paginate(rows, 2, 10);
    assert.deepEqual(p.rows, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    assert.equal(p.page, 2);
    assert.equal(p.totalPages, 3);
    assert.equal(p.total, 25);
  });

  it("clamps a page past the end to the last page", () => {
    const p = paginate(rows, 99, 10);
    assert.equal(p.page, 3);
    assert.deepEqual(p.rows, [20, 21, 22, 23, 24]);
  });

  it("reports one empty page for an empty list", () => {
    const p = paginate([], 1, 50);
    assert.deepEqual(p.rows, []);
    assert.equal(p.totalPages, 1);
    assert.equal(p.total, 0);
  });
});
