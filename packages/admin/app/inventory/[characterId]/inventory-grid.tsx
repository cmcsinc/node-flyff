"use client";

import { ItemTile } from "./item-tile";
import { BAG_SLOTS } from "./constants";
import type { SlotItem } from "./types";

interface InventoryGridProps {
  items: SlotItem[];
  onHover?: (item: SlotItem, rect: DOMRect) => void;
  onLeave?: () => void;
  onRemove?: (slot: number, item: SlotItem) => void;
  interactive?: boolean;
}

/**
 * The main bag — a Flyff-style grid of recessed slots sitting on the inventory
 * panel. 42 slots arranged in the classic wide grid. Each cell shows the item
 * at that slot index or an empty recessed well.
 */
export function InventoryGrid({
  items,
  onHover,
  onLeave,
  onRemove,
  interactive = true,
}: InventoryGridProps) {
  const bySlot = new Map<number, SlotItem>();
  for (const it of items) bySlot.set(it.slot, it);

  return (
    <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
      {Array.from({ length: BAG_SLOTS }, (_, slot) => {
        const item = bySlot.get(slot);
        return (
          <div key={slot} className="group relative">
            <ItemTile item={item} slot={slot} size={42} onHover={onHover} onLeave={onLeave} />
            {interactive && item && onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.slot, item);
                }}
                aria-label={`Remove ${item.name}`}
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white shadow group-hover:flex hover:bg-destructive/80"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
