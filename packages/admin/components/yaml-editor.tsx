"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "sonner";

interface YamlEditorProps {
  type: string;
  id: string;
  initialYaml: string;
}

export function YamlEditor({ type, id, initialYaml }: YamlEditorProps) {
  const [yaml, setYaml] = useState(initialYaml);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/resources/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, yaml }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Saved");
        router.push(`/resources/${type}`);
      } else {
        toast.error(data.error ?? "Save failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        className="w-full min-h-[500px] font-mono text-sm p-4 rounded-md border bg-muted/30 resize-y"
        spellCheck={false}
      />
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  );
}
