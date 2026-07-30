/**
 * Vendor-stock expansion -- shared by the world server (NPC shop materialization)
 * and the admin panel (shop-stock preview), so the two can never drift.
 *
 * Lives in `@flyff/resources` (not `@flyff/entities`) because the expansion is a
 * pure function of resource data. The slot/tab types below are declared locally
 * and structurally identical to `@flyff/entities`' `InventorySlot` / `VendorStock`
 * -- `@flyff/resources` must not depend on `@flyff/entities` (entities depends on
 * core+database and sits above resources in the DAG).
 *
 * @module vendorStock
 */

import type { CharacterIncBlock } from './loaders/characterInc.loader';
import type { ItemIndex } from './loaders/item.loader';

/** Per-tab slot cap -- `MAX_VENDOR_INVENTORY` (`ProjectCmn.h:21`, 100). */
export const VENDOR_TAB_SLOTS = 100;

/** Number of shop tabs -- `AddVendorSlot( 0..3, ... )`. */
const VENDOR_TABS = 4;

/**
 * One vendor slot. Structurally assignable to `@flyff/entities`'
 * `InventorySlot` (whose extra fields are all optional).
 */
export interface VendorSlot {
  itemId: number;
  count: number;
}

/** 4 tabs x {@link VENDOR_TAB_SLOTS} slots -- assignable to `VendorStock`. */
export type VendorStockTabs = readonly (readonly (VendorSlot | null)[])[];

/** 4 tabs of 100 nulls -- returned for NPCs with no vendor block. */
export const EMPTY_VENDOR_TABS: VendorStockTabs = Object.freeze(
  Array.from({ length: VENDOR_TABS }, () =>
    Object.freeze(Array.from({ length: VENDOR_TAB_SLOTS }, () => null)),
  ),
);

/**
 * Resolve a character.inc vendor block into 4 tabs of concrete stock.
 *
 * `AddVendorItem(slot, IK3_*, job, minU, maxU, totalNum)` expands to the items
 * tagged with that IK3 symbol in {@link ItemIndex.byKind3}, sorted by
 * `level_req` ascending and capped at `totalNum`. `AddVendorItem2(slot, dwId)`
 * appends the explicit propItem id directly. Each placed slot carries the
 * item's `stack_size` (propItem `dwPackMax`) as its count: the v19 client's
 * shop window (`WndShop.cpp:106`) clamps the buy-quantity edit box to this
 * value, so `count: 1` made every vendor item effectively single-purchase
 * ("can't buy more than 1"). Setting it to the natural stack size matches
 * vanilla vendor display -- potions show 100, non-stackable gear shows 1.
 * The server's BUYITEM path does NOT enforce this cap (no stock decrement),
 * so it is purely the client-side input clamp.
 *
 * ponytail: permissive expansion -- the `job`/`nUniqueMin`/`nUniqueMax` band is
 * NOT filtered today (level_req 15-27 would wrongly exclude vagrant-tier stock).
 * Restore the band + sex filter once the C++ expansion in `_Common/Project.cpp`
 * (`AddVendorItem` -> `m_venderItemAry`) is confirmed.
 */
export function resolveVendorStock(
  charBlock: CharacterIncBlock | undefined,
  items: ItemIndex,
): VendorStockTabs {
  if (!charBlock || (charBlock.vendorItems.length === 0 && charBlock.vendorItemIds.length === 0)) {
    return EMPTY_VENDOR_TABS;
  }
  // Tabs start empty; items are pushed then each row is padded to the slot cap
  // with nulls so every tab is exactly MAX_VENDOR_INVENTORY wide.
  const tabs: (VendorSlot | null)[][] = Array.from({ length: VENDOR_TABS }, () => []);
  const place = (tab: number, itemId: number): void => {
    if (tab < 0 || tab >= tabs.length) return;
    const row = tabs[tab]!;
    if (row.length >= VENDOR_TAB_SLOTS) return;
    const count = Math.max(1, items.items.get(itemId)?.stack_size ?? 1);
    row.push({ itemId, count });
  };

  for (const v of charBlock.vendorItems) {
    if (!v.itemKind3Symbol) continue;
    const matches = items.byKind3.get(v.itemKind3Symbol) ?? [];
    // Whitelist by defineItem.h II_* ids: the client resolves item ids via raw
    // m_aPropItem[id] array lookup, so any id that is not a defined II_* value
    // is a null hole -> SetTexture null-deref crash (Mover.cpp:4591 dwShopAble
    // gate + the array-index lookup in CProject::GetItemProp, Project.h:1322).
    const picked = [...matches]
      .filter((m) => items.definedIds.has(m.id))
      .sort((a, b) => a.level_req - b.level_req)
      .slice(0, Math.max(0, v.totalNum));
    for (const m of picked) place(v.slot, m.id);
  }
  for (const v of charBlock.vendorItemIds) {
    if (items.definedIds.has(v.itemId)) place(v.slot, v.itemId);
  }
  for (const row of tabs) {
    while (row.length < VENDOR_TAB_SLOTS) row.push(null);
  }
  return Object.freeze(tabs.map((row) => Object.freeze(row)));
}
