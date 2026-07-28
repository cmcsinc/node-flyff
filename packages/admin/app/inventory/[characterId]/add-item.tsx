"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, Search, X } from "lucide-react";
import type { PickerItem } from "./types";

interface AddItemProps {
  characterId: number;
  /** Full item catalog for the picker (name + icon + id + stack size). */
  items: PickerItem[];
}

/**
 * "Add item" control: opens a modal with a searchable item picker, a quantity
 * input (clamped to the chosen item's stack size), and an optional slot.
 * Submits via the existing `action:"add"` PATCH on the inventory API.
 */
export function AddItem({ characterId, items }: AddItemProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" />
        Add Item
      </Button>
      {open && (
        <AddItemDialog characterId={characterId} items={items} onOpenChange={setOpen} />
      )}
    </>
  );
}

interface AddItemDialogProps {
  characterId: number;
  items: PickerItem[];
  onOpenChange: (open: boolean) => void;
}

function AddItemDialog({ characterId, items, onOpenChange }: AddItemDialogProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<PickerItem | null>(null);
  const [quantity, setQuantity] = React.useState(1);
  const [slot, setSlot] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onOpenChange]);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? items.filter(
          (it) => it.name.toLowerCase().includes(q) || String(it.id) === q,
        )
      : items;
    return base.slice(0, 60);
  }, [items, query]);

  // Clamp quantity to the selected item's stack size.
  const maxQty = selected?.stackSize ?? 9999;

  async function submit() {
    if (!selected) {
      toast.error("Pick an item first");
      return;
    }
    const qty = Math.max(1, Math.min(quantity, maxQty));
    const slotNum = slot.trim() === "" ? undefined : Number(slot);
    if (slotNum !== undefined && (!Number.isFinite(slotNum) || slotNum < 0 || slotNum > 72)) {
      toast.error("Slot must be 0–72 (or blank for auto)");
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/inventory/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", itemId: selected.id, quantity: qty, slot: slotNum }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Added ${qty} × ${selected.name}`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error("Failed to add item", { description: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-item-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !pending && onOpenChange(false)}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-popover shadow-2xl animate-[fade-in-up_0.2s_cubic-bezier(0.4,0,0.2,1)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 id="add-item-title" className="text-base font-semibold">
            Add Item
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or id…"
              className="pl-9"
            />
          </div>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No items match.</p>
          )}
          <ul className="space-y-0.5">
            {results.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(it);
                    setQuantity(1);
                  }}
                  className={[
                    "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    selected?.id === it.id
                      ? "bg-primary/20 ring-1 ring-primary"
                      : "hover:bg-secondary",
                  ].join(" ")}
                >
                  <Image
                    src={it.iconUrl}
                    alt=""
                    width={28}
                    height={28}
                    className="rounded border border-border bg-secondary/60"
                    unoptimized
                  />
                  <span className="flex-1 truncate">{it.name}</span>
                  <span className="text-xs text-muted-foreground">#{it.id}</span>
                  <span className="w-16 text-right text-xs text-muted-foreground">
                    {it.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer: qty + slot + add */}
        <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Quantity</label>
            <Input
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Slot (blank = auto)</label>
            <Input
              type="number"
              min={0}
              max={72}
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              placeholder="auto"
              className="w-24"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !selected}>
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
