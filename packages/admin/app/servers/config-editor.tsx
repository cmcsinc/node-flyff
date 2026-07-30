"use client";

/**
 * Generated config form for one managed server instance.
 *
 * Fields come from lib/config-fields.ts (mirrors the Zod config schemas). An
 * empty input means "inherit" — the override key is deleted rather than
 * written, so config/default.json + config/<type>-server.json keep winning.
 * Placeholders show what would be inherited.
 */

import * as React from "react";
import { toast } from "sonner";
import { Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CONFIG_FIELDS,
  addToken,
  getAtPath,
  setAtPath,
  type FieldKind,
  type FieldSpec,
} from "@/lib/config-fields";
import { cn } from "@/lib/utils";
import type { InstanceStatus } from "./types";
import { post } from "./types";
export function ConfigEditor({
  inst,
  instances,
  onSaved,
}: {
  inst: InstanceStatus;
  /** All registered instances — sources the option list for multiselect fields. */
  instances: InstanceStatus[];
  onSaved: (next: InstanceStatus[]) => void;
}) {
  const [overrides, setOverrides] = React.useState<Record<string, unknown>>(inst.overrides ?? {});
  const [port, setPort] = React.useState(String(inst.port));
  const [saving, setSaving] = React.useState(false);
  const live = inst.state === "running" || inst.state === "starting";

  // Reset the form only when a different instance is selected. `inst` is a
  // fresh object every 2s status poll, so keying on its contents would wipe
  // edits mid-typing.
  React.useEffect(() => {
    setOverrides(inst.overrides ?? {});
    setPort(String(inst.port));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst.id]);

  const save = async () => {
    setSaving(true);
    try {
      const { instances } = await post({
        action: "update",
        id: inst.id,
        patch: { port: Number(port), overrides },
      });
      if (instances) onSaved(instances);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const setField = (path: string, value: unknown) =>
    setOverrides((prev) => setAtPath(prev, path, value));

  /**
   * Override paths this instance type has no generated field for — hand-written
   * or left over from an older schema. Shown read-only with a remove control so
   * they are visible and clearable without a JSON escape hatch.
   */
  const unmapped = React.useMemo(() => {
    const known = new Set(CONFIG_FIELDS[inst.type].flatMap((s) => s.fields.map((f) => f.path)));
    const out: Array<[string, unknown]> = [];
    const walk = (node: unknown, prefix: string) => {
      if (node === null || typeof node !== "object" || Array.isArray(node)) {
        if (prefix && !known.has(prefix)) out.push([prefix, node]);
        return;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (known.has(path)) continue;
        walk(v, path);
      }
    };
    walk(overrides, "");
    return out;
  }, [overrides, inst.type]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings2 className="h-4 w-4" /> Config — {inst.id}
        </CardTitle>
        <CardDescription>
          Placeholders show the value inherited from config/default.json + config/
          {inst.type}-server.json. Stop the server to edit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="cfg-port">Client-facing port (server.port)</Label>
          <Input
            id="cfg-port"
            type="number"
            min={1024}
            max={65535}
            value={port}
            disabled={live}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>

        {CONFIG_FIELDS[inst.type].map((section) => (
          <fieldset key={section.title} className="space-y-3" disabled={live}>
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.title}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {section.fields.map((f) => (
                <ConfigField
                  key={f.path}
                  spec={f}
                  value={getAtPath(overrides, f.path)}
                  inherited={getAtPath(inst.inherited ?? {}, f.path)}
                  choices={
                    f.optionsFrom
                      ? instances.filter((i) => i.type === f.optionsFrom).map((i) => i.id)
                      : undefined
                  }
                  disabled={live}
                  onChange={(v) => setField(f.path, v)}
                />
              ))}
            </div>
          </fieldset>
        ))}

        {unmapped.length > 0 && (
          <fieldset className="space-y-2" disabled={live}>
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Other overrides
            </legend>
            <p className="text-[11px] text-muted-foreground">
              Set outside this form and not covered by a generated field. Remove one to fall back to
              the inherited value.
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {unmapped.map(([path, value]) => (
                <li key={path} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
                  <span className="font-mono text-xs text-muted-foreground">{fmt(value)}</span>
                  <button
                    type="button"
                    disabled={live}
                    aria-label={`Remove override ${path}`}
                    onClick={() => setField(path, undefined)}
                    className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <Button onClick={save} disabled={saving || live} className="cursor-pointer">
          {saving ? "Saving…" : "Save"}
        </Button>

        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
            Effective config (config/instances/{inst.id}.json)
          </summary>
          <pre className="max-h-72 overflow-auto border-t border-border p-3 font-mono text-[11px]">
            {JSON.stringify(inst.effective ?? {}, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

/** One generated input. Empty value = "inherit", which deletes the override key. */
function ConfigField({
  spec,
  value,
  inherited,
  choices,
  disabled,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  inherited: unknown;
  /** Live option list for multiselect fields (registered instance ids). */
  choices?: string[];
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `cfg-${spec.path.replace(/\./g, "-")}`;
  const placeholder = fmt(inherited);

  if (spec.kind === "multiselect") {
    return (
      <Wrap id={id} spec={spec} placeholder={placeholder}>
        <MultiSelect
          id={id}
          selected={Array.isArray(value) ? value.map(String) : undefined}
          inheritedList={Array.isArray(inherited) ? inherited.map(String) : []}
          choices={choices ?? []}
          disabled={disabled}
          onChange={onChange}
        />
      </Wrap>
    );
  }

  if (spec.kind === "boolean") {
    // Tri-state: inherit / true / false — a checkbox cannot express "inherit".
    return (
      <Wrap id={id} spec={spec} placeholder={placeholder}>
        <Select
          id={id}
          disabled={disabled}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
        >
          <option value="">inherit ({placeholder || "unset"})</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      </Wrap>
    );
  }

  if (spec.kind === "select") {
    return (
      <Wrap id={id} spec={spec} placeholder={placeholder}>
        <Select
          id={id}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        >
          <option value="">inherit ({placeholder || "unset"})</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </Wrap>
    );
  }

  return (
    <Wrap id={id} spec={spec} placeholder={placeholder}>
      <TextField
        id={id}
        spec={spec}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
      />
    </Wrap>
  );
}

/**
 * Text/number/csv input. Holds its own draft string so mid-edit states that
 * do not round-trip through a value (`0.`, `-`, `a, `) survive keystrokes.
 */
function TextField({
  id,
  spec,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  spec: FieldSpec;
  value: unknown;
  placeholder: string;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const external = fmt(value);
  const [draft, setDraft] = React.useState(external);

  // Adopt the external value when it changes underneath us (instance switch,
  // save round-trip) — but not while the draft still parses to the same value.
  React.useEffect(() => {
    if (fmt(parseField(spec.kind, draft)) !== external) setDraft(external);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external]);

  return (
    <Input
      id={id}
      type={spec.kind === "number" ? "number" : "text"}
      {...(spec.kind === "number" ? { step: "any" } : {})}
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseField(spec.kind, e.target.value));
      }}
    />
  );
}

/**
 * Token ("chip") field over the registered instance ids — type to filter, Enter
 * to add, click × or Backspace to remove. `selected === undefined` means
 * "inherit"; the first edit materializes an explicit array override.
 *
 * Suggestions use a native `<datalist>`: the browser does the substring match
 * and renders the dropdown, so there is no combobox state machine to keep
 * correct. Unregistered ids can still be typed in (a world may be added later).
 *
 * ponytail: datalist styling is browser-controlled and it has no keyboard
 * "highlight first match" affordance. Upgrade path = a real listbox with
 * aria-activedescendant if operators ask for it.
 */
function MultiSelect({
  id,
  selected,
  inheritedList,
  choices,
  disabled,
  onChange,
}: {
  id: string;
  selected: string[] | undefined;
  inheritedList: string[];
  choices: string[];
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const active = selected ?? inheritedList;
  const available = choices.filter((c) => !active.includes(c));

  const add = (raw: string) => {
    const next = addToken(active, raw);
    setDraft("");
    if (next.length !== active.length) onChange(next);
  };

  const remove = (v: string) => onChange(active.filter((x) => x !== v));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (draft.trim() === "") return;
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && active.length > 0) {
      remove(active[active.length - 1]!);
    }
  };

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-sm transition-colors",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-ring/40",
        )}
      >
        {active.map((v) => (
          <span
            key={v}
            className={cn(
              "inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs",
              !choices.includes(v) && "text-muted-foreground ring-1 ring-inset ring-border",
            )}
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              title={choices.includes(v) ? undefined : "Not a registered instance"}
              disabled={disabled}
              onClick={() => remove(v)}
              className="rounded hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          list={`${id}-options`}
          role="combobox"
          aria-expanded={available.length > 0}
          aria-controls={`${id}-options`}
          autoComplete="off"
          disabled={disabled}
          value={draft}
          placeholder={active.length === 0 ? "type an id…" : ""}
          onChange={(e) => {
            // Picking from the dropdown fires change with the full value.
            const v = e.target.value;
            if (available.includes(v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <datalist id={`${id}-options`}>
          {available.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      {selected !== undefined && (
        <button
          type="button"
          disabled={disabled}
          className="text-[11px] text-muted-foreground underline disabled:opacity-50"
          onClick={() => onChange(undefined)}
        >
          reset to inherited
        </button>
      )}
    </div>
  );
}

function Wrap({
  id,
  spec,
  placeholder,
  children,
}: {
  id: string;
  spec: FieldSpec;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{spec.label}</Label>
      {children}
      {spec.hint && <p className="text-[11px] text-muted-foreground">{spec.hint}</p>}
      {!spec.hint && placeholder && (
        <p className="text-[11px] text-muted-foreground">
          inherited: <span className="font-mono">{placeholder}</span>
        </p>
      )}
    </div>
  );
}

/** Blank input = inherit (undefined). NaN numbers are dropped, not stored. */
function parseField(kind: FieldKind, text: string): unknown {
  if (text.trim() === "") return undefined;
  if (kind === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (kind === "csv") {
    return text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return text;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}