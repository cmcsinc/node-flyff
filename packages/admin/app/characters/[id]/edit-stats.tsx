'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, FieldGroup } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { responseError } from '@/lib/api-response';
import { toast } from 'sonner';
import { Loader2, AlertCircle, Pencil, Wand2 } from 'lucide-react';
import { JOB_NAMES } from '@/lib/utils';
import { planJobChange, gpForLevel } from '@/lib/job-change';
import { expThreshold, expToPercent, percentToExp, formatPercent } from '@/lib/exp-percent';

/**
 * Fields this form may change. Deliberately excludes:
 *  - world location (worldId / zoneId / x / y / z) — moving a character by hand
 *    desyncs the client's loaded world; use the in-game `/teleport` command.
 *  - vitals (hp / mp / maxHp / maxMp) — max* are derived from level + STA + gear
 *    DST on every JOIN, so a hand-set value is overwritten (memory
 *    `vital-clamp-use-getmaxhp-not-field`).
 *  - skillLevel (lifetime SP earned) — an audit counter, never edited.
 */
export interface EditableStats {
  level: number;
  exp: string;
  class: number;
  strength: number;
  stamina: number;
  dexterity: number;
  intelligence: number;
  remainGp: number;
  skillPoint: number;
  pkPropensity: number;
  pkValue: number;
  pkTime: number;
  pkExp: number;
}

type NumKey = {
  [K in keyof EditableStats]: EditableStats[K] extends number ? K : never;
}[keyof EditableStats];

interface NumField {
  key: NumKey;
  label: string;
  /** Inclusive bounds — mirror `PatchSchema` in app/api/characters/route.ts. */
  min: number;
  max: number;
  hint?: string;
}

// Each group is sized to fill its grid exactly (3 / 4 / 4 across), and every
// field carries a hint so rows in a grid share the same height — a mix of
// hinted and unhinted fields leaves ragged bottoms.
const PROGRESSION_FIELDS: NumField[] = [
  { key: 'level', label: 'Level', min: 1, max: 199, hint: '1–199' },
  { key: 'skillPoint', label: 'Skill points', min: 0, max: 1_000_000, hint: 'Unspent SP' },
  { key: 'remainGp', label: 'Stat points', min: 0, max: 1_000_000, hint: 'Unspent GP' },
];

const STAT_FIELDS: NumField[] = [
  { key: 'strength', label: 'STR', min: 0, max: 65_535, hint: 'Strength' },
  { key: 'stamina', label: 'STA', min: 0, max: 65_535, hint: 'Stamina' },
  { key: 'dexterity', label: 'DEX', min: 0, max: 65_535, hint: 'Dexterity' },
  { key: 'intelligence', label: 'INT', min: 0, max: 65_535, hint: 'Intelligence' },
];

const PK_FIELDS: NumField[] = [
  { key: 'pkPropensity', label: 'Propensity', min: 0, max: 1_000_000, hint: 'm_dwPKPropensity' },
  { key: 'pkValue', label: 'Value', min: 0, max: 1_000_000, hint: 'Slaughter count' },
  { key: 'pkExp', label: 'PK exp', min: 0, max: 1_000_000, hint: 'm_nPKExp' },
];

const ALL_NUM_FIELDS = [...PROGRESSION_FIELDS, ...STAT_FIELDS, ...PK_FIELDS];

/**
 * `pkTime` is a wall-clock epoch-ms stamp of the last PK action (C++
 * `m_dwPKTime`) that PkDecaySystem measures elapsed time against — not a
 * duration — so the control is a datetime picker and we store `getTime()`.
 * Empty input means `0` = "never".
 */
function msToLocalInput(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToMs(value: string): number {
  if (value.trim() === '') return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Client-side mirror of the API schema, so errors land next to the field. */
function validate(form: EditableStats): Partial<Record<keyof EditableStats, string>> {
  const errors: Partial<Record<keyof EditableStats, string>> = {};
  for (const f of ALL_NUM_FIELDS) {
    const v = form[f.key];
    if (!Number.isFinite(v)) errors[f.key] = 'Must be a number';
    else if (v < f.min || v > f.max) errors[f.key] = `Must be ${String(f.min)}–${String(f.max)}`;
  }
  if (!/^\d{1,19}$/.test(form.exp)) errors.exp = 'Digits only';
  if (!Number.isFinite(form.pkTime) || form.pkTime < 0 || form.pkTime > 2_147_483_647_000) {
    errors.pkTime = 'Invalid date';
  }
  return errors;
}

/** Trigger button + the modal it opens. Rendered by the character detail page. */
export function EditStatsForm({
  characterId,
  stats,
}: {
  characterId: number;
  stats: EditableStats;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Narrow the (wider) character row down to the editable keys so the PATCH body
  // can never carry a field this form is not allowed to change.
  const editable: EditableStats = {
    level: stats.level,
    exp: stats.exp,
    class: stats.class,
    strength: stats.strength,
    stamina: stats.stamina,
    dexterity: stats.dexterity,
    intelligence: stats.intelligence,
    remainGp: stats.remainGp,
    skillPoint: stats.skillPoint,
    pkPropensity: stats.pkPropensity,
    pkValue: stats.pkValue,
    pkTime: stats.pkTime,
    pkExp: stats.pkExp,
  };
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Pencil className="mr-2 h-4 w-4" />
        Edit character
      </Button>
      {open && (
        <EditStatsModal
          characterId={characterId}
          stats={editable}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function EditStatsModal({
  characterId,
  stats,
  onClose,
}: {
  characterId: number;
  stats: EditableStats;
  onClose: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState<EditableStats>({ ...stats });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const router = useRouter();

  /**
   * EXP is edited as a percentage of the current level's bar; `form.exp` stays
   * the raw within-level value the DB stores. `pct` is kept as its own text
   * state (not derived from `form.exp`) so partial input like "5." survives a
   * keystroke instead of being rounded back by the raw round-trip.
   */
  const [pct, setPct] = useState<string>(() => formatPercent(expToPercent(stats.exp, stats.level)));

  /** Apply a percentage against `level`, keeping `form.exp` in sync. */
  const applyPercent = (nextPct: string, level: number): void => {
    setPct(nextPct);
    setForm((p) => ({ ...p, exp: percentToExp(Number(nextPct), level) }));
  };

  const errors = validate(form);
  const errorCount = Object.keys(errors).length;
  const dirty =
    ALL_NUM_FIELDS.some((f) => form[f.key] !== stats[f.key]) ||
    form.exp !== stats.exp ||
    form.class !== stats.class ||
    form.pkTime !== stats.pkTime;

  /**
   * Switching class autofills level + GP (and resets stats where the job
   * master's script calls `InitStat`). Vagrant → Mercenary lands on level 15,
   * GP 28, STR/DEX/STA/INT 15 — exactly what `ChangeJob(1); InitStat();` in
   * `mafl_hyuit.yml` produces.
   */
  const changeClass = (nextClass: number): void => {
    const plan = planJobChange(nextClass, { level: form.level, remainGp: form.remainGp });
    if (plan && plan.level !== form.level) setPct('0');
    setForm((p) => ({
      ...p,
      class: nextClass,
      ...(plan
        ? {
            level: plan.level,
            remainGp: plan.remainGp,
            // Level changed → within-level exp restarts (C++ SetLevel sets m_nExp1 = 0).
            exp: plan.level !== p.level ? '0' : p.exp,
            ...(plan.stats ?? {}),
          }
        : {}),
    }));
    setJobNote(plan?.note ?? null);
  };

  async function save(): Promise<void> {
    setTouched(true);
    if (errorCount > 0) {
      toast.error(`Fix ${String(errorCount)} invalid field${errorCount > 1 ? 's' : ''} first`);
      return;
    }
    setSaving(true);
    const res = await fetch('/api/characters', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: characterId, ...form }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success('Character updated');
      router.refresh();
      onClose();
    } else {
      toast.error((await responseError(res)) ?? 'Failed to update character');
    }
  }

  /** Errors are only surfaced once the user has attempted a save. */
  const errorFor = (key: keyof EditableStats): string | undefined =>
    touched ? errors[key] : undefined;

  const numInput = (f: NumField): React.JSX.Element => (
    <Field key={f.key} htmlFor={f.key} label={f.label} hint={f.hint} error={errorFor(f.key)}>
      <Input
        id={f.key}
        type="number"
        min={f.min}
        max={f.max}
        value={form[f.key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          // The exp bar is level-relative, so a level change must re-resolve the
          // raw exp from the percentage (which stays where the user put it).
          if (f.key === 'level') applyPercent(pct, v);
          setForm((p) => ({ ...p, [f.key]: v }));
        }}
      />
    </Field>
  );

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Edit character #${String(characterId)}`}
      description="Writes to the database immediately. A logged-in character may overwrite these on its next save — edit while offline."
      footer={
        <>
          <Button onClick={() => { void save(); }} disabled={saving || !dirty}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setForm({ ...stats });
              setPct(formatPercent(expToPercent(stats.exp, stats.level)));
              setTouched(false);
              setJobNote(null);
            }}
            disabled={saving || !dirty}
          >
            Reset
          </Button>
          {touched && errorCount > 0 && (
            <p
              role="alert"
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-destructive"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errorCount} field{errorCount > 1 ? 's' : ''} need attention
            </p>
          )}
          {dirty && errorCount === 0 && (
            <p className="ml-auto text-xs text-muted-foreground">Unsaved changes</p>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <FieldGroup title="Class">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field htmlFor="class" label="Class / job" hint="Autofills level, GP and stats">
              <Select
                id="class"
                value={form.class}
                onChange={(e) => {
                  changeClass(Number(e.target.value));
                }}
              >
                {Object.entries(JOB_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              htmlFor="exp"
              label="EXP %"
              hint={
                expThreshold(form.level) > 0
                  ? `${Number(form.exp).toLocaleString()} / ${expThreshold(form.level).toLocaleString()} into level ${String(form.level)}`
                  : `Level ${String(form.level)} is the cap — no exp bar`
              }
              error={errorFor('exp')}
            >
              <Input
                id="exp"
                type="number"
                min={0}
                max={100}
                step={0.01}
                disabled={expThreshold(form.level) <= 0}
                value={pct}
                onChange={(e) => {
                  applyPercent(e.target.value, form.level);
                }}
              />
            </Field>
          </div>
          {jobNote && (
            <p className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/10 p-2.5 text-[11px] leading-snug">
              <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{jobNote}</span>
            </p>
          )}
        </FieldGroup>

        <FieldGroup title="Progression">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PROGRESSION_FIELDS.map(numInput)}
          </div>
        </FieldGroup>

        <FieldGroup title="Base stats">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{STAT_FIELDS.map(numInput)}</div>
          <button
            type="button"
            onClick={() => {
              setForm((p) => ({
                ...p,
                strength: 15,
                dexterity: 15,
                stamina: 15,
                intelligence: 15,
                remainGp: gpForLevel(p.level),
              }));
            }}
            className="text-[11px] font-medium text-primary underline-offset-4 hover:underline"
          >
            Reset stats to 15 and refund GP for level {form.level} ({gpForLevel(form.level)} GP)
          </button>
        </FieldGroup>

        <FieldGroup title="PK state">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PK_FIELDS.map(numInput)}
            <Field
              htmlFor="pkTime"
              label="Last PK action"
              hint={form.pkTime > 0 ? `${String(form.pkTime)} ms` : 'Never'}
              error={errorFor('pkTime')}
              className="col-span-2 sm:col-span-1"
            >
              <Input
                id="pkTime"
                type="datetime-local"
                value={msToLocalInput(form.pkTime)}
                onChange={(e) => {
                  setForm((p) => ({ ...p, pkTime: localInputToMs(e.target.value) }));
                }}
              />
            </Field>
          </div>
        </FieldGroup>
      </div>
    </Modal>
  );
}
