'use client';

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/form/searchable-select';
import type { EnumOption } from '@/lib/field-schema';
import type { VendorTabView } from '@/lib/character-inc';

/** Editable form of one `AddVendorItem` rule — a category, not an item. */
export interface RuleDraft {
  slot: number;
  kind3: string;
  job: number;
  uniqueMin: number;
  uniqueMax: number;
  totalNum: number;
}

/** Editable form of one `AddVendorItem2` entry — a concrete propItem id. */
export interface ExplicitDraft {
  slot: number;
  itemId: number;
}

/**
 * Editable form of one shop tab.
 *
 * `label` is the caption a player reads. It lives in `character.txt.txt`, not in
 * the `.inc` — the `.inc` only stores `token`. A tab added here has no token yet;
 * the route mints one and writes both halves together.
 */
export interface TabDraft {
  slot: number;
  label: string;
  token?: string;
}

/** Flatten the server view into the three editable lists. */
export function draftsFromTabs(tabs: readonly VendorTabView[]): {
  tabs: TabDraft[];
  rules: RuleDraft[];
  explicit: ExplicitDraft[];
} {
  return {
    tabs: tabs.map((t) => ({ slot: t.slot, label: t.labelText, token: t.labelToken })),
    rules: tabs.flatMap((t) =>
      t.rules.map((r) => ({
        slot: r.slot,
        kind3: r.kind3,
        job: r.job,
        uniqueMin: r.uniqueMin,
        uniqueMax: r.uniqueMax,
        totalNum: r.totalNum,
      })),
    ),
    explicit: tabs.flatMap((t) => t.explicit.map((e) => ({ slot: e.slot, itemId: e.itemId }))),
  };
}

/**
 * Shop stock editor for one tab.
 *
 * Two independent stocking mechanisms, kept visually separate because they
 * behave differently: a **category rule** (`AddVendorItem`) names an `IK3_*`
 * kind and the server expands it into up to `totalNum` matching items at boot,
 * so its contribution is a computed count the GM cannot see in the file. An
 * **explicit item** (`AddVendorItem2`) is one concrete propItem id.
 *
 * Every numeric cell is a typed number input — no JSON, per rule 12 — and the
 * kind/item pickers show the friendly name plus the raw symbol or id.
 */
export function ShopTabEditor({
  slot,
  view,
  tab,
  rules,
  explicit,
  kind3Options,
  jobOptions,
  itemOptions,
  onTabChange,
  onRulesChange,
  onExplicitChange,
}: {
  slot: number;
  view: VendorTabView | undefined;
  tab: TabDraft | undefined;
  rules: readonly RuleDraft[];
  explicit: readonly ExplicitDraft[];
  kind3Options: readonly EnumOption[];
  jobOptions: readonly EnumOption[];
  itemOptions: readonly EnumOption[];
  onTabChange: (patch: Partial<TabDraft>) => void;
  onRulesChange: (next: RuleDraft[]) => void;
  onExplicitChange: (next: ExplicitDraft[]) => void;
}): React.JSX.Element {
  const myRules = useMemo(() => rules.filter((r) => r.slot === slot), [rules, slot]);
  const myExplicit = useMemo(() => explicit.filter((e) => e.slot === slot), [explicit, slot]);

  /** Replace this tab's rules, leaving other tabs' rules untouched. */
  function setMyRules(next: RuleDraft[]): void {
    onRulesChange([...rules.filter((r) => r.slot !== slot), ...next]);
  }
  function setMyExplicit(next: ExplicitDraft[]): void {
    onExplicitChange([...explicit.filter((e) => e.slot !== slot), ...next]);
  }

  function patchRule(i: number, patch: Partial<RuleDraft>): void {
    setMyRules(myRules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  const captionId = `tab-${String(slot)}-label`;

  return (
    <div className="space-y-5">
      <Field
        htmlFor={captionId}
        label="Tab caption"
        hint={
          tab?.token
            ? `Client string-table row ${tab.token} — written to character.txt.txt`
            : 'New row — a string-table token is assigned on save'
        }
      >
        <Input
          id={captionId}
          value={tab?.label ?? ''}
          onChange={(e) => {
            onTabChange({ label: e.currentTarget.value });
          }}
          placeholder="e.g. Weapons"
          className="h-9 max-w-xs text-xs"
        />
      </Field>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Category rules
          </p>
          {view && (
            <p className="text-[11px] text-muted-foreground">
              Currently fills <strong>{view.filled}</strong> of 100 slots
            </p>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Each rule stocks every item of one kind, cheapest first, up to <strong>Max items</strong>.
          The saved count is computed at world-server boot, so it changes if items are added later.
        </p>

        {myRules.length === 0 ? (
          <EmptyRow
            label="No category rules"
            onAdd={() => {
              setMyRules([
                ...myRules,
                { slot, kind3: '', job: -1, uniqueMin: 1, uniqueMax: 200, totalNum: 25 },
              ]);
            }}
          />
        ) : (
          <div className="space-y-2">
            <div className="hidden gap-x-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_4.5rem_4.5rem_5rem_2rem]">
              <span>Item kind</span>
              <span>Job filter</span>
              <span>Min lv</span>
              <span>Max lv</span>
              <span>Max items</span>
              <span className="sr-only">Remove</span>
            </div>
            {myRules.map((r, i) => {
              const resolved = view?.rules.find((v) => v.kind3 === r.kind3)?.resolved;
              return (
                <div
                  key={`${r.kind3}-${String(i)}`}
                  className="grid items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_4.5rem_4.5rem_5rem_2rem]"
                >
                  <div className="space-y-1">
                    <SearchableSelect
                      value={r.kind3}
                      options={kind3Options}
                      onChange={(v) => {
                        patchRule(i, { kind3: v });
                      }}
                      placeholder="Pick a kind…"
                    />
                    {resolved === 0 && (
                      <p className="text-[10px] leading-snug text-warning">
                        Resolves to 0 items — sells nothing.
                      </p>
                    )}
                  </div>
                  <SearchableSelect
                    value={String(r.job)}
                    options={jobOptions}
                    onChange={(v) => {
                      patchRule(i, { job: Number(v) });
                    }}
                  />
                  <NumCell
                    label={`Min level, rule ${String(i + 1)}`}
                    value={r.uniqueMin}
                    onChange={(n) => {
                      patchRule(i, { uniqueMin: n });
                    }}
                  />
                  <NumCell
                    label={`Max level, rule ${String(i + 1)}`}
                    value={r.uniqueMax}
                    onChange={(n) => {
                      patchRule(i, { uniqueMax: n });
                    }}
                  />
                  <NumCell
                    label={`Max items, rule ${String(i + 1)}`}
                    value={r.totalNum}
                    max={100}
                    onChange={(n) => {
                      patchRule(i, { totalNum: n });
                    }}
                  />
                  <RemoveButton
                    label={`Remove rule ${String(i + 1)}`}
                    onClick={() => {
                      setMyRules(myRules.filter((_, k) => k !== i));
                    }}
                  />
                </div>
              );
            })}
            <AddButton
              label="Add rule"
              onClick={() => {
                setMyRules([
                  ...myRules,
                  { slot, kind3: '', job: -1, uniqueMin: 1, uniqueMax: 200, totalNum: 25 },
                ]);
              }}
            />
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-border pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Specific items
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          One exact item each, added on top of the rules above. Use this to stock a single item
          without pulling in its whole kind.
        </p>

        {myExplicit.length === 0 ? (
          <EmptyRow
            label="No specific items"
            onAdd={() => {
              setMyExplicit([...myExplicit, { slot, itemId: 0 }]);
            }}
          />
        ) : (
          <div className="space-y-2">
            {myExplicit.map((e, i) => (
              <div
                key={`${String(e.itemId)}-${String(i)}`}
                className="grid items-center gap-x-3 md:grid-cols-[minmax(0,1fr)_2rem]"
              >
                <SearchableSelect
                  value={String(e.itemId)}
                  options={itemOptions}
                  onChange={(v) => {
                    setMyExplicit(
                      myExplicit.map((x, k) => (k === i ? { ...x, itemId: Number(v) } : x)),
                    );
                  }}
                  placeholder="Pick an item…"
                />
                <RemoveButton
                  label={`Remove item ${String(i + 1)}`}
                  onClick={() => {
                    setMyExplicit(myExplicit.filter((_, k) => k !== i));
                  }}
                />
              </div>
            ))}
            <AddButton
              label="Add item"
              onClick={() => {
                setMyExplicit([...myExplicit, { slot, itemId: 0 }]);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline numeric cell. Keeps the value an integer and never yields `NaN`: an
 * emptied input reads as 0 rather than widening the field's type (rule 12).
 */
function NumCell({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
}): React.JSX.Element {
  return (
    <Input
      type="number"
      step={1}
      min={0}
      max={max}
      aria-label={label}
      value={value}
      onChange={(ev) => {
        const n = Number.parseInt(ev.currentTarget.value, 10);
        onChange(Number.isNaN(n) ? 0 : n);
      }}
      className="h-9 text-xs"
    />
  );
}

/** One dashed block that is both the empty state and the add affordance (rule 12). */
function EmptyRow({ label, onAdd }: { label: string; onAdd: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="cursor-pointer gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        Add
      </Button>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="cursor-pointer gap-1.5 text-xs"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
      className="h-9 w-9 cursor-pointer text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
