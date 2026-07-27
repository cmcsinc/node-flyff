"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Stats {
  level: number;
  strength: number;
  stamina: number;
  dexterity: number;
  intelligence: number;
  remainGp: number;
  skillPoint: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
}

export function EditStatsForm({ characterId, stats }: { characterId: number; stats: Stats }) {
  const [form, setForm] = useState({
    level: stats.level,
    strength: stats.strength,
    stamina: stats.stamina,
    dexterity: stats.dexterity,
    intelligence: stats.intelligence,
    remainGp: stats.remainGp,
    skillPoint: stats.skillPoint,
    hp: stats.hp,
    mp: stats.mp,
    maxHp: stats.maxHp,
    maxMp: stats.maxMp,
  });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  async function save() {
    setSaving(true);
    const res = await fetch("/api/characters", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: characterId, ...form }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Stats updated");
      setEditing(false);
      router.refresh();
    } else {
      toast.error("Failed to update stats");
    }
  }

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        Edit Stats
      </Button>
    );
  }

  const fields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "level", label: "Level" },
    { key: "hp", label: "HP" },
    { key: "maxHp", label: "Max HP" },
    { key: "mp", label: "MP" },
    { key: "maxMp", label: "Max MP" },
    { key: "strength", label: "STR" },
    { key: "stamina", label: "STA" },
    { key: "dexterity", label: "DEX" },
    { key: "intelligence", label: "INT" },
    { key: "remainGp", label: "Unspent GP" },
    { key: "skillPoint", label: "Skill Points" },
  ];

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={f.key} className="text-xs">{f.label}</Label>
            <Input
              id={f.key}
              type="number"
              value={form[f.key]}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
              min={0}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}
