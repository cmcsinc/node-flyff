/**
 * The cell vocabulary shared by every `/resources/*` table.
 *
 * The nine browser pages were each styling their own cells inline, and the
 * classes had drifted: an id was `font-mono text-xs text-muted-foreground` on
 * one page and `font-mono text-xs` on another; a missing value was sometimes a
 * bare `—`, sometimes a muted one, sometimes an empty cell. Every distinction a
 * reader can see should mean something, so each kind of value gets exactly one
 * appearance, defined here once.
 *
 * @module components/resource-cells
 */

import * as React from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

/** An absent value. Muted so a populated column reads as the signal. */
export function Dash(): React.JSX.Element {
  return <span className="text-muted-foreground">—</span>;
}

/** Numeric resource id — monospaced so digits align down the column. */
export function IdCell({ value }: { value: number | string }): React.JSX.Element {
  return <span className="font-mono text-xs text-muted-foreground">{value}</span>;
}

/** A raw game symbol (`MI_AIBATT1`, `IK3_AXE`) or file name. */
export function SymbolCell({
  value,
  title,
}: {
  value: string;
  /** Full text when `value` is displayed abbreviated. */
  title?: string;
}): React.JSX.Element {
  if (!value) return <Dash />;
  return (
    <span title={title} className="font-mono text-xs text-muted-foreground">
      {value}
    </span>
  );
}

/** The row's primary label — the one thing a GM scans for. */
export function NameCell({ value }: { value: string }): React.JSX.Element {
  if (!value) return <Dash />;
  return <span className="font-medium">{value}</span>;
}

/**
 * Secondary resolved text — a label that is real prose, not a raw symbol, but
 * subordinate to the row's name. Distinct from {@link SymbolCell} (monospaced,
 * for game symbols) and from {@link TagCell} (a chip, for the primary
 * classification): two chips in adjacent columns compete for the same attention
 * and neither wins.
 */
export function MutedCell({
  value,
  title,
}: {
  value: string;
  /** The raw symbol behind the label, so hovering recovers it. */
  title?: string;
}): React.JSX.Element {
  if (!value) return <Dash />;
  return (
    <span title={title} className="text-xs text-muted-foreground">
      {value}
    </span>
  );
}

/**
 * A resolved display name paired with the raw symbol it came from.
 *
 * Both halves matter: the name is what a player sees, the symbol is what the
 * C++ source and the YAML use, and a GM cross-referencing needs both without
 * opening a second page. Rule `12-admin-form-ux.md` requires enum values to
 * show name *and* raw value; the same reasoning applies to a table cell.
 */
export function NameWithSymbol({
  name,
  symbol,
}: {
  name: string;
  symbol: string;
}): React.JSX.Element {
  if (!name && !symbol) return <Dash />;
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-medium">{name || symbol}</span>
      {name && symbol && (
        <span className="font-mono text-[0.6875rem] text-muted-foreground">{symbol}</span>
      )}
    </span>
  );
}

/**
 * A count or measure. Tabular figures keep digit columns aligned even in the
 * proportional UI font, so magnitudes are comparable at a glance; zero reads as
 * absent rather than as a value worth scanning.
 */
export function NumCell({
  value,
  zeroIsEmpty = true,
}: {
  value: number;
  /** Set false where 0 is a meaningful reading (a stock count, say). */
  zeroIsEmpty?: boolean;
}): React.JSX.Element {
  if (!Number.isFinite(value) || (zeroIsEmpty && value === 0)) return <Dash />;
  return <span className="font-mono text-xs tabular-nums">{value.toLocaleString()}</span>;
}

/**
 * A count rendered as a chip. Used where the number is a collection size the
 * reader compares across rows (states, pieces, drop entries) — the chip makes
 * "has some" scannable before the exact figure is read.
 */
export function CountCell({ value }: { value: number }): React.JSX.Element {
  if (!value) return <Dash />;
  return (
    <Badge variant="secondary" className="font-mono tabular-nums">
      {value.toLocaleString()}
    </Badge>
  );
}

/** A classification (item kind, mover type, world). */
export function TagCell({
  label,
  title,
}: {
  label: string;
  /** The raw symbol, so hovering recovers what the friendly label hides. */
  title?: string;
}): React.JSX.Element {
  if (!label) return <Dash />;
  return (
    <Badge variant="secondary" title={title}>
      {label}
    </Badge>
  );
}

/** A `{x,y,z}` world position. */
export function PosCell({
  x,
  y,
  z,
}: {
  x: number;
  y: number;
  z: number;
}): React.JSX.Element {
  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {x.toFixed(0)}, {y.toFixed(0)}, {z.toFixed(0)}
    </span>
  );
}

/**
 * The row's edit affordance.
 *
 * An anchor, not a button: it navigates, so middle-click, open-in-new-tab, and
 * keyboard activation must all work. `buttonVariants` supplies the appearance
 * without `Button`'s `<button>` element. The label is icon+text (never
 * icon-only) and carries a row-specific `aria-label`, so a screen reader
 * hearing forty "Edit" links can tell them apart.
 */
export function EditLink({
  href,
  label,
}: {
  href: string;
  /** What is being edited, e.g. `quest 1204`. */
  label: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      aria-label={`Edit ${label}`}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      Edit
    </Link>
  );
}
