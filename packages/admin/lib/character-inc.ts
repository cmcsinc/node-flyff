/**
 * `character.inc` block read/write for the admin panel.
 *
 * An NPC's real capability is NOT the zone YAML's `functions:` field (dead data)
 * — it is `AddMenu( MMI_* )` in the NPC's `character.inc` block, which the C++
 * `Project.cpp:3024` copies into `CMover::m_abMoverMenu`. This module is the
 * panel's server-side view of that block plus the list of placements it affects.
 *
 * Two things make editing here higher-stakes than a zone YAML edit:
 *
 * 1. `raw/character.inc` is read by the **game client** as well as the server,
 *    so a malformed write is player-facing corruption. All writes go through the
 *    tested surgical writer (`@flyff/resources` `writeCharacterEdit`), never a
 *    regenerate-from-parsed-state path.
 * 2. A block is keyed by `character_key`, which several placements share. There
 *    is no per-placement menu override in the C++ model (the placement row
 *    carries only id/mover/key/position/angle), so an edit is block-global.
 *    {@link sharersForKey} exists so the UI can say how many it touches.
 *
 * @module lib/character-inc
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSymbols,
  resolveVendorStock,
  type CharacterIncBlock,
  type ItemIndex,
  type WriterSymbols,
} from "@flyff/resources";
import { IK3_LABELS } from "./game-constants";
import { getResourceIndex } from "./resource-cache";
import { loadNpcs } from "./npcs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The `raw/` directory holding `character.inc` + `character.txt.txt`. */
export const RAW_DIR = resolve(__dirname, "..", "..", "resources", "raw");

/**
 * The only `MMI_*` ids this server actually honors. `defineNeuz.h` declares 278;
 * the other ~274 parse into `m_abMoverMenu` and gate nothing server-side, so the
 * UI must not imply they work.
 *
 * | Menu | Server gate |
 * | --- | --- |
 * | `MMI_DIALOG` (0) | right-click dialog |
 * | `MMI_TRADE` (2) | `packages/npc/src/services/shop.service.ts:69`, `:193` |
 * | `MMI_BANKING` (9) | `packages/npc/src/services/bank.service.ts:253` |
 * | `MMI_NPC_BUFF` (74) | `packages/npc/src/services/npcBuff.service.ts:136` |
 */
export const IMPLEMENTED_MMI: readonly number[] = [0, 2, 9, 74];

/** What each implemented menu actually does, for the UI hint. */
export const MMI_PURPOSE: Readonly<Record<number, string>> = {
  0: "Right-click opens the NPC's dialog script.",
  2: "Right-click opens the shop window, stocked from AddVendorItem.",
  9: "Right-click opens the account bank (needs a bank PIN).",
  74: "Right-click grants the block's SetBuffSkill buffs (Buff Pang).",
};

/** One selectable menu, ready for a switch or an option row. */
export interface MmiOption {
  readonly id: number;
  /** Raw `MMI_*` symbol, e.g. `MMI_TRADE`. */
  readonly symbol: string;
  /** Friendly label with the raw id, e.g. `Trade (2)` — rule 12 requires both. */
  readonly label: string;
  /** `true` only for the four ids with a real server gate. */
  readonly implemented: boolean;
  /** Present only for implemented menus. */
  readonly purpose?: string;
}

/** One placement that shares a `character_key` and is therefore also affected. */
export interface KeySharer {
  readonly ref: string;
  readonly zoneName: string;
  readonly id: number;
}

/**
 * One `AddVendorItem( slot, IK3_*, job, minU, maxU, totalNum )` rule — a
 * *category* rule, not a concrete item. The server expands it at boot against
 * every item carrying that `item_kind3` symbol.
 */
export interface VendorRuleView {
  readonly slot: number;
  /** `IK3_*` symbol verbatim, e.g. `IK3_WAND`. */
  readonly kind3: string;
  /** `Wand (IK3_WAND)` — friendly name plus the raw symbol, per rule 12. */
  readonly label: string;
  /** Sex/job filter; `-1` = any. */
  readonly job: number;
  readonly uniqueMin: number;
  readonly uniqueMax: number;
  /** Cap on how many matching items are placed. */
  readonly totalNum: number;
  /** How many items this rule actually contributes after expansion. */
  readonly resolved: number;
}

/** One `AddVendorItem2( slot, dwId )` entry — a concrete propItem id. */
export interface VendorItemIdView {
  readonly slot: number;
  readonly itemId: number;
  /** Resolved item name, or `undefined` when the id matches no propItem. */
  readonly name: string | undefined;
  /** `.dds` icon filename from propItem, for the row thumbnail. */
  readonly icon: string | undefined;
}

/** One shop tab (`AddVendorSlot`), with everything stocking it. */
export interface VendorTabView {
  readonly slot: number;
  /** Raw `IDS_*` label token — the id stored in the `.inc`. */
  readonly labelToken: string;
  /** Tab caption resolved from `character.txt.txt`; `""` when the row is absent. */
  readonly labelText: string;
  /** Category rules feeding this tab. */
  readonly rules: readonly VendorRuleView[];
  /** Explicit item ids feeding this tab. */
  readonly explicit: readonly VendorItemIdView[];
  /** Total slots filled after expansion — what a player will see. */
  readonly filled: number;
}

/** The panel's whole server-side payload for one block. */
export interface IncBlockView {
  readonly key: string;
  /** `false` when `character.inc` has no block for this key (nothing to edit). */
  readonly exists: boolean;
  /** Resolved display name from `SetName` → `character.txt.txt`. */
  readonly name: string | undefined;
  /** Currently-enabled `MMI_*` ids, ascending. */
  readonly menus: readonly number[];
  /** `m_szDialog` filename, for read-only context. */
  readonly dialogFile: string | undefined;
  /** Shop tab count — a Trade menu with 0 tabs sells nothing. */
  readonly vendorTabCount: number;
  /** Buff-pang skill count — a Buff menu with 0 skills grants nothing. */
  readonly buffSkillCount: number;
  /** Shop tabs with their stock rules, resolved. Empty when not a vendor. */
  readonly tabs: readonly VendorTabView[];
  /** Every placement using this key, including the one being edited. */
  readonly sharers: readonly KeySharer[];
}

// `loadSymbols` reads and inverts three `#define` files; the result is immutable,
// so cache it on `globalThis` to survive Next dev HMR (same reason as
// `resource-cache.ts`).
const g = globalThis as typeof globalThis & { __flyffIncSymbols?: Promise<WriterSymbols> };

/** Inverted `MMI_`/`II_`/`SRT_` symbol maps, loaded once per process. */
export function getIncSymbols(): Promise<WriterSymbols> {
  g.__flyffIncSymbols ??= loadSymbols(RAW_DIR).catch((err: unknown) => {
    g.__flyffIncSymbols = undefined;
    throw err;
  });
  return g.__flyffIncSymbols;
}

/** `MMI_TRADE` → `Trade`. Underscores become spaces, words title-cased. */
function labelForSymbol(symbol: string): string {
  return symbol
    .replace(/^MMI_/, "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Every `MMI_*` id declared by `defineNeuz.h`, implemented ones first then
 * ascending by id. Derived from the define file rather than a hardcoded table so
 * the list can never drift from the client's own enum.
 */
export async function mmiOptions(): Promise<MmiOption[]> {
  const { mmiById } = await getIncSymbols();
  const out: MmiOption[] = [];
  for (const [id, symbol] of mmiById) {
    const implemented = IMPLEMENTED_MMI.includes(id);
    out.push({
      id,
      symbol,
      label: `${labelForSymbol(symbol)} (${String(id)})`,
      implemented,
      ...(implemented ? { purpose: MMI_PURPOSE[id] } : {}),
    });
  }
  out.sort((a, b) => {
    if (a.implemented !== b.implemented) return a.implemented ? -1 : 1;
    return a.id - b.id;
  });
  return out;
}

/** Placements whose `character_key` matches `key` (case-insensitive). */
export function sharersForKey(key: string): KeySharer[] {
  const want = key.toLowerCase();
  return loadNpcs()
    .filter((n) => n.characterKey.toLowerCase() === want)
    .map((n) => ({ ref: n.ref, zoneName: n.zoneName, id: n.id }));
}

/** `IK3_*` → `Wand (IK3_WAND)`. Falls back to the bare symbol when unlabelled. */
function labelForKind3(symbol: string): string {
  const friendly = IK3_LABELS[symbol];
  return friendly ? `${friendly} (${symbol})` : symbol;
}

/** Every `IK3_*` symbol that any loaded item carries, as picker options. */
export async function kind3Options(): Promise<{ value: string; label: string }[]> {
  const idx = await getResourceIndex();
  return [...idx.items.byKind3.keys()]
    .map((symbol) => ({ value: symbol, label: labelForKind3(symbol) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Build the per-tab shop view.
 *
 * A tab's stock is NOT what the file lists — it is what
 * {@link resolveVendorStock} produces from it, because `AddVendorItem` is a
 * *category* rule expanded against every matching item and capped by
 * `totalNum`. A rule naming a kind with no matching items resolves to zero, so
 * the per-rule `resolved` count is computed the same way the world server does
 * (same function, same filters) rather than estimated — otherwise the panel
 * would promise stock the player never sees.
 */
function buildTabs(
  block: CharacterIncBlock,
  items: ItemIndex,
  text: ReadonlyMap<string, string>,
): VendorTabView[] {
  const stock = resolveVendorStock(block, items);
  const definedOnly = (kind3: string, totalNum: number): number =>
    [...(items.byKind3.get(kind3) ?? [])]
      .filter((m) => items.definedIds.has(m.id))
      .slice(0, Math.max(0, totalNum)).length;

  return block.vendorTabs.map((tab) => ({
    slot: tab.slot,
    labelToken: tab.label,
    labelText: text.get(tab.label) ?? "",
    rules: block.vendorItems
      .filter((v) => v.slot === tab.slot)
      .map((v) => ({
        slot: v.slot,
        kind3: v.itemKind3Symbol,
        label: labelForKind3(v.itemKind3Symbol),
        job: v.itemJob,
        uniqueMin: v.uniqueMin,
        uniqueMax: v.uniqueMax,
        totalNum: v.totalNum,
        resolved: definedOnly(v.itemKind3Symbol, v.totalNum),
      })),
    explicit: block.vendorItemIds
      .filter((v) => v.slot === tab.slot)
      .map((v) => {
        const def = items.items.get(v.itemId);
        return { slot: v.slot, itemId: v.itemId, name: def?.name, icon: def?.icon };
      }),
    filled: (stock[tab.slot] ?? []).filter((s) => s !== null).length,
  }));
}

/**
 * Read one block's current capability state.
 *
 * Reads the already-parsed `characterInc` index rather than re-parsing the 13k-line
 * file — the resource cache owns that parse and is invalidated on write.
 * A key with no block returns `exists: false` rather than throwing, so the panel
 * can explain the situation instead of 500-ing on an NPC whose `character_key`
 * is blank or points at a school/other .inc file.
 */
export async function readIncBlock(key: string): Promise<IncBlockView> {
  const idx = await getResourceIndex();
  const inc = idx.characterInc;
  const block = inc.byKey.get(key) ?? inc.byStem.get(key.toLowerCase());
  const sharers = sharersForKey(key);

  if (!block) {
    return {
      key,
      exists: false,
      name: undefined,
      menus: [],
      dialogFile: undefined,
      vendorTabCount: 0,
      buffSkillCount: 0,
      tabs: [],
      sharers,
    };
  }

  return {
    key: block.key,
    exists: true,
    name: block.nameId ? inc.text.get(block.nameId) : undefined,
    menus: [...block.menus].sort((a, b) => a - b),
    dialogFile: block.dialogFile,
    vendorTabCount: block.vendorTabs.length,
    buffSkillCount: block.buffSkills.length,
    tabs: buildTabs(block, idx.items, inc.text),
    sharers,
  };
}
