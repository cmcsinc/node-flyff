/**
 * Item picker options for the resource editors.
 *
 * A set-item piece, a drop entry and a quest reward all store a bare numeric
 * `itemId`. Typing that number is not editing — nobody knows that 4587 is a
 * Leaf Hat. This resolves the whole catalog to `{value: id, label: "Name (id)"}`
 * so every `itemId` field becomes a name search, with the raw id still visible
 * for cross-referencing the C++ source (rule 12).
 *
 * Must be called server-side only: it reads the resource index (`node:fs`).
 *
 * @module lib/item-options
 */

import type { EnumOption } from './field-schema';
import { getAllItems } from './item-catalog';

/** Every item as a name-searchable option, sorted by name. */
export async function itemOptions(): Promise<EnumOption[]> {
  const items = await getAllItems();
  return items
    .map((d) => ({ value: String(d.id), label: `${d.name} (${String(d.id)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
