"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { stringify as stringifyYaml } from "yaml";
import { ChevronDown, ChevronRight, Plus, X, Save, ArrowLeft, RotateCcw } from "lucide-react";
import { DST_NAMES, IK2_LABELS, IK3_LABELS } from "@/lib/game-constants";

// ── Field metadata ─────────────────────────────────────────────────────────

interface FieldMeta {
  label: string;
  desc?: string;
  group: string;
}

const FIELD_LABELS: Record<string, FieldMeta> = {
  // Identity
  id:          { label: "ID",              group: "Identity" },
  name:        { label: "Name",            group: "Identity" },
  name_id:     { label: "Name String ID",  group: "Identity" },
  key:         { label: "Internal Key",    group: "Identity" },
  prefix:      { label: "NPC Prefix",      group: "Identity" },
  symbol:      { label: "Quest Symbol",    group: "Identity" },
  dwObjIndex:  { label: "Object Index",    group: "Identity" },

  // Classification
  _kind:       { label: "Category",        group: "Classification" },
  type:        { label: "Type",            group: "Classification" },
  item_kind2:  { label: "Item Type",       group: "Classification" },
  item_kind3:  { label: "Item Sub-Type",   group: "Classification" },
  equip_slot:  { label: "Equip Slot",      group: "Classification" },
  job:         { label: "Job/Class",       group: "Classification" },
  discipline:  { label: "Discipline",      group: "Classification" },
  tier:        { label: "Skill Tier",      group: "Classification" },
  handed:      { label: "Handed",          desc: "1=one-hand, 2=two-hand", group: "Classification" },
  weaponType:  { label: "Weapon Type",     group: "Classification" },
  scale:       { label: "Scale",           group: "Classification" },

  // Stats
  level:       { label: "Level",           group: "Stats" },
  hp:          { label: "HP",              group: "Stats" },
  mp:          { label: "MP",              group: "Stats" },
  fp:          { label: "FP",              desc: "Focus Points", group: "Stats" },
  attack:      { label: "Attack",          group: "Stats" },
  attack_min:  { label: "Attack Min",      group: "Stats" },
  attack_max:  { label: "Attack Max",      group: "Stats" },
  defense:     { label: "Defense",         group: "Stats" },
  attack_rate: { label: "Attack Rate",     group: "Stats" },
  dodge_rate:  { label: "Dodge Rate",      group: "Stats" },
  attack_speed:{ label: "Attack Speed",    group: "Stats" },
  speed:       { label: "Move Speed",      group: "Stats" },
  durability:  { label: "Durability",      group: "Stats" },
  weight:      { label: "Weight",          group: "Stats" },
  stack_size:  { label: "Stack Size",      group: "Stats" },
  maxLevel:    { label: "Max Skill Level", group: "Stats" },
  reqLevel:    { label: "Required Level",  group: "Stats" },
  attackRange: { label: "Attack Range",    group: "Stats" },

  // Economy
  price:       { label: "Buy Price",       desc: "Penya", group: "Economy" },
  sell_price:  { label: "Sell Price",       desc: "Penya", group: "Economy" },
  exp:         { label: "EXP Reward",       group: "Economy" },

  // Flags
  tradeable:   { label: "Tradeable",       group: "Flags" },
  dropable:    { label: "Droppable",        group: "Flags" },
  destroyable: { label: "Destroyable",     group: "Flags" },
  flyable:     { label: "Flyable",         group: "Flags" },
  boss:        { label: "Boss",            group: "Flags" },
  giant:       { label: "Giant",           group: "Flags" },
  raid:        { label: "Raid Boss",       group: "Flags" },
  attackable:  { label: "Attackable",      group: "Flags" },

  // Requirements
  job_req:     { label: "Job Requirements", group: "Requirements" },
  prereqs:     { label: "Skill Prerequisites", group: "Requirements" },

  // Skill level data
  levels:      { label: "Level Progression", group: "Level Data" },
  referStats:  { label: "Refer Stats",     group: "Level Data" },
  referTargets:{ label: "Refer Targets",   group: "Level Data" },
  referValues: { label: "Refer Values",    group: "Level Data" },
  subDefine:   { label: "Sub Define",      group: "Level Data" },
  exeTarget:   { label: "Execute Target",  group: "Level Data" },
  useChance:   { label: "Use Chance",      group: "Level Data" },
  spellRegion: { label: "Spell Region",    group: "Level Data" },
  resourceType:{ label: "Resource Type",   group: "Level Data" },

  // Effects / DST
  effects:     { label: "Effects",          desc: "Stat bonuses from this item", group: "Stats" },
  dst:         { label: "Stat",            group: "Stats" },
  adj:         { label: "Value",           group: "Stats" },
  chg:         { label: "Secondary",       group: "Stats" },

  // Quest data
  commands:    { label: "Quest Commands",   group: "Quest Logic" },
  states:      { label: "States",           group: "Quest Logic" },
  quest_items: { label: "Quest Items",      group: "Quest Logic" },
  _id_numeric: { label: "Numeric Zone ID",  group: "Identity" },
  world_id:    { label: "World",            group: "Identity" },
  nameId:      { label: "Name String ID",   group: "Identity" },
  elems:       { label: "Set Pieces",       group: "Set Data" },
  avails:      { label: "Set Bonuses",      group: "Set Data" },
  gold:        { label: "Gold Drop",        group: "Loot" },
  items:       { label: "Item Drops",       group: "Loot" },
  maxItem:     { label: "Max Item Drops",   group: "Loot" },
  modelIdx:    { label: "Model Index",      group: "Identity" },
  bounds:      { label: "World Bounds",     group: "World" },
  revival:     { label: "Revival Point",    group: "World" },
  portals:     { label: "Portals",          group: "World" },
  description: { label: "Description",      group: "World" },
};

const GROUP_ORDER = [
  "Identity", "Classification", "Stats", "Economy", "Flags",
  "Requirements", "Level Data", "Quest Logic", "Set Data", "Loot", "World",
];

function getMeta(key: string): FieldMeta {
  return FIELD_LABELS[key] ?? { label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), group: "Other" };
}

const SKIP_KEYS = new Set(["_version"]);

// ── Searchable Select ──────────────────────────────────────────────────────

function SearchableSelect({ value, options, onChange, placeholder }: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, search]);

  const displayLabel = options.find(o => o.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="w-full h-8 text-xs text-left px-2 border rounded-md bg-background hover:bg-muted/50 flex items-center justify-between gap-1"
      >
        <span className="truncate">{displayLabel || placeholder || "Select..."}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[280px] max-h-[300px] overflow-auto rounded-md border bg-popover shadow-md">
          <div className="sticky top-0 bg-popover p-1 border-b">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-7 text-xs"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered.length === 1) {
                  onChange(filtered[0].value);
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="p-1">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">No matches</p>
            )}
            {filtered.slice(0, 100).map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left text-xs px-2 py-1.5 rounded-sm hover:bg-accent ${o.value === value ? "bg-accent font-medium" : ""}`}
              >
                <span className="text-foreground">{o.label}</span>
                <span className="text-muted-foreground ml-2">({o.value})</span>
              </button>
            ))}
            {filtered.length > 100 && (
              <p className="text-xs text-muted-foreground p-2">+{filtered.length - 100} more…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Effects Table (DST-aware) ──────────────────────────────────────────────

function EffectsTable({ value, onChange }: { value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length === 0) return <p className="text-xs text-muted-foreground italic">No effects</p>;

  const COLUMN_ORDER = ["dst", "adj", "chg"];
  const COLUMN_LABELS: Record<string, string> = { dst: "Stat", adj: "Value", chg: "Secondary" };

  // Detect which columns are present
  const presentCols = useMemo(() => {
    const keys = new Set<string>();
    for (const row of value.slice(0, 20)) {
      for (const k of Object.keys(row)) keys.add(k);
    }
    // Prefer our canonical order, then any extra columns
    const ordered = COLUMN_ORDER.filter(c => keys.has(c));
    for (const k of keys) {
      if (!ordered.includes(k)) ordered.push(k);
    }
    return ordered;
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="h-7 px-2 text-xs">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? "Collapse" : `Show ${value.length} effects`}
        </Button>
        {expanded && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 ml-auto"
            onClick={() => onChange([...value, { dst: 0, adj: 0 }])}
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
        )}
      </div>
      {expanded && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium w-8">#</th>
                {presentCols.map(col => (
                  <th key={col} className="px-2 py-1.5 text-left font-medium">{COLUMN_LABELS[col] ?? getMeta(col).label}</th>
                ))}
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {value.map((row, ri) => (
                <tr key={ri} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1 text-muted-foreground">{ri + 1}</td>
                  {presentCols.map(col => (
                    <td key={col} className="px-2 py-1">
                      {col === "dst" ? (
                        <SearchableSelect
                          value={String(row[col] ?? "")}
                          options={buildDstOptions()}
                          onChange={(v) => {
                            const next = [...value];
                            next[ri] = { ...next[ri], [col]: Number(v) };
                            onChange(next);
                          }}
                          placeholder="Select stat..."
                        />
                      ) : (
                        <input
                          type={typeof row[col] === "number" ? "number" : "text"}
                          value={String(row[col] ?? "")}
                          onChange={(e) => {
                            const next = [...value];
                            const updated = { ...next[ri] };
                            updated[col] = typeof row[col] === "number" ? Number(e.target.value) : e.target.value;
                            next[ri] = updated;
                            onChange(next);
                          }}
                          className="w-full bg-transparent border-0 text-xs p-0 focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                          step="any"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1">
                    <button
                      type="button"
                      onClick={() => onChange(value.filter((_, j) => j !== ri))}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    >
                      <X className="h-3 w-3" />
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

// Lazy-built DST options cache (built from imported DST_NAMES)
let _dstOptions: Array<{ value: string; label: string }> | null = null;
function buildDstOptions(): Array<{ value: string; label: string }> {
  if (_dstOptions) return _dstOptions;
  _dstOptions = Object.entries(DST_NAMES)
    .map(([id, name]) => ({ value: id, label: `${name} (${id})` }))
    .sort((a, b) => Number(a.value) - Number(b.value));
  return _dstOptions;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CollapsibleSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <CardHeader className="py-3 cursor-pointer select-none" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <CardTitle className="text-sm">{title}</CardTitle>
          <Badge variant="secondary" className="ml-auto">{count}</Badge>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

function ArrayOfObjectsTable({ label, value, onChange }: { label: string; value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length === 0) return <p className="text-xs text-muted-foreground italic">Empty</p>;

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of value.slice(0, 20)) {
      for (const k of Object.keys(row)) keys.add(k);
    }
    return [...keys];
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="h-7 px-2 text-xs">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? "Collapse" : `Show ${value.length} entries`}
        </Button>
      </div>
      {expanded && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">#</th>
                {columns.map(col => (
                  <th key={col} className="px-2 py-1.5 text-left font-medium">{getMeta(col).label}</th>
                ))}
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {value.map((row, ri) => (
                <tr key={ri} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1 text-muted-foreground">{ri + 1}</td>
                  {columns.map(col => (
                    <td key={col} className="px-2 py-1">
                      <input
                        type={typeof row[col] === "number" ? "number" : "text"}
                        value={String(row[col] ?? "")}
                        onChange={(e) => {
                          const next = [...value];
                          const updated = { ...next[ri] };
                          updated[col] = typeof row[col] === "number" ? Number(e.target.value) : e.target.value;
                          next[ri] = updated;
                          onChange(next);
                        }}
                        className="w-full bg-transparent border-0 text-xs p-0 focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                        step="any"
                      />
                    </td>
                  ))}
                  <td className="px-1">
                    <button
                      type="button"
                      onClick={() => onChange(value.filter((_, j) => j !== ri))}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    >
                      <X className="h-3 w-3" />
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

function ArrayField({ label, desc, value, onChange, fieldKey }: { label: string; desc?: string; value: unknown[]; onChange: (v: unknown[]) => void; fieldKey: string }) {
  const isObjectArray = value.length > 0 && typeof value[0] === "object" && value[0] !== null;

  // Use the specialized EffectsTable for effects and avails arrays
  if (isObjectArray && (fieldKey === "effects" || fieldKey === "avails")) {
    return (
      <div className="space-y-1 md:col-span-2">
        <Label className="text-xs">{label}</Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        <EffectsTable value={value as Record<string, unknown>[]} onChange={onChange as (v: Record<string, unknown>[]) => void} />
      </div>
    );
  }

  if (isObjectArray) {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{label}</Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        <ArrayOfObjectsTable label={label} value={value as Record<string, unknown>[]} onChange={onChange as (v: Record<string, unknown>[]) => void} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={i} variant="secondary" className="gap-1 text-xs">
            {String(item)}
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="ml-0.5 opacity-60 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          placeholder={`Add...`}
          className="max-w-[140px] h-6 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const val = e.currentTarget.value.trim();
              if (val) {
                const numVal = Number(val);
                onChange([...value, isNaN(numVal) || val === "" ? val : numVal]);
                e.currentTarget.value = "";
              }
            }
          }}
        />
      </div>
    </div>
  );
}

function ObjectField({ label, desc, value, onChange }: { label: string; desc?: string; value: unknown; onChange: (v: unknown) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}</Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="h-5 px-1.5 text-xs ml-auto">
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </div>
      {expanded ? (
        <>
          <textarea
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              try {
                onChange(JSON.parse(next));
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Invalid JSON");
              }
            }}
            className="w-full min-h-[100px] font-mono text-xs p-2 rounded-md border border-input bg-muted/30 resize-y focus-visible:ring-1 focus-visible:ring-ring"
            spellCheck={false}
            aria-invalid={error !== null}
          />
          {error && <p className="text-xs text-destructive">Invalid JSON — fix before saving: {error}</p>}
        </>
      ) : (
        <p className="truncate rounded bg-muted/30 px-2 py-1 font-mono text-xs text-muted-foreground">{preview}</p>
      )}
    </div>
  );
}

// ── Kind select options ────────────────────────────────────────────────────

const IK2_OPTIONS = Object.entries(IK2_LABELS).map(([value, label]) => ({ value, label }));
const IK3_OPTIONS = Object.entries(IK3_LABELS).map(([value, label]) => ({ value, label }));

// ── Main component ─────────────────────────────────────────────────────────

export function ResourceFormEditor({ type, id, entry }: { type: string; id: string; entry: Record<string, unknown> }) {
  const [form, setForm] = useState<Record<string, unknown>>({ ...entry });
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(entry), [form, entry]);

  function setField(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const yaml = stringifyYaml(form, { lineWidth: 120 });
      const res = await fetch(`/api/resources/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, yaml }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Saved");
        router.push(`/resources/${type}`);
        router.refresh();
      } else {
        toast.error(data.error ?? "Save failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  // Group fields by category
  const grouped = useMemo(() => {
    const groups = new Map<string, Array<[string, unknown]>>();
    for (const [key, value] of Object.entries(form)) {
      if (SKIP_KEYS.has(key)) continue;
      const meta = getMeta(key);
      const group = meta.group;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push([key, value]);
    }
    // Sort groups by predefined order
    const sorted: Array<[string, Array<[string, unknown]>]> = [];
    for (const g of GROUP_ORDER) {
      if (groups.has(g)) sorted.push([g, groups.get(g)!]);
    }
    for (const [g, fields] of groups) {
      if (!GROUP_ORDER.includes(g)) sorted.push([g, fields]);
    }
    return sorted;
  }, [form]);

  return (
    <div className="space-y-4">
      {grouped.map(([group, fields]) => (
        <CollapsibleSection key={group} title={group} count={fields.length}>
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map(([key, value]) => {
              const meta = getMeta(key);
              const kind = typeof value === "number" ? "number"
                : typeof value === "boolean" ? "boolean"
                : Array.isArray(value) ? "array"
                : typeof value === "object" && value !== null ? "object"
                : "string";

              // Searchable select for item_kind2
              if (key === "item_kind2" && kind === "string") {
                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{meta.label}</Label>
                    {meta.desc && <p className="text-[11px] text-muted-foreground">{meta.desc}</p>}
                    <SearchableSelect
                      value={String(value ?? "")}
                      options={IK2_OPTIONS}
                      onChange={(v) => setField(key, v)}
                      placeholder="Select item type..."
                    />
                  </div>
                );
              }

              // Searchable select for item_kind3
              if (key === "item_kind3" && kind === "string") {
                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{meta.label}</Label>
                    {meta.desc && <p className="text-[11px] text-muted-foreground">{meta.desc}</p>}
                    <SearchableSelect
                      value={String(value ?? "")}
                      options={IK3_OPTIONS}
                      onChange={(v) => setField(key, v)}
                      placeholder="Select sub-type..."
                    />
                  </div>
                );
              }

              if (kind === "boolean") {
                return (
                  <div key={key} className="flex items-center gap-3">
                    <Switch
                      id={key}
                      checked={!!value}
                      onChange={(e) => setField(key, e.target.checked)}
                    />
                    <div>
                      <Label htmlFor={key} className="text-sm">{meta.label}</Label>
                      {meta.desc && <p className="text-xs text-muted-foreground">{meta.desc}</p>}
                    </div>
                  </div>
                );
              }

              if (kind === "number") {
                return (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={key} className="text-xs">{meta.label}</Label>
                    {meta.desc && <p className="text-[11px] text-muted-foreground">{meta.desc}</p>}
                    <Input
                      id={key}
                      type="number"
                      value={String(value)}
                      onChange={(e) => setField(key, Number(e.target.value))}
                      step="any"
                      className="h-8"
                    />
                  </div>
                );
              }

              if (kind === "array") {
                return (
                  <div key={key} className={Array.isArray(value) && value.length > 0 && typeof value[0] === "object" ? "md:col-span-2" : ""}>
                    <ArrayField
                      label={meta.label}
                      desc={meta.desc}
                      value={Array.isArray(value) ? value : []}
                      onChange={(v) => setField(key, v)}
                      fieldKey={key}
                    />
                  </div>
                );
              }

              if (kind === "object") {
                return (
                  <div key={key} className="md:col-span-2">
                    <ObjectField
                      label={meta.label}
                      desc={meta.desc}
                      value={value}
                      onChange={(v) => setField(key, v)}
                    />
                  </div>
                );
              }

              // string
              return (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key} className="text-xs">{meta.label}</Label>
                  {meta.desc && <p className="text-[11px] text-muted-foreground">{meta.desc}</p>}
                  <Input
                    id={key}
                    type="text"
                    value={String(value ?? "")}
                    onChange={(e) => setField(key, e.target.value)}
                    className="h-8"
                  />
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      ))}

      <Separator />

      <div className="sticky bottom-0 flex items-center gap-2 bg-background/95 py-3 backdrop-blur">
        <Button onClick={handleSave} disabled={saving || !dirty} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : dirty ? "Save Changes" : "No changes"}
        </Button>
        <Button variant="outline" onClick={() => setForm({ ...entry })} disabled={saving || !dirty} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Revert
        </Button>
        <Button variant="ghost" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Cancel
        </Button>
        {dirty && <span className="ml-2 text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}
