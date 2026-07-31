/**
 * Row builders for the `/resources/*` browser pages.
 *
 * Each page used to parse its own YAML inline: `String(v.name ?? "?")`,
 * `Number(v.id ?? 0)`, a gold range flattened to the string `"6–9"` and then
 * sorted by splitting that string back apart. That produced three problems this
 * module exists to fix:
 *
 * 1. **Unresolved tokens leaked to the screen.** `nameId` on a set item is an
 *    `IDS_PROPITEMETC_INC_*` token, not text — the C++ resolves it through
 *    `raw/propItemEtc.txt.txt` at load and so must the panel, or a GM reads
 *    `IDS_PROPITEMETC_INC_000001` where the client says "Leaf Set". Same for a
 *    drop table keyed by `MI_AIBATT1` and a dialogue file keyed `dudk_drian`.
 * 2. **Numbers were stringified before they were sorted.** Sorting a `"6–9"`
 *    column meant re-parsing the display string; keeping `goldMin`/`goldMax`
 *    numeric lets the sort compare numbers and the cell do the formatting.
 * 3. **`?` and `0` stood in for "absent".** A missing name is not the name "?".
 *    Rows carry `""`/`0` and the cell components render an explicit dash.
 *
 * All reads come from the process-wide cache in `lib/resource-cache.ts`, so
 * this is per-request work over already-parsed objects, not re-parsing YAML.
 *
 * @module lib/resource-rows
 */

import { npcNameForKey } from "@flyff/resources";
import { loadItems, loadMovers, loadSkills, loadDrops, loadZones, loadSetItems, loadDialogues } from "./resources";
import { getResourceIndex, getTextTable } from "./resource-cache";
import { getIk2Label, getIk3Label } from "./game-constants";
import { worldName } from "./utils";

/** Narrow a YAML doc's collection key to an array of entry records. */
function entriesOf(doc: unknown, key: string): Record<string, unknown>[] {
  if (typeof doc !== "object" || doc === null) return [];
  const list = (doc as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// --- Items --------------------------------------------------------------------

export interface ItemRow {
  id: number;
  name: string;
  /** Raw `IK2_*` symbol, for the kind filter. */
  kind2Sym: string;
  kind2: string;
  /** Raw `IK3_*` symbol, for the subtype filter. */
  kind3Sym: string;
  kind3: string;
  /** Source file's `_kind` marker (weapon, armor, consumable, …). */
  group: string;
  price: number;
  weight: number;
  stackSize: number;
}

export function itemRows(): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const doc of loadItems()) {
    const group = str(doc._kind);
    for (const v of entriesOf(doc, "items")) {
      const kind2Sym = str(v.item_kind2);
      const kind3Sym = str(v.item_kind3);
      rows.push({
        id: num(v.id),
        name: str(v.name),
        kind2Sym,
        kind2: kind2Sym ? getIk2Label(kind2Sym) : "",
        kind3Sym,
        kind3: kind3Sym ? getIk3Label(kind3Sym) : "",
        group,
        price: num(v.price),
        weight: num(v.weight),
        stackSize: num(v.stack_size),
      });
    }
  }
  return rows.sort((a, b) => a.id - b.id);
}

/**
 * Numeric item id → display name.
 *
 * Set pieces, drop entries and quest rewards all reference items by bare id;
 * a table showing `4587` where the client says "Leaf Hat" is unreadable.
 */
export function itemNamesById(): Map<number, string> {
  const out = new Map<number, string>();
  for (const doc of loadItems()) {
    for (const v of entriesOf(doc, "items")) out.set(num(v.id), str(v.name));
  }
  return out;
}

// --- Movers -------------------------------------------------------------------

/**
 * `dwBelligerence` → the C++ symbol and a readable label.
 *
 * This is the field that decides whether a monster aggros on sight, so it is the
 * most operationally interesting column on the mover table — and as a bare
 * integer it is unreadable. The labels stay close to the `defineAttribute.h`
 * symbol names rather than paraphrasing the behaviour, because the semantics are
 * subtler than the names suggest: only the four `ACTIVEATTACK*` values
 * sight-aggro, while `CAUTIOUSATTACK*` **and** the plain `MELEE/RANGE` values
 * (11-13) counterattack through the damage path only — never via `ScanTarget`
 * (see `ACTIVE_BELLI` in `@flyff/entities/constants/aiConstants.ts`). Inventing
 * a word like "Passive" for 11-13 would assert more than the source does.
 *
 * Source: `raw/defineAttribute.h:248-260`.
 */
export const BELLI_INFO = new Map<number, { symbol: string; label: string }>([
  [1, { symbol: "BELLI_PEACEFUL", label: "Peaceful" }],
  [2, { symbol: "BELLI_CAUTIOUSATTACK", label: "Cautious" }],
  [3, { symbol: "BELLI_ACTIVEATTACK", label: "Active" }],
  [4, { symbol: "BELLI_ALLIANCE", label: "Alliance" }],
  [5, { symbol: "BELLI_ACTIVEATTACK_MELEE2X", label: "Active · melee 2×" }],
  [6, { symbol: "BELLI_ACTIVEATTACK_MELEE", label: "Active · melee" }],
  [7, { symbol: "BELLI_ACTIVEATTACK_RANGE", label: "Active · ranged" }],
  [8, { symbol: "BELLI_CAUTIOUSATTACK_MELEE2X", label: "Cautious · melee 2×" }],
  [9, { symbol: "BELLI_CAUTIOUSATTACK_MELEE", label: "Cautious · melee" }],
  [10, { symbol: "BELLI_CAUTIOUSATTACK_RANGE", label: "Cautious · ranged" }],
  [11, { symbol: "BELLI_MELEE2X", label: "Melee 2×" }],
  [12, { symbol: "BELLI_MELEE", label: "Melee" }],
  [13, { symbol: "BELLI_RANGE", label: "Ranged" }],
]);

/** Belligerence values that make a monster attack on sight (`ACTIVE_BELLI`). */
const AGGRO_BELLI = new Set([3, 5, 6, 7]);

/**
 * `MI_*` key → propMover display name.
 *
 * This is the *model* name, shared by every placement using that model — it is
 * the right label for a monster row and the wrong one for an NPC, whose own name
 * comes from its character.inc block. Callers must know which they want.
 */
export function moverNamesByKey(): Map<string, string> {
  const out = new Map<string, string>();
  for (const doc of loadMovers()) {
    for (const v of entriesOf(doc, "movers")) {
      const key = str(v.key);
      if (key) out.set(key, str(v.name));
    }
  }
  return out;
}

/** Numeric mover id → propMover model name. Same caveat as {@link moverNamesByKey}. */
export function moverNamesById(): Map<number, string> {
  const out = new Map<number, string>();
  for (const doc of loadMovers()) {
    for (const v of entriesOf(doc, "movers")) out.set(num(v.id), str(v.name) || str(v.key));
  }
  return out;
}

export interface MoverRow {
  id: number;
  /** `MI_*` symbol — unique, unlike `id` (defineObj.h reuses 56-59). */
  key: string;
  name: string;
  type: string;
  level: number;
  hp: number;
  exp: number;
  belli: number;
  /** `defineAttribute.h` symbol, `""` when the value is absent/unknown. */
  belliSym: string;
  belliLabel: string;
  aggro: boolean;
  boss: boolean;
}

export function moverRows(): MoverRow[] {  const rows: MoverRow[] = [];
  for (const doc of loadMovers()) {
    for (const v of entriesOf(doc, "movers")) {
      const belli = num(v.belligerence);
      const info = BELLI_INFO.get(belli);
      rows.push({
        id: num(v.id),
        key: str(v.key),
        name: str(v.name),
        type: str(v.type),
        level: num(v.level),
        hp: num(v.hp),
        exp: num(v.exp),
        belli,
        belliSym: info?.symbol ?? "",
        belliLabel: info?.label ?? (belli ? `BELLI ${String(belli)}` : ""),
        aggro: AGGRO_BELLI.has(belli),
        boss: v.boss === true,
      });
    }
  }
  return rows.sort((a, b) => a.id - b.id);
}

// --- Skills -------------------------------------------------------------------

export interface SkillRow {
  id: number;
  name: string;
  /** Source file's `_job` marker (acrobat, knight, …). */
  job: string;
  tier: number;
  reqLevel: number;
  maxLevel: number;
}

export function skillRows(): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const doc of loadSkills()) {
    const job = str(doc._job);
    for (const v of entriesOf(doc, "skills")) {
      const levels = Array.isArray(v.levels) ? v.levels.length : 0;
      rows.push({
        id: num(v.id),
        name: str(v.name),
        job,
        tier: num(v.tier),
        reqLevel: num(v.reqLevel),
        maxLevel: num(v.maxLevel) || levels,
      });
    }
  }
  return rows.sort((a, b) => a.id - b.id);
}

// --- Drops --------------------------------------------------------------------

export interface DropRow {
  /** `MI_*` mover key the table hangs off. */
  key: string;
  /** Resolved mover display name, `""` when the key matches no mover. */
  moverName: string;
  modelIdx: number;
  /** Kept numeric so the column sorts as a number, not as `"6–9"`. */
  goldMin: number;
  goldMax: number;
  maxItem: number;
  count: number;
  itemIds: number[];
  /** Resolved drop names, index-aligned with {@link itemIds}. */
  itemNames: string[];
  /**
   * The table's best drop chance, as a percent.
   *
   * The *maximum*, not a sum or an average: a table's identity to a GM is its
   * headline drop ("what does this mob give you"), and summing 20 slots produces
   * a number above 100 that means nothing.
   */
  bestChance: number;
  /** Per-mover rate multiplier; 1 when the table has none. */
  dropRate: number;
}

export function dropRows(): DropRow[] {
  // Resolve MI_* -> model name so the table reads "Small Aibatt", not just the
  // symbol. Built from the same cached mover docs the movers page uses.
  const byKey = moverNamesByKey();
  const itemNames = itemNamesById();

  const rows: DropRow[] = [];
  for (const doc of loadDrops()) {
    for (const v of entriesOf(doc, "drops")) {
      const gold = typeof v.gold === "object" && v.gold !== null ? (v.gold as Record<string, unknown>) : {};
      const items = entriesOf(v, "items");
      const key = str(v.key);
      const itemIds = items.map((i) => num(i.itemId));
      rows.push({
        key,
        moverName: byKey.get(key) ?? "",
        modelIdx: num(v.modelIdx),
        goldMin: num(gold.min),
        goldMax: num(gold.max),
        maxItem: num(v.maxItem),
        count: items.length,
        itemIds,
        itemNames: itemIds.map((id) => itemNames.get(id) ?? ""),
        bestChance: items.reduce((best, i) => Math.max(best, num(i.chance)), 0),
        dropRate: num(v.dropRate) || 1,
      });
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

// --- Set items ----------------------------------------------------------------

export interface SetItemRow {
  id: number;
  /** Resolved set name from `raw/propItemEtc.txt.txt`. */
  name: string;
  /** The `IDS_PROPITEMETC_INC_*` token the name came from. */
  nameId: string;
  pieces: number;
  bonuses: number;
  itemIds: number[];
  /** Resolved piece names, index-aligned with {@link itemIds}. */
  itemNames: string[];
}

export function setItemRows(): SetItemRow[] {
  const text = getTextTable("propItemEtc.txt.txt");
  const names = itemNamesById();
  const rows: SetItemRow[] = [];
  for (const doc of loadSetItems()) {
    for (const v of entriesOf(doc, "sets")) {
      const nameId = str(v.nameId);
      const elems = entriesOf(v, "elems");
      const itemIds = elems.map((e) => num(e.itemId));
      rows.push({
        id: num(v.id),
        name: text.get(nameId) ?? "",
        nameId,
        pieces: elems.length,
        bonuses: Array.isArray(v.avails) ? v.avails.length : 0,
        itemIds,
        itemNames: itemIds.map((id) => names.get(id) ?? ""),
      });
    }
  }
  return rows.sort((a, b) => a.id - b.id);
}

// --- Zones --------------------------------------------------------------------

export interface ZoneRow {
  id: number;
  /** Slug key (`flaris`) — the zone's identity on disk. */
  slug: string;
  name: string;
  worldId: string;
  world: string;
  spawns: number;
  npcs: number;
}

export function zoneRows(): ZoneRow[] {
  const rows: ZoneRow[] = [];
  loadZones().forEach((doc, i) => {
    if (typeof doc !== "object") return;
    const worldId = str(doc.world_id) || str(doc.worldId);
    rows.push({
      id: num(doc._id_numeric) || num(doc.id) || i,
      slug: str(doc._id),
      name: str(doc.name) || str(doc._id),
      worldId,
      world: worldId ? worldName(worldId) : "",
      spawns: Array.isArray(doc.spawns) ? doc.spawns.length : 0,
      npcs: Array.isArray(doc.npcs) ? doc.npcs.length : 0,
    });
  });
  return rows.sort((a, b) => a.id - b.id);
}

// --- Dialogues ----------------------------------------------------------------

export interface DialogueRow {
  /** Stable row key — `prefix` alone can repeat across files. */
  ref: string;
  /** Dialogue file stem (`dudk_drian`) — the C++ `szDialog`. */
  prefix: string;
  /** Resolved NPC display name, `""` when the prefix matches no block. */
  npcName: string;
  states: number;
  /** States the server cannot act on — see {@link dialogueRows}. */
  inert: number;
}

/**
 * State keys the dialogue runtime can act on.
 *
 * A state carrying none of these is inert: the converter emitted the state but
 * no behaviour for it, either because the C++ body only exists as unported
 * `source` text or because nothing was extracted at all. 1 588 of the 4 253
 * shipped states are in that condition, so the count is the porting backlog per
 * NPC — the figure a porter sorts by to find the emptiest files.
 */
const BEHAVIOUR_KEYS = ["say", "speak", "keys", "exit", "launch_quest"] as const;

/**
 * Dialogue rows with the NPC name resolved.
 *
 * A dialogue file is keyed by the lowercased character.inc block stem, so the
 * name follows the same C++ chain the quests page uses: stem → block →
 * `SetName(IDS_*)` → `character.txt.txt`. Unresolved stays `""` rather than
 * guessing a propMover model name, which is wrong for NPCs.
 */
export async function dialogueRows(): Promise<DialogueRow[]> {
  const { characterInc } = await getResourceIndex();
  const rows: DialogueRow[] = [];
  loadDialogues().forEach((doc, i) => {
    const prefix = str(doc.prefix);
    // Index/string-table files (`_strings.yml`, `_npc-map.yml`) carry no prefix.
    if (!prefix) return;
    const states = typeof doc.states === "object" && doc.states !== null ? Object.values(doc.states) : [];
    rows.push({
      ref: `${prefix}__${String(i)}`,
      prefix,
      npcName: npcNameForKey(characterInc, prefix) ?? "",
      states: states.length,
      inert: states.filter(
        (s) =>
          typeof s !== "object" ||
          s === null ||
          !BEHAVIOUR_KEYS.some((k) => k in (s as Record<string, unknown>)),
      ).length,
    });
  });
  return rows.sort((a, b) => a.prefix.localeCompare(b.prefix));
}
