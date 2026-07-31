import type * as React from "react";
import { Dash } from "@/components/resource-cells";

/**
 * A drop chance as a percent, plus the odds a human actually reasons in.
 *
 * A drop table spans 0.0000140% to 100%, so a single format cannot serve it:
 * "0.0000140%" is unreadable and "0.00%" is a lie. This shows a precision-scaled
 * percent with the reciprocal ("1 in 7,158") underneath, because "one drop per
 * ~7,000 kills" is the sentence a GM is actually trying to write.
 *
 * @module components/chance-cell
 */

/** Percent with just enough decimals to stay meaningful at any magnitude. */
export function formatChancePct(pct: number): string {
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  // Below 0.01% a fixed format collapses to 0.000 — fall back to significant
  // figures so the low tail stays distinguishable.
  return `${Number(pct.toPrecision(3)).toString()}%`;
}

/** `1 in N` odds, or `""` when the chance is 100% (where "1 in 1" is noise). */
export function formatChanceOdds(pct: number): string {
  if (pct <= 0 || pct >= 100) return "";
  const n = 100 / pct;
  return `1 in ${n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1)}`;
}

export function ChanceCell({ pct }: { pct: number }): React.JSX.Element {
  if (!Number.isFinite(pct) || pct <= 0) return <Dash />;
  const odds = formatChanceOdds(pct);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono text-xs tabular-nums">{formatChancePct(pct)}</span>
      {odds && <span className="text-[11px] text-muted-foreground">{odds}</span>}
    </span>
  );
}
