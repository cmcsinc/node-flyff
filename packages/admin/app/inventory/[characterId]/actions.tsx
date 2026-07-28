"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function GoldEditor({ characterId, currentGold }: { characterId: number; currentGold: number }) {
  const [gold, setGold] = useState(currentGold);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    setSaving(true);
    const res = await fetch("/api/inventory/" + characterId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gold }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Gold updated");
      setEditing(false);
      router.refresh();
    } else {
      toast.error("Failed to update gold");
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold">{currentGold.toLocaleString()}</span>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={gold}
        onChange={(e) => setGold(Number(e.target.value))}
        className="w-40"
        min={0}
      />
      <Button size="sm" onClick={save} disabled={saving}>
        {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setGold(currentGold); }} disabled={saving}>
        Cancel
      </Button>
    </div>
  );
}

export function ItemActions({ characterId, slot }: { characterId: number; slot: number }) {
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setRemoving(true);
    const res = await fetch("/api/inventory/" + characterId, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    setRemoving(false);
    if (res.ok) {
      toast.success("Item removed");
      router.refresh();
    } else {
      toast.error("Failed to remove item");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
        disabled={removing}
      >
        {removing ? "Removing…" : "Remove"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove this item?"
        description="The item will be deleted from this inventory slot. This cannot be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}
