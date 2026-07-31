import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Dash } from "@/components/resource-cells";

/**
 * A list of items rendered as name chips.
 *
 * Rows used to carry only ids, and the pages filtered on a numeric "contains
 * item ID" box — a GM cross-referencing a set or a drop table had to already know
 * that 4587 is "Leaf Hat". Each entry is a chip showing the resolved name with
 * the raw id in the tooltip (rule 12: name plus raw value).
 *
 * `max` truncates with a "+N more" chip: a drop table can hold 20+ slots, and an
 * unbounded chip list makes one row taller than the rest of the table.
 *
 * @module components/item-chip-list
 */
export function ItemChipList({
  names,
  ids,
  max,
}: {
  names: readonly string[];
  ids: readonly number[];
  /** Show at most this many chips, then a count of the rest. */
  max?: number;
}): React.JSX.Element {
  if (ids.length === 0) return <Dash />;
  const limit = max ?? ids.length;
  const shown = ids.slice(0, limit);
  const rest = ids.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-1">
      {shown.map((id, i) => (
        <li key={`${String(id)}-${String(i)}`}>
          <Badge variant="secondary" title={`Item #${String(id)}`} className="font-normal">
            {names[i] || `#${String(id)}`}
          </Badge>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <Badge
            variant="outline"
            title={ids.slice(limit).map((id, i) => names[limit + i] || `#${String(id)}`).join(", ")}
            className="font-normal text-muted-foreground"
          >
            +{rest} more
          </Badge>
        </li>
      )}
    </ul>
  );
}
