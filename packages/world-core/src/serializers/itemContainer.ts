/**
 * `writeItemContainer` -- shared CItemContainer<CItemElem> serializer base used
 * by the JOIN mover blob (shell) AND NPC shop tabs (@flyff/npc). Extracted from
 * mover.serializer so both reach it without a cross-package edge. Mirrors
 * `CItemContainer::Serialize` (`_Common/Item.h:818`).
 *
 * @module world-core/serializers/itemContainer
 */

import type { InventorySlot } from '@flyff/entities';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { NULL_ID } from '../snapshot-constants';
import { writeCItemElemBody } from './itemElemBody.serializer';

export function writeItemContainer(
  w: PacketWriter,
  slots: number,
  contents: readonly (InventorySlot | null)[],
  /**
   * `m_dwIndexNum` -- the visible bag-slot count. `m_apIndex[i] = i` (identity)
   * for `i < indexNum`, matching `CItemContainer::Clear()` (Item.h:480). Defaults
   * to `slots` (bank/vendor tabs carry no equip extension). Pass `MAX_INVENTORY`
   * for the player inventory so equip-part slots (>= indexNum) stay NULL_ID.
   */
  indexNum = slots,
): void {
  const occupied: number[] = [];
  for (let i = 0; i < slots; i++) {
    const s = contents[i] ?? null;
    // m_apIndex[i]: identity for the visible bag range. Empty bag slots MUST be
    // `i`, not NULL_ID -- the bag grid renders each slot via GetAt(i) =
    // m_apItem[m_apIndex[i]] (Item.h:818), which returns NULL when m_apIndex[i]
    // is NULL_ID. With NULL_ID, a SetAtId-placed item (buy/pickup CREATEITEM
    // writes m_apItem but never m_apIndex) is invisible until a relog re-sends
    // the identity table.
    w.writeDword(i < indexNum ? i : (s ? i : NULL_ID));   // m_apIndex[i]
    if (s) occupied.push(i);
  }
  w.writeByte(occupied.length & 0xff);         // chSize
  for (const i of occupied) {
    w.writeByte(i & 0xff);                     // slot index
    writeCItemElemBody(w, i, contents[i]!);
  }
  for (let i = 0; i < slots; i++) {            // adwObjIndex -- same identity rule
    w.writeDword(i < indexNum ? i : (contents[i] ? i : NULL_ID));
  }
}
