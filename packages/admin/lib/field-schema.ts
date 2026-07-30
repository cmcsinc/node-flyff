/**
 * Form field schema for the resource editors.
 *
 * One entry per known YAML key: the human label, the game-meaning hint, the
 * section it belongs to, and — critically — how its value must be *typed*. The
 * editor derives its controls from this table instead of from
 * `typeof value`, so an integer stays an integer, a float keeps its precision,
 * and an enum renders as a name + raw value rather than a bare number.
 *
 * See `.claude/rules/12-admin-form-ux.md`. No JSON escape hatches.
 *
 * @module lib/field-schema
 */

import { DST_NAMES, IK2_LABELS, IK3_LABELS } from "./game-constants";
import { JOB_NAMES } from "./utils";

/** A pickable value: the raw wire value plus the name a GM recognises. */
export interface EnumOption {
  value: string;
  label: string;
}

/** How a leaf value must be edited and serialized. */
export type FieldKind =
  | "int"
  | "float"
  | "bool"
  | "text"
  | "prose"
  | "enum"
  | "vector3"
  | "range"
  | "object"
  | "list"
  | "table"
  | "readonly";

export interface FieldMeta {
  label: string;
  /** Explains the *game* meaning, not the type. */
  hint?: string;
  group: string;
  /** Overrides the shape inferred from the value. */
  kind?: FieldKind;
  /**
   * Enum registry key — renders a searchable select of name + raw value.
   *
   * Resolved against the static `REGISTRY_BUILDERS` below, or against the
   * runtime options injected by `FieldOptionsProvider` (lists that live behind
   * the server-only resource index, e.g. character.inc keys).
   */
  options?: string;
  /**
   * Column template for a `table` field, used when the array is empty and there
   * is no row to copy a shape from. Without it "Add row" would have to invent a
   * shapeless row, which renders as a row with zero editable cells.
   */
  columns?: Record<string, FieldKind>;
  min?: number;
  max?: number;
}

// ── Enum registries ────────────────────────────────────────────────────────

function fromNumericNames(names: Record<number, string>): EnumOption[] {
  return Object.entries(names)
    .map(([id, name]) => ({ value: id, label: `${name} (${id})` }))
    .sort((a, b) => Number(a.value) - Number(b.value));
}

function fromSymbolLabels(labels: Record<string, string>): EnumOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** PARTS body slots (`dwParts`), from `game/resource/defineNeuz.h`. */
const PARTS_NAMES: Record<number, string> = {
  0: "Head", 1: "Hair", 2: "Upper Body", 3: "Lower Body", 4: "Hand", 5: "Foot",
  6: "Helmet", 7: "Robe", 8: "Cloak", 9: "Left Weapon", 10: "Right Weapon",
  11: "Shield", 12: "Mask", 13: "Ride", 14: "Costume Cap", 15: "Costume Upper",
  16: "Costume Lower", 17: "Costume Hand", 18: "Costume Foot", 19: "Necklace",
  20: "Ring 1", 21: "Ring 2", 22: "Earring 1", 23: "Earring 2", 24: "Property",
  25: "Bullet", 26: "Fashion Hat", 27: "Fashion Cloth", 28: "Fashion Glove",
  29: "Fashion Boots", 30: "Tail",
};

const ELEMENT_NAMES: Record<number, string> = {
  0: "None", 1: "Fire", 2: "Water", 3: "Electric", 4: "Wind", 5: "Earth",
};

/** Job slugs as they appear in `job_req:` sequences. */
const JOB_SLUGS = [
  "vagrant", "mercenary", "acrobat", "assist", "magician", "knight", "blade",
  "jester", "ranger", "ringmaster", "billposter", "psykeeper", "elementor",
  "lord", "templar", "slayer", "stormblade",
];

/** `NpcFunctionSchema.type` — must stay in sync with the Zod enum. */
const NPC_FUNCTION_TYPES = [
  "shop", "dialogue", "teleport", "bank", "guild", "warehouse", "collect",
];

/** `RegionTypeEnum` from `zone.schema.ts`. */
const REGION_TYPES = [
  "safe", "pvp", "pvp_party", "pvp_guild", "dungeon", "guild_war", "boss",
];

const WEATHER_TYPES = ["sunny", "rain", "snow", "fog", "thunder"];

function plain(values: readonly string[]): EnumOption[] {
  return values.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
}

/** Built once on first use — the DST table alone is ~180 entries. */
const REGISTRY_BUILDERS: Record<string, () => EnumOption[]> = {
  dst: () => fromNumericNames(DST_NAMES),
  parts: () => fromNumericNames(PARTS_NAMES),
  job: () => fromNumericNames(JOB_NAMES),
  jobSlug: () => plain(JOB_SLUGS),
  element: () => fromNumericNames(ELEMENT_NAMES),
  ik2: () => fromSymbolLabels(IK2_LABELS),
  ik3: () => fromSymbolLabels(IK3_LABELS),
  npcFunction: () => plain(NPC_FUNCTION_TYPES),
  regionType: () => plain(REGION_TYPES),
  weather: () => plain(WEATHER_TYPES),
  moverType: () => plain(["monster", "npc", "pet", "guard", "summon"]),
};

const registryCache = new Map<string, EnumOption[]>();

/** Options for a registry key, or `null` when the key is unknown. */
export function getOptions(name: string | undefined): EnumOption[] | null {
  if (!name) return null;
  const hit = registryCache.get(name);
  if (hit) return hit;
  const build = REGISTRY_BUILDERS[name];
  if (!build) return null;
  const built = build();
  registryCache.set(name, built);
  return built;
}

/** Resolve one raw enum value to its display name (falls back to the raw value). */
export function optionLabel(name: string | undefined, value: unknown): string {
  const opts = getOptions(name);
  const raw = String(value ?? "");
  return opts?.find((o) => o.value === raw)?.label ?? raw;
}

// ── Section order ──────────────────────────────────────────────────────────

export const GROUP_ORDER = [
  "Identity", "Classification", "Placement", "Stats", "Combat", "Economy",
  "Flags", "Requirements", "Level Data", "Quest Logic", "Set Data", "Loot",
  "World", "Script", "Other",
];

/**
 * Keys the editor never renders.
 *
 * `_version` is schema bookkeeping. `functions` is schema-*required* by
 * `NpcSchema` but runtime-dead — nothing reads it, every entry on disk is `[]`,
 * and the extractor hardcodes `[]`. Real NPC capability comes from the
 * `character.inc` block's `AddMenu`/MMI_* ids. It stays in the form state so the
 * value round-trips into the saved payload untouched; it is only not rendered.
 */
export const SKIP_KEYS = new Set(["_version", "functions"]);

// ── Field table ────────────────────────────────────────────────────────────

export const FIELD_META: Record<string, FieldMeta> = {
  // Identity
  id:            { label: "ID", group: "Identity", kind: "int", min: 0 },
  name:          { label: "Name", group: "Identity" },
  name_id:       { label: "Name String ID", hint: "IDS_* key in the client string table", group: "Identity" },
  nameId:        { label: "Name String ID", group: "Identity" },
  key:           { label: "Internal Key", hint: "MI_*/II_* define symbol", group: "Identity" },
  prefix:        { label: "Dialogue Prefix", group: "Identity" },
  symbol:        { label: "Quest Symbol", group: "Identity" },
  dwObjIndex:    { label: "Object Index", hint: "MI_* index the client resolves the model from", group: "Identity", kind: "int", min: 0 },
  modelIdx:      { label: "Model Index", group: "Identity", kind: "int", min: 0 },
  icon:          { label: "Icon File", hint: ".dds name under the client's icon pack", group: "Identity" },
  description:   { label: "Description", group: "Identity", kind: "prose" },
  _id:           { label: "Zone Key", group: "Identity" },
  _id_numeric:   { label: "Numeric Zone ID", hint: "Sent on the wire", group: "Identity", kind: "int", min: 1 },
  world_id:      { label: "World", group: "Identity" },
  // `mover_id`/`character_key` pick from lists that only exist behind the
  // server-only resource index, so they are injected per page via
  // `FieldOptionsProvider`. With no injected list both degrade to a plain
  // input — which is what the zone editor wants, where a `spawns:` row's
  // `mover_id` is a *monster* id and the NPC list would be wrong.
  mover_id:      { label: "Mover", hint: "propMover NPC entry this placement renders as", group: "Identity", kind: "int", min: 1, options: "npcMover" },
  character_key: { label: "Character Key", hint: "character.inc block — drives the NPC's name, shop stock, dialog, and outfit", group: "Identity", options: "characterKey" },

  // Classification
  _kind:        { label: "Category", group: "Classification" },
  type:         { label: "Type", group: "Classification" },
  item_kind2:   { label: "Item Type", group: "Classification", kind: "enum", options: "ik2" },
  item_kind3:   { label: "Item Sub-Type", group: "Classification", kind: "enum", options: "ik3" },
  equip_slot:   { label: "Equip Slot", group: "Classification", kind: "enum", options: "parts" },
  parts:        { label: "Equip Slot", group: "Classification", kind: "enum", options: "parts" },
  job:          { label: "Job/Class", group: "Classification", kind: "enum", options: "job" },
  discipline:   { label: "Discipline", group: "Classification", kind: "int" },
  tier:         { label: "Skill Tier", group: "Classification", kind: "int" },
  handed:       { label: "Handed", hint: "1 = one-hand, 2 = two-hand, 3 = either", group: "Classification", kind: "int" },
  weaponType:   { label: "Weapon Type", group: "Classification", kind: "int" },
  scale:        { label: "Scale", group: "Classification", kind: "float" },
  element:      { label: "Element", group: "Classification", kind: "enum", options: "element" },

  // Stats
  level:        { label: "Level", group: "Stats", kind: "int", min: 0 },
  hp:           { label: "HP", group: "Stats", kind: "int", min: 0 },
  mp:           { label: "MP", group: "Stats", kind: "int", min: 0 },
  fp:           { label: "FP", hint: "Focus Points", group: "Stats", kind: "int", min: 0 },
  durability:   { label: "Durability", group: "Stats", kind: "int", min: 0 },
  weight:       { label: "Weight", group: "Stats", kind: "int", min: 0 },
  stack_size:   { label: "Stack Size", group: "Stats", kind: "int", min: 1 },
  maxLevel:     { label: "Max Skill Level", group: "Stats", kind: "int", min: 1 },
  effects:      { label: "Effects", hint: "Stat bonuses granted while equipped", group: "Stats", kind: "table", columns: { dst: "enum", adj: "int", chg: "int" } },
  dst:          { label: "Stat", group: "Stats", kind: "enum", options: "dst" },
  adj:          { label: "Value", group: "Stats", kind: "int" },
  chg:          { label: "Secondary", group: "Stats", kind: "int" },
  equipped:      { label: "Pieces Worn", hint: "Bonus applies at this many set pieces", group: "Stats", kind: "int", min: 1 },

  // Combat
  attack:       { label: "Attack", group: "Combat", kind: "int", min: 0 },
  attack_min:   { label: "Attack Min", group: "Combat", kind: "int", min: 0 },
  attack_max:   { label: "Attack Max", group: "Combat", kind: "int", min: 0 },
  defense:      { label: "Defense", group: "Combat", kind: "int", min: 0 },
  defense_max:  { label: "Defense Max", group: "Combat", kind: "int", min: 0 },
  attack_rate:  { label: "Hit Rate", group: "Combat", kind: "int", min: 0 },
  dodge_rate:   { label: "Dodge Rate", group: "Combat", kind: "int", min: 0 },
  attack_speed: { label: "Attack Speed", hint: "Milliseconds per swing", group: "Combat", kind: "int", min: 0 },
  speed:        { label: "Move Speed", group: "Combat", kind: "float" },
  attackRange:  { label: "Attack Range", group: "Combat", kind: "float", min: 0 },
  belligerence: { label: "Belligerence", hint: "BELLI_* — 3/5/6/7 aggro on sight", group: "Combat", kind: "int", min: 0 },

  // Economy
  price:        { label: "Buy Price", hint: "Penya", group: "Economy", kind: "int", min: 0 },
  sell_price:   { label: "Sell Price", hint: "Penya", group: "Economy", kind: "int", min: 0 },
  exp:          { label: "EXP Reward", group: "Economy", kind: "int", min: 0 },

  // Flags
  tradeable:    { label: "Tradeable", group: "Flags", kind: "bool" },
  dropable:     { label: "Droppable", group: "Flags", kind: "bool" },
  destroyable:  { label: "Destroyable", group: "Flags", kind: "bool" },
  flyable:      { label: "Flyable", group: "Flags", kind: "bool" },
  boss:         { label: "Boss", group: "Flags", kind: "bool" },
  giant:        { label: "Giant", group: "Flags", kind: "bool" },
  raid:         { label: "Raid Boss", group: "Flags", kind: "bool" },
  attackable:   { label: "Attackable", group: "Flags", kind: "bool" },
  guard:        { label: "Guard", group: "Flags", kind: "bool" },

  // Requirements
  job_req:      { label: "Job Requirements", group: "Requirements", kind: "list", options: "jobSlug" },
  reqLevel:     { label: "Required Level", group: "Requirements", kind: "int", min: 1 },
  prereqs:      { label: "Skill Prerequisites", group: "Requirements", kind: "table", columns: { skillId: "int", level: "int" } },

  // Skill level data
  levels:       { label: "Level Progression", group: "Level Data", kind: "table" },
  referStats:   { label: "Refer Stats", group: "Level Data", kind: "list" },
  referTargets: { label: "Refer Targets", group: "Level Data", kind: "list" },
  referValues:  { label: "Refer Values", group: "Level Data", kind: "list" },
  destParams:   { label: "Dest Params", group: "Level Data", kind: "list", options: "dst" },
  adjParamVals: { label: "Adjust Values", group: "Level Data", kind: "list" },
  subDefine:    { label: "Sub Define", group: "Level Data", kind: "int" },
  exeTarget:    { label: "Execute Target", group: "Level Data", kind: "int" },
  useChance:    { label: "Use Chance", group: "Level Data", kind: "int" },
  spellRegion:  { label: "Spell Region", group: "Level Data", kind: "int" },
  resourceType: { label: "Resource Type", group: "Level Data", kind: "int" },
  cooldownType: { label: "Cooldown Type", group: "Level Data", kind: "int" },
  reqFp:        { label: "FP Cost", group: "Level Data", kind: "int", min: 0 },
  reqMp:        { label: "MP Cost", group: "Level Data", kind: "int", min: 0 },
  skillTime:    { label: "Duration (ms)", group: "Level Data", kind: "int", min: 0 },
  cooldown:     { label: "Cooldown (ms)", group: "Level Data", kind: "int", min: 0 },

  // Quest logic
  title:        { label: "Quest Title", group: "Quest Logic" },
  commands:     { label: "Quest Commands", group: "Quest Logic", kind: "table" },
  states:       { label: "Dialogue States", group: "Quest Logic", kind: "object" },
  quest_items:  { label: "Quest Items", group: "Quest Logic", kind: "table", columns: { itemId: "int", count: "int" } },
  keys:         { label: "Dialogue Keys", group: "Quest Logic", kind: "table" },
  speak:        { label: "Speak Lines", group: "Quest Logic", kind: "list" },
  launch_quest: { label: "Launches Quest", group: "Quest Logic", kind: "bool" },
  args:         { label: "Arguments", group: "Quest Logic", kind: "table" },
  cmd:          { label: "Command", group: "Quest Logic" },

  // Set data
  elems:        { label: "Set Pieces", group: "Set Data", kind: "table", columns: { itemId: "int" } },
  avails:       { label: "Set Bonuses", group: "Set Data", kind: "table", columns: { equipped: "int", dst: "enum", adj: "int", chg: "int" } },

  // Loot
  gold:         { label: "Penya Drop", group: "Loot", kind: "range" },
  items:        { label: "Item Drops", group: "Loot", kind: "table", columns: { itemId: "int", prob: "int", count: "int" } },
  maxItem:      { label: "Max Item Drops", group: "Loot", kind: "int", min: 0 },
  itemId:       { label: "Item", group: "Loot", kind: "int", min: 1 },
  prob:         { label: "Probability", hint: "Out of the table's _prob_scale", group: "Loot", kind: "int", min: 0 },
  count:        { label: "Count", group: "Loot", kind: "int", min: 1 },

  // World / placement
  bounds:       { label: "Bounds", group: "World", kind: "object" },
  revival:      { label: "Revival Point", group: "World", kind: "object" },
  portals:      { label: "Portals", group: "World", kind: "table", columns: { target: "object", position: "vector3" } },
  spawns:       { label: "Monster Spawns", group: "World", kind: "table", columns: { mover_id: "int", position: "vector3", angle: "float", radius: "float" } },
  npcs:         { label: "NPC Placements", group: "World", kind: "table", columns: { mover_id: "int", character_key: "text", position: "vector3", angle: "float" } },
  regions:      { label: "Regions", group: "World", kind: "table" },
  weather:      { label: "Weather", group: "World", kind: "object" },
  min:          { label: "Min", group: "World", kind: "vector3" },
  max:          { label: "Max", group: "World", kind: "vector3" },
  position:     { label: "Position", group: "Placement", kind: "vector3" },
  angle:        { label: "Facing Angle", hint: "Radians, 0 – 6.28", group: "Placement", kind: "float", min: 0, max: 6.283185307179586 },
  radius:       { label: "Radius", group: "Placement", kind: "float", min: 0 },
  delay:        { label: "Respawn Delay (ms)", group: "Placement", kind: "int", min: 0 },
  functions:    { label: "NPC Functions", hint: "Unused — no runtime code reads it; NPC capability comes from the character.inc AddMenu/MMI_* ids. Kept only because NpcSchema requires the key, and not rendered (see SKIP_KEYS).", group: "Placement", kind: "table", options: "npcFunction" },
  target:       { label: "Destination", group: "Placement", kind: "object" },
  zone:         { label: "Zone Key", group: "Placement" },

  // Script (generated — never hand-edit through the form)
  source:       { label: "Original Script", hint: "Decompiled from the client script — read-only", group: "Script", kind: "readonly" },
};

/** Metadata for a key, with a humanised fallback for unknown keys. */
export function getMeta(key: string): FieldMeta {
  return (
    FIELD_META[key] ?? {
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      group: "Other",
    }
  );
}

/**
 * The control to render for `key`. The table wins; otherwise the shape is
 * inferred from the current value so unknown keys still get a real control
 * (never a JSON textarea).
 */
export function resolveKind(key: string, value: unknown): FieldKind {
  const declared = getMeta(key).kind;
  if (declared) return declared;

  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (Array.isArray(value)) {
    const first = value.find((v) => v !== null && v !== undefined);
    return typeof first === "object" ? "table" : "list";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length === 3 && keys.every((k) => "xyz".includes(k))) return "vector3";
    if (keys.length === 2 && keys.every((k) => k === "min" || k === "max")) return "range";
    return "object";
  }
  return "text";
}

/**
 * Coerce an input's string back to the field's declared type.
 * An empty numeric input yields `null` (caller decides: drop the key or keep the
 * old value) rather than silently becoming `0`.
 */
export function coerce(kind: FieldKind, raw: string): number | string | null {
  if (kind === "int") {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (kind === "float") {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

/** `step` for a numeric input — integers snap to 1, floats stay free. */
export function stepFor(kind: FieldKind): string {
  return kind === "int" ? "1" : "any";
}
