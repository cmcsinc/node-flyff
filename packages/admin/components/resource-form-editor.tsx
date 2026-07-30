"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { stringify as stringifyYaml } from "yaml";
import { Save, ArrowLeft, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TypedField, isWideField } from "@/components/form/typed-field";
import { GROUP_ORDER, SKIP_KEYS, getMeta, type EnumOption } from "@/lib/field-schema";
import { FieldOptionsProvider } from "@/components/form/field-options";
import { cn } from "@/lib/utils";

/**
 * Resource entry editor.
 *
 * Renders one typed control per YAML key — no JSON textareas, no raw
 * serialization surfaced to the user. Sections come from the field schema in a
 * fixed order (Identity → Classification → … ), leaf fields sit in a 2-column
 * grid, and collections/nested objects span the full width.
 *
 * See `.claude/rules/12-admin-form-ux.md`.
 *
 * @module components/resource-form-editor
 */

/** One collapsible titled section of fields. */
function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="py-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="-mx-2 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <CardTitle className="text-sm">{title}</CardTitle>
          <Badge variant="secondary" className="ml-auto">{count}</Badge>
        </button>
      </CardHeader>
      {open && <CardContent className="pt-0 pb-5">{children}</CardContent>}
    </Card>
  );
}

export function ResourceFormEditor({
  type,
  id,
  entry,
  save,
  backHref,
  saveClean,
  destructiveAction,
  fieldOptions,
}: {
  type: string;
  id: string;
  entry: Record<string, unknown>;
  /**
   * Owns the request+redirect when the entry doesn't live under
   * `/api/resources/<type>` (zone NPCs are inside a zone file). Returns an
   * error message, or null on success.
   */
  save?: (form: Record<string, unknown>) => Promise<string | null>;
  backHref?: string;
  /** Enable Save with no edits (create forms, where the defaults are valid). */
  saveClean?: boolean;
  /**
   * Delete/reset control, rendered right-aligned in the same sticky action bar.
   * Keeping it in the bar avoids a second action row sliding under the sticky one.
   */
  destructiveAction?: React.ReactNode;
  /** Runtime option lists injected from server-only data (character.inc keys, mover lists). */
  fieldOptions?: Record<string, EnumOption[]>;
}) {
  const [form, setForm] = useState<Record<string, unknown>>({ ...entry });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const edited = useMemo(() => JSON.stringify(form) !== JSON.stringify(entry), [form, entry]);
  const canSave = edited || Boolean(saveClean);

  function setField(key: string, value: unknown) {
    setError(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let message: string | null;
      if (save) {
        message = await save(form);
      } else {
        const res = await fetch(`/api/resources/${type}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, yaml: stringifyYaml(form, { lineWidth: 120 }) }),
        });
        const data = await res.json().catch(() => null);
        message = res.ok ? null : (data?.error ?? "Save failed");
      }
      if (message === null) {
        toast.success("Saved");
        router.push(backHref ?? `/resources/${type}`);
        router.refresh();
      } else {
        setError(message);
        toast.error(message);
      }
    } catch {
      const message = "Network error — the change was not saved";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Fields bucketed into sections, sections in the schema's fixed order.
   *
   * Within a section, narrow fields come before full-width ones. Source order
   * would put a full-width table mid-list, and the 2-column grid then leaves a
   * visible hole beside it.
   */
  const sections = useMemo(() => {
    const buckets = new Map<string, Array<[string, unknown]>>();
    for (const [key, value] of Object.entries(form)) {
      if (SKIP_KEYS.has(key)) continue;
      const group = getMeta(key).group;
      const list = buckets.get(group) ?? [];
      list.push([key, value]);
      buckets.set(group, list);
    }
    for (const fields of buckets.values()) {
      const narrow = fields.filter(([k, v]) => !isWideField(k, v));
      const wide = fields.filter(([k, v]) => isWideField(k, v));
      fields.splice(0, fields.length, ...narrow, ...wide);
    }
    const ordered: Array<[string, Array<[string, unknown]>]> = [];
    for (const g of GROUP_ORDER) {
      const fields = buckets.get(g);
      if (fields) ordered.push([g, fields]);
    }
    for (const [g, fields] of buckets) {
      if (!GROUP_ORDER.includes(g)) ordered.push([g, fields]);
    }
    return ordered;
  }, [form]);

  return (
    <div className="space-y-4">
      {sections.map(([group, fields], si) => (
        <Section key={group} title={group} count={fields.length} defaultOpen={si < 3}>
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-5 md:grid-cols-2">
            {fields.map(([key, value]) => (
              <div key={key} className={cn(isWideField(key, value) && "md:col-span-2")}>
                <TypedField
                  path={[key]}
                  fieldKey={key}
                  value={value}
                  onChange={(v) => setField(key, v)}
                />
              </div>
            ))}
          </div>
        </Section>
      ))}

      <div className="sticky bottom-0 -mx-1 space-y-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={saving || !canSave} className="cursor-pointer gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : canSave ? "Save changes" : "No changes"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setForm({ ...entry });
              setError(null);
            }}
            disabled={saving || !edited}
            className="cursor-pointer gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </Button>
          <Button variant="ghost" onClick={() => router.back()} className="cursor-pointer gap-2">
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
          {edited && (
            <span className="ml-1 text-xs text-muted-foreground" aria-live="polite">
              Unsaved changes
            </span>
          )}
          {destructiveAction && <div className="ml-auto">{destructiveAction}</div>}
        </div>
      </div>
    </div>
  );
}
