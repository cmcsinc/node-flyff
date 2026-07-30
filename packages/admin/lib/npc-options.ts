/**
 * Server-only option builders for the NPC editor pickers.
 *
 * Both functions await the process-wide resource index (`resource-cache.ts`)
 * and return `EnumOption[]` lists. They are called once in the NPC edit page
 * (a server component) and passed down through `FieldOptionsProvider`.
 *
 * `characterKeyOptions()` follows the C++ naming chain:
 *   block -> `SetName(IDS_*)` -> `character.txt.txt` text
 * Falls back to stripping the `XxYy_` region prefix — never the propMover
 * model name, which is wrong for NPCs (`quest-catalog.ts:71`).
 *
 * `npcMoverOptions()` filters `movers.byType` to `type: "npc"` entries only.
 *
 * `SearchableSelect` caps rendered options at 200, but its search filter runs
 * BEFORE the `.slice(0, 200)` — so a key at position #350 is reachable by
 * typing a few characters. No fix needed there (`searchable-select.tsx:101`).
 *
 * @module lib/npc-options
 */

import { npcNameForKey } from "@flyff/resources";
import { getResourceIndex } from "./resource-cache";
import type { EnumOption } from "./field-schema";

/**
 * Every `character.inc` block key, labelled `<Resolved Name> (<key>)`.
 *
 * A block with no resolved name shows the key with the region prefix stripped
 * (`MaFl_SsoTta` -> `SsoTta`).
 */
export async function characterKeyOptions(): Promise<EnumOption[]> {
  const res = await getResourceIndex();
  const opts: EnumOption[] = [];
  for (const [key] of res.characterInc.byKey) {
    const name = npcNameForKey(res.characterInc, key);
    const fallback = key.replace(/^[A-Za-z]{2,4}_/, "") || key;
    opts.push({ value: key, label: `${name ?? fallback} (${key})` });
  }
  return opts;
}

/**
 * Every propMover entry whose `type` is `"npc"`, labelled `<name> (#<id>)`.
 */
export async function npcMoverOptions(): Promise<EnumOption[]> {
  const res = await getResourceIndex();
  const npcs = res.movers.byType.get("npc") ?? [];
  return npcs
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((m) => ({ value: String(m.id), label: `${m.name} (#${m.id})` }));
}
