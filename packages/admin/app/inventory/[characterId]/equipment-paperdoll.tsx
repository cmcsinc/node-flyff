"use client";

import type { CSSProperties } from "react";
import { ItemTile } from "./item-tile";
import { MAX_INVENTORY } from "./constants";
import type { SlotItem } from "./types";

/**
 * Equipment paper-doll, laid out like the Flyff character window: a faint body
 * silhouette in the centre with equipment slots framing it anatomically (hat on
 * top, suit over the chest, weapons flanking, jewelry along the bottom). Each
 * cell holds the item occupying `slot = MAX_INVENTORY + part`.
 */

/** Minimal humanoid silhouette, rendered faintly behind the centre column. */
function BodySilhouette() {
  return (
    <svg
      viewBox="0 0 60 140"
      className="pointer-events-none absolute left-1/2 top-1/2 h-[280px] -translate-x-1/2 -translate-y-1/2 opacity-[0.12]"
      fill="none"
      stroke="#7e93b8"
      strokeWidth="3"
      aria-hidden
    >
      <circle cx="30" cy="14" r="9" />
      <path d="M30 23 L30 30 M16 34 Q30 28 44 34 L40 78 Q30 82 20 78 Z" />
      <path d="M16 34 L8 64 M44 34 L52 64" />
      <path d="M24 78 L22 130 M36 78 L38 130" />
    </svg>
  );
}

interface SlotDef {
  part: number;
  label: string;
  col: number;
  row: number;
}

// Column 1 = left accessories, 2 = centre body, 3 = right accessories.
const LAYOUT: SlotDef[] = [
  { part: 6, label: "Helmet", col: 2, row: 1 },
  { part: 22, label: "Earring 1", col: 1, row: 2 },
  { part: 12, label: "Mask", col: 2, row: 2 },
  { part: 23, label: "Earring 2", col: 3, row: 2 },
  { part: 8, label: "Cloak", col: 1, row: 3 },
  { part: 2, label: "Suit", col: 2, row: 3 },
  { part: 9, label: "Left Weapon", col: 1, row: 4 },
  { part: 3, label: "Lower", col: 2, row: 4 },
  { part: 10, label: "Right Weapon", col: 3, row: 4 },
  { part: 4, label: "Gloves", col: 1, row: 5 },
  { part: 19, label: "Necklace", col: 2, row: 5 },
  { part: 11, label: "Shield", col: 3, row: 5 },
  { part: 20, label: "Ring 1", col: 1, row: 6 },
  { part: 5, label: "Boots", col: 2, row: 6 },
  { part: 21, label: "Ring 2", col: 3, row: 6 },
  // Fashion hat sits below the doll (col 2, row 7) so it doesn't collide.
  { part: 26, label: "Fashion Hat", col: 2, row: 7 },
];

interface EquipmentPaperDollProps {
  items: SlotItem[];
  onHover?: (item: SlotItem, rect: DOMRect) => void;
  onLeave?: () => void;
  onRemove?: (slot: number, item: SlotItem) => void;
  interactive?: boolean;
  /** Narrow-column mode: 36px tiles, tighter spacing. */
  compact?: boolean;
}

export function EquipmentPaperDoll({
  items,
  onHover,
  onLeave,
  onRemove,
  interactive = true,
  compact = false,
}: EquipmentPaperDollProps) {
  const byPart = new Map<number, SlotItem>();
  for (const it of items) byPart.set(it.slot - MAX_INVENTORY, it);

  const tileSize = compact ? 36 : 46;
  const labelMaxW = compact ? "max-w-[44px]" : "max-w-[56px]";

  const cell = (def: SlotDef) => {
    const item = byPart.get(def.part);
    return (
      <div
        key={def.part}
        className="flex flex-col items-center gap-0.5"
        style={{ gridColumn: def.col, gridRow: def.row }}
      >
        <div className="group relative">
          <ItemTile
            item={item}
            slot={MAX_INVENTORY + def.part}
            emptyLabel={def.label}
            size={tileSize}
            onHover={onHover}
            onLeave={onLeave}
          />
          {interactive && item && onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.slot, item);
              }}
              aria-label={`Remove ${item.name}`}
              className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground shadow-card group-hover:flex hover:bg-destructive/80"
            >
              ×
            </button>
          )}
        </div>
        <span className={`${labelMaxW} truncate text-[8px] text-muted-foreground/70`} title={def.label}>
          {def.label}
        </span>
      </div>
    );
  };

  const gridStyle: CSSProperties = {
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gridTemplateRows: "repeat(7, min-content)",
    placeItems: "center",
  };

  return (
    <div className={compact ? "relative p-3" : "relative p-6"}>
      {!compact && <BodySilhouette />}
      <div className="relative grid gap-y-1 gap-x-2" style={gridStyle}>
        {LAYOUT.map(cell)}
      </div>
    </div>
  );
}
