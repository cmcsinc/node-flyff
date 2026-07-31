"use client";

import { ResourceFormEditor } from "@/components/resource-form-editor";

/**
 * Zone metadata form.
 *
 * Routes saves to `/api/zones`, which rewrites only the zone-level keys. The
 * 948 spawns and 347 NPC placements in the same file are not in this form and are
 * not touched by the write — they have their own pages, and per-entry editing is
 * what keeps a zone save reviewable.
 */
export function ZoneEditor({
  zoneId,
  meta,
}: {
  zoneId: string;
  meta: Record<string, unknown>;
}) {
  async function save(form: Record<string, unknown>): Promise<string | null> {
    const res = await fetch("/api/zones", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId, meta: form }),
    });
    const data = await res.json().catch(() => null);
    return res.ok ? null : (data?.error ?? "Save failed");
  }

  return (
    <ResourceFormEditor
      type="zones"
      id={zoneId}
      entry={meta}
      save={save}
      backHref="/resources/zones"
    />
  );
}
