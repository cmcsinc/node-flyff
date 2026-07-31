import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SortableHead } from "../components/ui/table";
import { parseSort } from "../lib/sort";

/**
 * Renders a header cell the way the pages do, to pin the accessibility
 * contract: `aria-sort` reflects state, the label says where the click leads,
 * and the direction is carried by an icon, not colour alone.
 */
function head(active: boolean, dir: "asc" | "desc"): string {
  const sort = active ? parseSort("level", dir, ["level"] as const) : parseSort(undefined, undefined, ["level"] as const);
  return renderToStaticMarkup(
    React.createElement(
      "table",
      null,
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement(SortableHead, {
            sortKey: "level",
            sort,
            params: { search: "abc", page: "3" },
            align: "right",
            children: "Level",
          }),
        ),
      ),
    ),
  );
}

describe("SortableHead", () => {
  it('announces aria-sort="none" and offers ascending when inactive', () => {
    const html = head(false, "asc");
    assert.match(html, /aria-sort="none"/);
    assert.match(html, /aria-label="Sort by Level, ascending"/);
  });

  it("announces ascending and offers descending when active asc", () => {
    const html = head(true, "asc");
    assert.match(html, /aria-sort="ascending"/);
    assert.match(html, /aria-label="Sort by Level, descending"/);
  });

  it("announces descending when active desc", () => {
    const html = head(true, "desc");
    assert.match(html, /aria-sort="descending"/);
  });

  it("links with sort/dir set, filters kept, and page dropped", () => {
    const html = head(true, "asc");
    const href = /href="([^"]+)"/.exec(html)?.[1];
    assert.ok(href, "header must render a link");
    const qs = new URLSearchParams(href.replace(/^\?/, "").replace(/&amp;/g, "&"));
    assert.equal(qs.get("sort"), "level");
    assert.equal(qs.get("dir"), "desc");
    assert.equal(qs.get("search"), "abc");
    assert.equal(qs.get("page"), null);
  });

  it("renders an svg direction indicator, so state is not colour-only", () => {
    assert.match(head(true, "asc"), /<svg/);
  });
});
