"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { EquipmentPaperDoll } from "./equipment-paperdoll";
import { InventoryGrid } from "./inventory-grid";
import { ItemTooltip } from "./item-tooltip";
import { AddItem } from "./add-item";
import type { PickerItem, SlotItem } from "./types";

interface InventoryExplorerProps {
  characterId: number;
  bagItems: SlotItem[];
  equipItems: SlotItem[];
  pickerItems: PickerItem[];
  /** Hide add/remove — read-only compact mode (character-detail tab). */
  readOnly?: boolean;
}

/** Hovered tile + its viewport rect, or null when the tooltip is closed. */
interface ActiveTooltip {
  item: SlotItem;
  rect: DOMRect;
}

/**
 * Client orchestrator for the interactive inventory. Owns the single shared
 * hover/focus tooltip, the remove-confirmation flow, and (when editable) the
 * add-item control. Renders the equipment paper-doll and bag grid.
 */
export function InventoryExplorer({
  characterId,
  bagItems,
  equipItems,
  pickerItems,
  readOnly = false,
}: InventoryExplorerProps) {
  const router = useRouter();
  const [active, setActive] = React.useState<ActiveTooltip | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<SlotItem | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleOpen = React.useCallback((item: SlotItem, rect: DOMRect) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setActive({ item, rect }), 90);
  }, []);

  const close = React.useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setActive(null);
  }, []);

  React.useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  async function confirmRemove() {
    if (!removeTarget) return;
    try {
      const res = await fetch(`/api/inventory/${characterId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: removeTarget.slot }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Removed ${removeTarget.name}`);
      router.refresh();
    } catch (err) {
      toast.error("Failed to remove item", { description: (err as Error).message });
    }
  }

  function handleRemove(_slot: number, item: SlotItem) {
    close();
    setRemoveTarget(item);
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex justify-end">
          <AddItem characterId={characterId} items={pickerItems} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        {/* Equipment window (paper doll) */}
        <div className="flyff-panel overflow-hidden">
          <div className="flyff-window-header px-4 py-2 text-sm font-semibold tracking-wide text-foreground">
            Equipment
          </div>
          <EquipmentPaperDoll
            items={equipItems}
            onHover={scheduleOpen}
            onLeave={close}
            onRemove={readOnly ? undefined : handleRemove}
            interactive={!readOnly}
          />
        </div>

        {/* Inventory window (bag) */}
        <div className="flyff-panel overflow-hidden">
          <div className="flyff-window-header flex items-center justify-between px-4 py-2 text-sm font-semibold tracking-wide text-foreground">
            <span>Inventory</span>
            <span className="text-xs font-normal text-muted-foreground">
              {bagItems.length}/{42} slots
            </span>
          </div>
          <div className="p-4">
            <InventoryGrid
              items={bagItems}
              onHover={scheduleOpen}
              onLeave={close}
              onRemove={readOnly ? undefined : handleRemove}
              interactive={!readOnly}
            />
          </div>
        </div>
      </div>

      {active && <ItemTooltip item={active.item} rect={active.rect} />}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title="Remove this item?"
        description={
          removeTarget
            ? `${removeTarget.name} (slot ${removeTarget.slot}) will be deleted from the inventory. This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={confirmRemove}
      />
    </div>
  );
}
