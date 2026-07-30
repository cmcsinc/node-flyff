"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/form/searchable-select";
import {
  coerce,
  getMeta,
  getOptions,
  optionLabel,
  resolveKind,
  stepFor,
  type FieldKind,
} from "@/lib/field-schema";
import { useFieldOptions } from "./field-options";
import { cn } from "@/lib/utils";

/**
 * Typed form controls for resource YAML values.
 *
 * Every value shape gets a real control — never a JSON textarea. Types are
 * preserved on round-trip: an int stays an int, a float keeps its precision, and
 * an empty numeric input restores the previous value instead of collapsing to 0.
 * See `.claude/rules/12-admin-form-ux.md`.
 *
 * @module components/form/typed-field
 */

/** Stable DOM id from a nested field path. */
function pathId(path: readonly string[]): string {
  return `f-${path.join("-").replace(/[^\w-]/g, "_")}`;
}

// ── Leaf controls ──────────────────────────────────────────────────────────

function NumberInput({
  id,
  kind,
  value,
  min,
  max,
  onChange,
  className,
}: {
  id?: string;
  kind: FieldKind;
  value: unknown;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  // Local text state so a half-typed "-" or "0." isn't clobbered mid-edit.
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value === null || value === undefined ? "" : String(value));

  return (
    <Input
      id={id}
      type="number"
      inputMode={kind === "int" ? "numeric" : "decimal"}
      step={stepFor(kind)}
      min={min}
      max={max}
      value={display}
      onChange={(e) => {
        setText(e.target.value);
        const next = coerce(kind, e.target.value);
        if (typeof next === "number") onChange(next);
      }}
      onBlur={() => setText(null)}
      className={cn("h-9", className)}
    />
  );
}

/** Three number inputs on one row — replaces the `{x,y,z}` JSON blob. */
function Vector3Field({
  path,
  value,
  onChange,
}: {
  path: readonly string[];
  value: unknown;
  onChange: (v: Record<string, number>) => void;
}) {
  const v = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["x", "y", "z"] as const).map((axis) => (
        <AxisInput
          key={axis}
          id={pathId([...path, axis])}
          axis={axis}
          kind="float"
          value={v[axis] ?? 0}
          onChange={(n) => onChange({ ...(v as Record<string, number>), [axis]: n })}
        />
      ))}
    </div>
  );
}

/** Two number inputs on one row — replaces the `{min,max}` JSON blob. */
function RangeField({
  path,
  value,
  onChange,
}: {
  path: readonly string[];
  value: unknown;
  onChange: (v: Record<string, number>) => void;
}) {
  const v = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["min", "max"] as const).map((bound) => {
        const raw = v[bound];
        return (
          <AxisInput
            key={bound}
            id={pathId([...path, bound])}
            axis={bound}
            kind={typeof raw === "number" && !Number.isInteger(raw) ? "float" : "int"}
            value={raw ?? 0}
            onChange={(n) => onChange({ ...(v as Record<string, number>), [bound]: n })}
          />
        );
      })}
    </div>
  );
}

/**
 * One numeric input with its axis/bound name as an inline prefix.
 *
 * The name goes *inside* the control rather than on a line above it so a
 * multi-part field is exactly as tall as a plain input — otherwise every
 * vector/range field is two label-lines tall and knocks the surrounding
 * two-column grid out of vertical alignment.
 */
function AxisInput({
  id,
  axis,
  kind,
  value,
  onChange,
}: {
  id: string;
  axis: string;
  kind: FieldKind;
  value: unknown;
  onChange: (v: number) => void;
}) {
  return (
    <div className="relative">
      <Label
        htmlFor={id}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {axis}
      </Label>
      <NumberInput
        id={id}
        kind={kind}
        value={value}
        onChange={onChange}
        className={axis.length > 1 ? "pl-10" : "pl-7"}
      />
    </div>
  );
}

/** Chip list of scalars. Enum-backed lists pick from a select, not free text. */
function ListField({
  path,
  fieldKey,
  value,
  onChange,
}: {
  path: readonly string[];
  fieldKey: string;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  const ctxOpts = useFieldOptions();
  const meta = getMeta(fieldKey);
  const options = ctxOpts[meta.options!] ?? getOptions(meta.options);
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // A list of numbers stays a list of numbers.
    const numeric = value.length > 0 ? typeof value[0] === "number" : Number.isFinite(Number(trimmed));
    onChange([...value, numeric && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item, i) => (
            <li key={`${String(item)}-${i}`}>
              <Badge variant="secondary" className="gap-1.5 py-1 text-xs font-normal">
                {optionLabel(meta.options, item) || String(item)}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={`Remove ${String(item)}`}
                  className="cursor-pointer rounded opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {options ? (
        <SearchableSelect
          id={pathId([...path, "add"])}
          value=""
          options={options.filter((o) => !value.map(String).includes(o.value))}
          onChange={add}
          placeholder="Add…"
          className="max-w-xs"
        />
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={pathId([...path, "add"])}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              }
            }}
            placeholder="Add a value…"
            aria-label="New list value"
            className="h-9 max-w-[16rem]"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => add(draft)}
            className="h-9 cursor-pointer gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

/** One editable cell in an object-array table — typed by its column key. */
function TableCellControl({
  path,
  column,
  row,
  onChange,
}: {
  path: readonly string[];
  column: string;
  row: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const ctxOpts = useFieldOptions();
  const raw = row[column];
  const meta = getMeta(column);
  const kind = resolveKind(column, raw);
  const options = ctxOpts[meta.options!] ?? getOptions(meta.options);
  const id = pathId([...path, column]);

  if (options) {
    return (
      <SearchableSelect
        id={id}
        value={String(raw ?? "")}
        options={options}
        onChange={(v) => onChange(kind === "int" || typeof raw === "number" ? Number(v) : v)}
        placeholder="—"
        className="min-w-[11rem]"
      />
    );
  }

  if (kind === "bool") {
    return (
      <Switch id={id} checked={Boolean(raw)} onChange={(e) => onChange(e.target.checked)} aria-label={meta.label} />
    );
  }

  if (kind === "int" || kind === "float") {
    return (
      <NumberInput id={id} kind={kind} value={raw} onChange={onChange} className="h-8 min-w-[6rem] text-xs" />
    );
  }

  if (kind === "vector3") {
    return <Vector3Field path={[...path, column]} value={raw} onChange={onChange} />;
  }

  if (kind === "list" || kind === "table" || kind === "object" || kind === "range") {
    // Nested collections get their own row-level editor rather than a cell.
    return <NestedCellEditor path={[...path, column]} fieldKey={column} value={raw} onChange={onChange} />;
  }

  return (
    <Input
      id={id}
      value={String(raw ?? "")}
      onChange={(e) => onChange(e.target.value)}
      aria-label={meta.label}
      className="h-8 min-w-[8rem] text-xs"
    />
  );
}

/** Collapsed summary + inline editor for a collection nested inside a table cell. */
function NestedCellEditor({
  path,
  fieldKey,
  value,
  onChange,
}: {
  path: readonly string[];
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="h-7 cursor-pointer gap-1 px-1.5 text-xs"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {count} {count === 1 ? "entry" : "entries"}
      </Button>
      {open && (
        <div className="rounded-md border border-border bg-muted/20 p-2">
          <TypedField path={path} fieldKey={fieldKey} value={value} onChange={onChange} bare />
        </div>
      )}
    </div>
  );
}

/** Array of objects → a table with one typed control per column. */
function ObjectTableField({
  path,
  fieldKey,
  value,
  onChange,
}: {
  path: readonly string[];
  fieldKey: string;
  value: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
}) {
  const meta = getMeta(fieldKey);
  const hasTemplate = value.length > 0 || (meta.columns && Object.keys(meta.columns).length > 0);

  const [open, setOpen] = useState(value.length > 0 && value.length <= 8);

  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
    }
    // Fall back to the declared column template when the array is empty.
    if (keys.length === 0 && meta.columns) {
      for (const k of Object.keys(meta.columns)) keys.push(k);
    }
    return keys;
  }, [value, meta.columns]);

  /** A new row mirrors the first row's shape so types stay consistent. */
  function addRow() {
    if (!hasTemplate) return;
    const template = value[0];
    const blank: Record<string, unknown> = {};
    if (template) {
      for (const [k, v] of Object.entries(template)) {
        blank[k] = typeof v === "number" ? 0 : typeof v === "boolean" ? false : Array.isArray(v) ? [] : v && typeof v === "object" ? {} : "";
      }
    } else if (meta.columns) {
      // No row to copy — build from the declared column types.
      for (const [k, kKind] of Object.entries(meta.columns)) {
        blank[k] = kKind === "int" || kKind === "float" ? 0 : kKind === "bool" ? false : "";
      }
    }
    onChange([...value, blank]);
    setOpen(true);
  }

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        // Empty collections get one affordance, not a disabled toggle plus a
        // separate "no entries" line plus an Add button.
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border px-3 py-2.5">
          <p className="text-xs text-muted-foreground">No entries</p>
          {hasTemplate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              className="ml-auto h-8 cursor-pointer gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add row
            </Button>
          ) : (
            <p className="ml-auto text-[11px] text-muted-foreground">
              Add an entry with the correct shape to enable rows
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="h-8 cursor-pointer gap-1.5 px-2 text-xs"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {value.length} {value.length === 1 ? "entry" : "entries"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className="h-8 cursor-pointer gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add row
          </Button>
        </div>
      )}

      {open && value.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">{getMeta(fieldKey).label}</caption>
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="w-10 px-2 py-2 text-left font-medium text-muted-foreground">#</th>
                {columns.map((col) => (
                  <th key={col} scope="col" className="px-2 py-2 text-left font-medium">
                    {getMeta(col).label}
                  </th>
                ))}
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {value.map((row, ri) => (
                <tr key={ri} className="border-t border-border align-top transition-colors hover:bg-muted/30">
                  <td className="px-2 py-2 text-muted-foreground">{ri + 1}</td>
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1.5">
                      <TableCellControl
                        path={[...path, String(ri)]}
                        column={col}
                        row={row}
                        onChange={(v) => {
                          const next = [...value];
                          next[ri] = { ...next[ri], [col]: v };
                          onChange(next);
                        }}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onChange(value.filter((_, j) => j !== ri))}
                      aria-label={`Remove entry ${ri + 1}`}
                      className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Nested object → a titled sub-group of real fields, recursing all the way down. */
function ObjectGroupField({
  path,
  value,
  onChange,
}: {
  path: readonly string[];
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        No entries
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/20 p-3">
      {entries.map(([key, child]) => (
        <TypedField
          key={key}
          path={[...path, key]}
          fieldKey={key}
          value={child}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
    </div>
  );
}

/** Generated source text — visible for reference, never hand-edited here. */
function ReadonlyField({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = String(value ?? "");
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="h-7 cursor-pointer gap-1 px-1.5 text-xs"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? "Hide" : "Show"} source
      </Button>
      {open && (
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {text}
        </pre>
      )}
    </div>
  );
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * One form row for one YAML key: label, hint, and the control its shape needs.
 * `bare` drops the label wrapper (used when already inside a labelled cell).
 */
export function TypedField({
  path,
  fieldKey,
  value,
  onChange,
  bare = false,
}: {
  path: readonly string[];
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  bare?: boolean;
}) {
  const ctxOpts = useFieldOptions();
  const meta = getMeta(fieldKey);
  const kind = resolveKind(fieldKey, value);
  const options = ctxOpts[meta.options!] ?? getOptions(meta.options);
  const id = pathId(path);

  let control: React.ReactNode;

  if (kind === "enum" || (options && (kind === "int" || kind === "text"))) {
    control = (
      <SearchableSelect
        id={id}
        value={String(value ?? "")}
        options={options ?? []}
        onChange={(v) => onChange(typeof value === "number" || kind === "int" ? Number(v) : v)}
        placeholder={`Select ${meta.label.toLowerCase()}…`}
      />
    );
  } else if (kind === "bool") {
    // Switch carries its own inline label; return early so it isn't double-labelled.
    return (
      <div className="flex items-start gap-3 py-1">
        <Switch id={id} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <div className="space-y-0.5">
          <Label htmlFor={id} className="cursor-pointer text-sm">{meta.label}</Label>
          {meta.hint && <p className="text-[11px] leading-snug text-muted-foreground">{meta.hint}</p>}
        </div>
      </div>
    );
  } else if (kind === "int" || kind === "float") {
    control = (
      <NumberInput id={id} kind={kind} value={value} min={meta.min} max={meta.max} onChange={onChange} />
    );
  } else if (kind === "vector3") {
    control = <Vector3Field path={path} value={value} onChange={onChange} />;
  } else if (kind === "range") {
    control = <RangeField path={path} value={value} onChange={onChange} />;
  } else if (kind === "list") {
    control = (
      <ListField path={path} fieldKey={fieldKey} value={Array.isArray(value) ? value : []} onChange={onChange} />
    );
  } else if (kind === "table") {
    const rows = Array.isArray(value) ? (value.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : [];
    control = <ObjectTableField path={path} fieldKey={fieldKey} value={rows} onChange={onChange} />;
  } else if (kind === "object") {
    control = (
      <ObjectGroupField
        path={path}
        value={(value ?? {}) as Record<string, unknown>}
        onChange={onChange}
      />
    );
  } else if (kind === "readonly") {
    control = <ReadonlyField value={value} />;
  } else if (kind === "prose") {
    control = (
      <textarea
        id={id}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      />
    );
  } else {
    control = (
      <Input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (bare) return <>{control}</>;

  // Collections put their hint under the label: a hint trailing a table reads as
  // a caption for the last row rather than as guidance for the whole field.
  const hintAbove = kind === "table" || kind === "object" || kind === "list";

  return (
    <Field htmlFor={id} label={meta.label} hint={meta.hint} hintPosition={hintAbove ? "above" : "below"}>
      {control}
    </Field>
  );
}

/** Which kinds need the full grid width. */
export function isWideField(fieldKey: string, value: unknown): boolean {
  const kind = resolveKind(fieldKey, value);
  if (kind === "readonly" || kind === "prose" || kind === "object") return true;
  // A table/list only needs the full row once it actually holds something —
  // an empty one is a single narrow control and shouldn't punch a hole in the grid.
  if (kind === "table" || kind === "list") return Array.isArray(value) && value.length > 0;
  return false;
}
