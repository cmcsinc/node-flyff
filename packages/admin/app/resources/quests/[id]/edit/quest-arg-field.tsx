'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/form/searchable-select';
import { useFieldOptions } from '@/components/form/field-options';
import type { QuestArgKind, QuestArgSpec } from '@/lib/quest-fields';
import type { QuestArg } from '@flyff/resources';

/**
 * One labelled, typed control per quest command argument.
 *
 * The converter stores args as `{type:'num'|'sym'|'str', value}` — positional and
 * shapeless. This maps each one onto its `QuestArgSpec` so a GM sees "Item to
 * collect / count", not `args[4] = 100`.
 *
 * Two rules from `.claude/rules/12-admin-form-ux.md` drive the design:
 *
 * - **The stored `type` is preserved.** A `sym` arg that comes back unchanged must
 *   round-trip as a `sym` so the writer's symbol ladder can reuse the file's
 *   original token (`II_SYS_SYS_QUE_...`) rather than emitting a bare number.
 *   Editing the value drops it to `num`, because the name no longer applies.
 * - **A sentinel is not zero.** `-1` means "any"/"unset" for sex and job-slot args;
 *   clearing the input restores the sentinel, never `0`, which would be job 0.
 *
 * @module app/resources/quests/[id]/edit/quest-arg-field
 */

/** Which option registry an arg kind picks from, if any. */
const KIND_OPTIONS: Partial<Record<QuestArgKind, string>> = {
  item: 'item',
  mover: 'mover',
  job: 'job',
  'character-key': 'characterKey',
  'skill-id': 'skill',
};

/** Small fixed enums — inline rather than in the shared registry. */
const INLINE_ENUMS: Partial<Record<QuestArgKind, { value: string; label: string }[]>> = {
  'enum:sex': [
    { value: '-1', label: 'Any (-1)' },
    { value: '0', label: 'Male (0)' },
    { value: '1', label: 'Female (1)' },
  ],
  'enum:compare': [
    { value: '0', label: 'At least (0)' },
    { value: '1', label: 'Exactly (1)' },
    { value: '2', label: 'At most (2)' },
  ],
  'enum:condItemType': [
    { value: '0', label: 'By job slot (0)' },
    { value: '1', label: 'By item id (1)' },
  ],
  'enum:questKind': [
    { value: '1992', label: 'Event (1992)' },
    { value: '1993', label: 'Normal (1993)' },
    { value: '1996', label: 'Scenario (1996)' },
    { value: '1999', label: 'Request (1999)' },
    { value: '6003', label: 'Category header (6003)' },
  ],
};

function isNumericKind(kind: QuestArgKind): boolean {
  return (
    kind === 'int' ||
    kind === 'float' ||
    kind === 'bool' ||
    kind === 'item' ||
    kind === 'mover' ||
    kind === 'job' ||
    kind === 'quest-id' ||
    kind === 'skill-id' ||
    kind === 'world-id' ||
    kind.startsWith('enum:')
  );
}

/** Human label for an arg slot, falling back to its position. */
function argLabel(spec: QuestArgSpec | undefined, index: number, group?: number): string {
  const base = spec
    ? spec.name.replace(/([a-z])([A-Z])/g, '$1 $2')
    : `Argument ${String(index + 1)}`;
  const titled = base.charAt(0).toUpperCase() + base.slice(1);
  return group !== undefined ? `${titled} ${String(group + 1)}` : titled;
}

export interface ArgFieldProps {
  id: string;
  spec?: QuestArgSpec;
  arg?: QuestArg;
  index: number;
  group?: number;
  disabled?: boolean;
  onChange: (arg: QuestArg) => void;
}

/**
 * Render one argument.
 *
 * `disabled` renders a read-only value — used for dead commands (no parse branch
 * in the C++, so an edit would change nothing) rather than hiding them, which
 * would make the file look different from what it is.
 */
export function QuestArgField({
  id,
  spec,
  arg,
  index,
  group,
  disabled,
  onChange,
}: ArgFieldProps): React.JSX.Element {
  const ctxOpts = useFieldOptions();
  const kind: QuestArgKind = spec?.kind ?? 'int';
  const label = argLabel(spec, index, group);
  const raw = arg?.value;

  // A `sym` arg displays its symbol name; anything else shows the raw value.
  const display = raw === undefined ? '' : String(raw);

  if (disabled) {
    return (
      <Field htmlFor={id} label={label} hint={spec?.hint}>
        <Input id={id} value={display} readOnly disabled className="h-9 font-mono text-xs" />
      </Field>
    );
  }

  const numeric = isNumericKind(kind);

  /** Emit a value, keeping `sym` only when the value did not change. */
  function emit(next: string): void {
    if (numeric) {
      if (next === '') {
        // Empty restores the sentinel rather than collapsing to 0 — for a sex or
        // job-slot arg, 0 is a real value and -1 is "unset".
        onChange({ type: 'num', value: spec?.sentinel ?? 0 });
        return;
      }
      const n = kind === 'float' ? Number.parseFloat(next) : Number.parseInt(next, 10);
      if (!Number.isFinite(n)) return;
      // Unchanged value keeps its original `sym` type so the writer can reuse the
      // file's own token; a changed one becomes a plain number.
      const same = arg?.type === 'sym' && Number(raw) === n;
      onChange(same ? arg : { type: 'num', value: n });
      return;
    }
    onChange({ type: 'str', value: next });
  }

  // `ctxOpts` is a plain Record, so an absent registry key reads as undefined at
  // runtime even though the type says otherwise — hence the explicit lookup.
  const registry = KIND_OPTIONS[kind];
  const options =
    INLINE_ENUMS[kind] ??
    (registry !== undefined
      ? (ctxOpts[registry] as (typeof INLINE_ENUMS)[QuestArgKind])
      : undefined);

  if (options !== undefined && options.length > 0) {
    return (
      <Field htmlFor={id} label={label} hint={spec?.hint}>
        <SearchableSelect
          id={id}
          value={display}
          options={options}
          onChange={emit}
          placeholder={`Select ${label.toLowerCase()}…`}
        />
      </Field>
    );
  }

  if (kind === 'bool') {
    return (
      <div className="flex items-start gap-3 py-1">
        <Switch
          id={id}
          checked={Number(raw) !== 0}
          onChange={(e) => {
            emit(e.target.checked ? '1' : '0');
          }}
        />
        <div className="space-y-0.5">
          <label htmlFor={id} className="cursor-pointer text-sm">
            {label}
          </label>
          {spec?.hint && (
            <p className="text-[11px] leading-snug text-muted-foreground">{spec.hint}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Field htmlFor={id} label={label} hint={spec?.hint}>
      <NumericOrText
        id={id}
        kind={kind}
        numeric={numeric}
        value={display}
        min={spec?.min}
        max={spec?.max}
        onCommit={emit}
      />
    </Field>
  );
}

/**
 * Input that holds its own text while focused.
 *
 * Without this a half-typed `-` or `0.` is parsed, rejected, and clobbered — so
 * a negative sentinel is impossible to type and a float loses its decimal point.
 */
function NumericOrText({
  id,
  kind,
  numeric,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  kind: QuestArgKind;
  numeric: boolean;
  value: string;
  min?: number;
  max?: number;
  onCommit: (v: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);

  return (
    <Input
      id={id}
      type={numeric ? 'number' : 'text'}
      inputMode={kind === 'float' ? 'decimal' : numeric ? 'numeric' : 'text'}
      // `any` keeps a float's precision: step="1" silently rounds 0.48 to 0.
      step={kind === 'float' ? 'any' : numeric ? 1 : undefined}
      min={min}
      max={max}
      value={text ?? value}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(e.target.value);
      }}
      onBlur={() => {
        setText(null);
      }}
      className="h-9"
    />
  );
}
