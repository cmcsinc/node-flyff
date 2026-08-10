'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/form/searchable-select';
import {
  coerce,
  fractionToPercent,
  getMeta,
  getOptions,
  optionLabel,
  percentToFraction,
  resolveKind,
  roundPercentValue,
  stepFor,
  type FieldKind,
  type EnumOption,
} from '@/lib/field-schema';
import { formatChanceOdds } from '@/components/chance-cell';
import { useFieldOptions } from './field-options';
import { cn } from '@/lib/utils';

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
  return `f-${path.join('-').replace(/[^\w-]/g, '_')}`;
}

/**
 * Does an option list hold numeric values?
 *
 * Decides whether a picked value is written back as a number or a string. Read
 * from the options rather than from the current cell value, which is `""` in a
 * freshly added table row and would type an id field as a string.
 */
function numericOptions(options: readonly EnumOption[]): boolean {
  const first = options[0];
  return first.value !== '' && !Number.isNaN(Number(first.value));
}

function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
}): React.JSX.Element {
  // Local text state so a half-typed "-" or "0." isn't clobbered mid-edit.
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value === null || value === undefined ? '' : scalarText(value));

  return (
    <Input
      id={id}
      type="number"
      inputMode={kind === 'int' ? 'numeric' : 'decimal'}
      step={stepFor(kind)}
      min={min}
      max={max}
      value={display}
      onChange={(e) => {
        setText(e.target.value);
        const next = coerce(kind, e.target.value);
        if (typeof next === 'number') onChange(next);
      }}
      onBlur={() => {
        setText(null);
      }}
      className={cn('h-9', className)}
    />
  );
}

/**
 * A 0–100 percent that is already a percent on disk.
 *
 * Distinct from {@link PercentInput}, which converts to a 0–1 fraction: a drop
 * chance is stored as the percent itself. Beyond the `%` adornment it shows the
 * reciprocal ("1 in 7,158") live, because "one drop per ~7,000 kills" is what a
 * GM is actually trying to set — a bare `0.0139698` gives no such feel.
 */
function PctInput({
  id,
  value,
  min,
  max,
  onChange,
  className,
}: {
  id?: string;
  value: unknown;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  className?: string;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value === null || value === undefined ? '' : scalarText(value));
  const odds = formatChanceOdds(Number(value));

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          min={min ?? 0}
          max={max ?? 100}
          value={display}
          onChange={(e) => {
            setText(e.target.value);
            const next = coerce('pct', e.target.value);
            if (typeof next === 'number') onChange(roundPercentValue(next));
          }}
          onBlur={() => {
            setText(null);
          }}
          className={cn('h-9 pr-7', className)}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none text-xs text-muted-foreground"
        >
          %
        </span>
      </div>
      {odds && (
        <p className="text-[11px] leading-none text-muted-foreground" aria-live="polite">
          {odds}
        </p>
      )}
    </div>
  );
}

/**
 * A 0–1 fraction edited as 0–100.
 *
 * The zone schema stores weather chance as a fraction (`chance: 0.1`), which
 * reads as "0.1%" to anyone who has not read the schema. The control shows the
 * percentage and converts on the way out, so what lands on disk is still the
 * fraction the game parses.
 */
function PercentInput({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: unknown;
  onChange: (v: number) => void;
  className?: string;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const display =
    text ?? (value === null || value === undefined ? '' : String(fractionToPercent(value)));

  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        max={100}
        value={display}
        onChange={(e) => {
          setText(e.target.value);
          const next = coerce('percent', e.target.value);
          if (typeof next === 'number') onChange(percentToFraction(next));
        }}
        onBlur={() => {
          setText(null);
        }}
        className={cn('h-9 pr-7', className)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none text-xs text-muted-foreground"
      >
        %
      </span>
    </div>
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
}): React.JSX.Element {
  const v = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="grid grid-cols-3 gap-2">
      {(['x', 'y', 'z'] as const).map((axis) => (
        <AxisInput
          key={axis}
          id={pathId([...path, axis])}
          axis={axis}
          kind="float"
          value={v[axis] ?? 0}
          onChange={(n) => {
            onChange({ ...(v as Record<string, number>), [axis]: n });
          }}
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
}): React.JSX.Element {
  const v = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['min', 'max'] as const).map((bound) => {
        const raw = v[bound];
        return (
          <AxisInput
            key={bound}
            id={pathId([...path, bound])}
            axis={bound}
            kind={typeof raw === 'number' && !Number.isInteger(raw) ? 'float' : 'int'}
            value={raw ?? 0}
            // Both bounds are always written: the source value may be `null`
            // (a mob with no penya drop), and emitting a half range would fail
            // the schema's `{min, max}` shape on save.
            onChange={(n) => {
              onChange({ min: 0, max: 0, ...(v as Record<string, number>), [bound]: n });
            }}
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
}): React.JSX.Element {
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
        className={axis.length > 1 ? 'pl-10' : 'pl-7'}
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
}): React.JSX.Element {
  const ctxOpts = useFieldOptions();
  const meta = getMeta(fieldKey);
  const options = (meta.options ? ctxOpts[meta.options] : undefined) ?? getOptions(meta.options);
  const [draft, setDraft] = useState('');

  function add(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // A list of numbers stays a list of numbers.
    const numeric =
      value.length > 0 ? typeof value[0] === 'number' : Number.isFinite(Number(trimmed));
    onChange([...value, numeric && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed]);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item, i) => (
            <li key={`${String(item)}-${String(i)}`}>
              <Badge variant="secondary" className="gap-1.5 py-1 text-xs font-normal">
                {optionLabel(meta.options, item) || String(item)}
                <button
                  type="button"
                  onClick={() => {
                    onChange(value.filter((_, j) => j !== i));
                  }}
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
          id={pathId([...path, 'add'])}
          value=""
          options={options.filter((o) => !value.map(String).includes(o.value))}
          onChange={add}
          placeholder="Add…"
          className="max-w-xs"
        />
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={pathId([...path, 'add'])}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
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
            onClick={() => {
              add(draft);
            }}
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
  parentKey,
  column,
  row,
  onChange,
}: {
  path: readonly string[];
  parentKey: string;
  column: string;
  row: Record<string, unknown>;
  onChange: (v: unknown) => void;
}): React.JSX.Element {
  const ctxOpts = useFieldOptions();
  const raw = row[column];
  const meta = getMeta(column);
  const parent = getMeta(parentKey);
  // The parent table's column template wins: a key like `type` means one thing
  // in a weather variation and another in an NPC function, so the column
  // declaration is more specific than the global entry for that key.
  const kind = parent.columns?.[column] ?? resolveKind(column, raw);
  const optionsKey = parent.columnOptions?.[column] ?? meta.options;
  const options = (optionsKey ? ctxOpts[optionsKey] : undefined) ?? getOptions(optionsKey);
  const id = pathId([...path, column]);

  if (options) {
    return (
      <SearchableSelect
        id={id}
        value={scalarText(raw)}
        options={options}
        // `typeof raw` is not enough: a freshly added row's cell is `""`, and an
        // id field would then be written back as a string the schema rejects.
        // The option list's own values decide the type.
        onChange={(v) => {
          onChange(kind === 'int' || numericOptions(options) ? Number(v) : v);
        }}
        placeholder="—"
        className="min-w-[11rem]"
      />
    );
  }

  if (kind === 'bool') {
    return (
      <Switch
        id={id}
        checked={Boolean(raw)}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        aria-label={meta.label}
      />
    );
  }

  if (kind === 'percent') {
    return (
      <PercentInput id={id} value={raw} onChange={onChange} className="h-8 min-w-[6rem] text-xs" />
    );
  }

  if (kind === 'pct') {
    return (
      <PctInput
        id={id}
        value={raw}
        min={meta.min}
        max={meta.max}
        onChange={onChange}
        className="h-8 min-w-[7rem] text-xs"
      />
    );
  }

  if (kind === 'int' || kind === 'float') {
    return (
      <NumberInput
        id={id}
        kind={kind}
        value={raw}
        min={meta.min}
        max={meta.max}
        onChange={onChange}
        className="h-8 min-w-[6rem] text-xs"
      />
    );
  }

  if (kind === 'vector3') {
    return <Vector3Field path={[...path, column]} value={raw} onChange={onChange} />;
  }

  if (kind === 'list' || kind === 'table' || kind === 'object' || kind === 'range') {
    // Nested collections get their own row-level editor rather than a cell.
    return (
      <NestedCellEditor
        path={[...path, column]}
        fieldKey={column}
        value={raw}
        onChange={onChange}
      />
    );
  }

  return (
    <Input
      id={id}
      value={scalarText(raw)}
      onChange={(e) => {
        onChange(e.target.value);
      }}
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
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const count = Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? Object.keys(value).length
      : 0;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(!open);
        }}
        aria-expanded={open}
        className="h-7 cursor-pointer gap-1 px-1.5 text-xs"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {count} {count === 1 ? 'entry' : 'entries'}
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
}): React.JSX.Element {
  const meta = getMeta(fieldKey);
  const hasTemplate = value.length > 0 || (meta.columns && Object.keys(meta.columns).length > 0);

  const [open, setOpen] = useState(value.length > 0 && value.length <= 8);

  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const row of value) {
      for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
    }
    // Fall back to the declared column template when the array is empty.
    if (keys.length === 0 && meta.columns) {
      for (const k of Object.keys(meta.columns)) keys.push(k);
    }
    return keys;
  }, [value, meta.columns]);

  /**
   * A new row mirrors the first row's shape so types stay consistent.
   *
   * Numeric cells seed from the column's declared `min` rather than 0: a drop
   * slot's `chance` and `count` both have positive lower bounds, and a row of
   * zeroes is one the server-side schema rejects on save — the user would have to
   * discover that by failing.
   */
  function addRow(): void {
    if (!hasTemplate) return;
    const template = value[0];
    const blank: Record<string, unknown> = {};
    const seedNumber = (k: string): number => getMeta(k).min ?? 0;
    if (value.length > 0) {
      for (const [k, v] of Object.entries(template)) {
        blank[k] =
          typeof v === 'number'
            ? seedNumber(k)
            : typeof v === 'boolean'
              ? false
              : Array.isArray(v)
                ? []
                : v && typeof v === 'object'
                  ? {}
                  : '';
      }
    } else if (meta.columns) {
      // No row to copy — build from the declared column types.
      for (const [k, kKind] of Object.entries(meta.columns)) {
        blank[k] =
          kKind === 'int' || kKind === 'float' || kKind === 'percent' || kKind === 'pct'
            ? seedNumber(k)
            : kKind === 'bool'
              ? false
              : '';
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
            onClick={() => {
              setOpen(!open);
            }}
            aria-expanded={open}
            className="h-8 cursor-pointer gap-1.5 px-2 text-xs"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {value.length} {value.length === 1 ? 'entry' : 'entries'}
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
                <th
                  scope="col"
                  className="w-10 px-2 py-2 text-left font-medium text-muted-foreground"
                >
                  #
                </th>
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
                <tr
                  key={ri}
                  className="border-t border-border align-top transition-colors hover:bg-muted/30"
                >
                  <td className="px-2 py-2 text-muted-foreground">{ri + 1}</td>
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1.5">
                      <TableCellControl
                        path={[...path, String(ri)]}
                        parentKey={fieldKey}
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
                      onClick={() => {
                        onChange(value.filter((_, j) => j !== ri));
                      }}
                      aria-label={`Remove entry ${String(ri + 1)}`}
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
}): React.JSX.Element {
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
          onChange={(v) => {
            onChange({ ...value, [key]: v });
          }}
        />
      ))}
    </div>
  );
}

/** Generated source text — visible for reference, never hand-edited here. */
function ReadonlyField({ value }: { value: unknown }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const text = scalarText(value);
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(!open);
        }}
        aria-expanded={open}
        className="h-7 cursor-pointer gap-1 px-1.5 text-xs"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? 'Hide' : 'Show'} source
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
}): React.JSX.Element {
  const ctxOpts = useFieldOptions();
  const meta = getMeta(fieldKey);
  const kind = resolveKind(fieldKey, value);
  const options = (meta.options ? ctxOpts[meta.options] : undefined) ?? getOptions(meta.options);
  const id = pathId(path);

  let control: React.ReactNode;

  if (kind === 'enum' || (options && (kind === 'int' || kind === 'text'))) {
    control = (
      <SearchableSelect
        id={id}
        value={scalarText(value)}
        options={options}
        // The option list's values decide the type, not the current value: an
        // unset field is `undefined` and would otherwise be typed as a string.
        onChange={(v) => {
          onChange(kind === 'int' || numericOptions(options) ? Number(v) : v);
        }}
        placeholder={`Select ${meta.label.toLowerCase()}…`}
      />
    );
  } else if (kind === 'bool') {
    // Switch carries its own inline label; return early so it isn't double-labelled.
    return (
      <div className="flex items-start gap-3 py-1">
        <Switch
          id={id}
          checked={Boolean(value)}
          onChange={(e) => {
            onChange(e.target.checked);
          }}
        />
        <div className="space-y-0.5">
          <Label htmlFor={id} className="cursor-pointer text-sm">
            {meta.label}
          </Label>
          {meta.hint && (
            <p className="text-[11px] leading-snug text-muted-foreground">{meta.hint}</p>
          )}
        </div>
      </div>
    );
  } else if (kind === 'percent') {
    control = <PercentInput id={id} value={value} onChange={onChange} />;
  } else if (kind === 'pct') {
    control = <PctInput id={id} value={value} min={meta.min} max={meta.max} onChange={onChange} />;
  } else if (kind === 'int' || kind === 'float') {
    control = (
      <NumberInput
        id={id}
        kind={kind}
        value={value}
        min={meta.min}
        max={meta.max}
        onChange={onChange}
      />
    );
  } else if (kind === 'vector3') {
    control = <Vector3Field path={path} value={value} onChange={onChange} />;
  } else if (kind === 'range') {
    control = <RangeField path={path} value={value} onChange={onChange} />;
  } else if (kind === 'list') {
    control = (
      <ListField
        path={path}
        fieldKey={fieldKey}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  } else if (kind === 'table') {
    const rows = Array.isArray(value) ? value.filter(isRecord) : [];
    control = <ObjectTableField path={path} fieldKey={fieldKey} value={rows} onChange={onChange} />;
  } else if (kind === 'object') {
    control = (
      <ObjectGroupField
        path={path}
        value={isRecord(value) ? value : {}}
        onChange={onChange}
      />
    );
  } else if (kind === 'readonly') {
    control = <ReadonlyField value={value} />;
  } else if (kind === 'prose') {
    control = (
      <textarea
        id={id}
        value={scalarText(value)}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      />
    );
  } else {
    control = (
      <Input
        id={id}
        value={scalarText(value)}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    );
  }

  if (bare) return <>{control}</>;

  // Collections put their hint under the label: a hint trailing a table reads as
  // a caption for the last row rather than as guidance for the whole field.
  const hintAbove = kind === 'table' || kind === 'object' || kind === 'list';

  return (
    <Field
      htmlFor={id}
      label={meta.label}
      hint={meta.hint}
      hintPosition={hintAbove ? 'above' : 'below'}
    >
      {control}
    </Field>
  );
}

/** Which kinds need the full grid width. */
export function isWideField(fieldKey: string, value: unknown): boolean {
  const kind = resolveKind(fieldKey, value);
  if (kind === 'readonly' || kind === 'prose' || kind === 'object') return true;
  // A table/list only needs the full row once it actually holds something —
  // an empty one is a single narrow control and shouldn't punch a hole in the grid.
  if (kind === 'table' || kind === 'list') return Array.isArray(value) && value.length > 0;
  return false;
}
