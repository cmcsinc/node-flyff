"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function BankGoldEditor({ accountId, tab, currentGold }: { accountId: number; tab: number; currentGold: number }) {
  const [gold, setGold] = useState(currentGold);
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  async function save() {
    const res = await fetch("/api/bank/" + accountId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab, gold }),
    });
    if (res.ok) {
      toast.success(`Tab ${tab} gold updated`);
      setEditing(false);
      router.refresh();
    } else {
      toast.error("Failed to update gold");
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">Tab {tab}</p>
      {!editing ? (
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{currentGold.toLocaleString()}</span>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input type="number" value={gold} onChange={(e) => setGold(Number(e.target.value))} className="w-32" min={0} />
          <Button size="sm" onClick={save}>Save</Button>
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setGold(currentGold); }}>X</Button>
        </div>
      )}
    </div>
  );
}
