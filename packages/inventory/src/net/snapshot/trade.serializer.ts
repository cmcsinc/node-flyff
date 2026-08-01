/**
 * S->C trade snapshots -- `SNAPSHOTTYPE_TRADE*` / `CONFIRMTRADE*`
 * (`_Network/MsgHdr.h:890-939`). Every builder below is a verbatim port of the
 * matching `CUser::Add*` in `WORLDSERVER/User.cpp`.
 *
 * Recipient rules, which differ per packet and are easy to get wrong:
 *  - CONFIRMTRADE / CONFIRMTRADECANCEL go to the TARGET only; the header objid
 *    IS the payload (zero body).
 *  - TRADE goes to BOTH sides, but each copy carries the OTHER side's objid in
 *    the header and the OTHER side's full inventory in the body.
 *  - TRADEPUT / TRADEPULL / TRADEPUTGOLD / TRADEOK / TRADECANCEL /
 *    TRADELASTCONFIRMOK go to both sides with the ACTOR's objid, so each client
 *    can tell whose half of the window changed.
 *  - TRADEPUTERROR / TRADECONSENT / TRADELASTCONFIRM are self/both with a fixed
 *    header (GetId() / NULL_ID respectively) and no body.
 *
 * @module net/snapshot/trade.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import type { InventorySlot } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/entities';
import { NULL_ID, INVENTORY_SLOTS, writeItemContainer } from '@flyff/world-core';

/** Open a SNAPSHOT frame with one block: `[SNAPSHOT][NULL_ID][cb=1][objid][sub]`. */
function open(objid: number, subtype: number): PacketWriter {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(subtype);
  return w;
}

/** Bodyless block -- `CUser::AddHdr( objid, wHdr )` (`User.h:250`). */
function hdr(objid: number, subtype: number): Buffer {
  return open(objid, subtype).build();
}

/**
 * `CUser::AddTrade` (`User.cpp:751`) -- opens the trade window:
 *   ar << GETID( pTrader );        // the OTHER side's objid
 *   ar << SNAPSHOTTYPE_TRADE;
 *   ar << uidPlayer;               // u_long -- who initiated (both copies same)
 *   pTrader->m_Inventory.Serialize( ar );   // the OTHER side's full bag
 *
 * Note both `AddTrade` calls in `OnTrade` (DPSrvr.cpp:8871) pass
 * `pUser->m_idPlayer` as `uidPlayer` -- the INITIATOR's id, in both copies. The
 * client uses it only to label the window, not to pick a side.
 *
 * The body is the standard `CItemContainer<CItemElem>::Serialize`, identical to
 * the JOIN inventory blob: 73 slots with `indexNum = MAX_INVENTORY` so the equip
 * tail stays NULL_ID.
 *
 * ponytail: `writeItemContainer` stamps each elem's `m_dwObjId` as its SLOT
 * index, so the partner's copy of this bag keys items by slot. When the owner's
 * item objid has drifted from its slot (equip/unequip/move), the TRADEPUT echo's
 * `nId` (a real objid) will not resolve in the partner's copy and the partner's
 * half of the window renders empty -- the trade itself still commits correctly,
 * since the server never trusts the client's view. Fixing it needs
 * `writeItemContainer` to take per-slot objids (shared with the JOIN blob).
 */
export function buildTrade(
  otherObjid: number, initiatorCharId: number,
  otherInventory: readonly (InventorySlot | null | undefined)[],
): Buffer {
  const w = open(otherObjid, SNAPSHOTTYPE.TRADE_SNAPSHOT);
  w.writeDword(initiatorCharId);
  writeItemContainer(
    w, INVENTORY_SLOTS,
    Array.from({ length: INVENTORY_SLOTS }, (_, i) => otherInventory[i] ?? null),
    MAX_INVENTORY,
  );
  return w.build();
}

/**
 * `CUser::AddComfirmTrade` (`User.cpp:763`) -- the "X wants to trade" popup.
 * Zero body; the header objid is the REQUESTER, which is what the client
 * resolves via `prj.GetMover(objid)`. Sent to the target only.
 */
export function buildConfirmTrade(requesterObjid: number): Buffer {
  return hdr(requesterObjid, SNAPSHOTTYPE.CONFIRMTRADE);
}

/** `CUser::AddComfirmTradeCancel` (`User.cpp:772`) -- popup dismissed. */
export function buildConfirmTradeCancel(objid: number): Buffer {
  return hdr(objid, SNAPSHOTTYPE.CONFIRMTRADECANCEL);
}

/**
 * `CUser::AddTradePut` (`User.cpp:803`):
 *   ar << objid << SNAPSHOTTYPE_TRADEPUT;
 *   ar << i << nItemType << nId << nItemNum;   // BYTE, BYTE, BYTE, short
 * `objid` is the ACTOR. `nId` is the item's stable `m_dwObjId` (the client
 * re-resolves it with `GetItemId(nId)` in `OnTradePut`, `DPClient.cpp:2605`), NOT
 * a bag slot -- echo back exactly what the client sent. `nItemNum` is the staged
 * count as CLAMPED by the server (`TradeSetItem2` writes it back by reference),
 * not the count the client asked for.
 */
export function buildTradePut(
  actorObjid: number, windowIndex: number, itemType: number,
  itemObjId: number, count: number,
): Buffer {
  const w = open(actorObjid, SNAPSHOTTYPE.TRADEPUT);
  w.writeByte(windowIndex);
  w.writeByte(itemType);
  w.writeByte(itemObjId);
  w.writeWord(count & 0xffff);      // short
  return w.build();
}

/**
 * `CUser::AddTradePutError` (`User.cpp:813`) -- header is `GetId()` (self), no
 * body. Sent when a put arrives while either side is past the ITEM step.
 */
export function buildTradePutError(selfObjid: number): Buffer {
  return hdr(selfObjid, SNAPSHOTTYPE.TRADEPUTERROR);
}

/** `CUser::AddTradePull` (`User.cpp:822`) -- `objid | TRADEPULL | BYTE i`. */
export function buildTradePull(actorObjid: number, windowIndex: number): Buffer {
  const w = open(actorObjid, SNAPSHOTTYPE.TRADEPULL);
  w.writeByte(windowIndex);
  return w.build();
}

/** `CUser::AddTradePutGold` (`User.cpp:832`) -- `objid | TRADEPUTGOLD | DWORD`. */
export function buildTradePutGold(actorObjid: number, gold: number): Buffer {
  const w = open(actorObjid, SNAPSHOTTYPE.TRADEPUTGOLD);
  w.writeDword(Math.max(0, Math.floor(gold)) >>> 0);
  return w.build();
}

/**
 * `CUser::AddTradeCancel` (`User.cpp:852`):
 *   ar << objid << SNAPSHOTTYPE_TRADECANCEL;
 *   ar << uidPlayer << nMode;      // u_long, int
 * `nMode` defaults to 0 (`User.h:268`) and is echoed from the client's
 * `OnTradeCancel` body. `objid` is NULL_ID on the commit-error path
 * (DPSrvr.cpp:8910) and the actor's objid on an explicit cancel.
 */
export function buildTradeCancel(objid: number, charId: number, mode = 0): Buffer {
  const w = open(objid, SNAPSHOTTYPE.TRADECANCEL);
  w.writeDword(charId);
  w.writeDword(mode | 0);
  return w.build();
}

/** `CUser::AddTradeOk` (`User.h:269`) -- bodyless, header = the actor. */
export function buildTradeOk(actorObjid: number): Buffer {
  return hdr(actorObjid, SNAPSHOTTYPE.TRADEOK);
}

/**
 * `CUser::AddTradelastConfirm` (`User.h:271`) -- bodyless with header NULL_ID.
 * Tells both clients to show the final-confirm prompt.
 */
export function buildTradeLastConfirm(): Buffer {
  return hdr(NULL_ID, SNAPSHOTTYPE.TRADELASTCONFIRM);
}

/** `CUser::AddTradelastConfirmOk` (`User.h:272`) -- header = the confirming side. */
export function buildTradeLastConfirmOk(actorObjid: number): Buffer {
  return hdr(actorObjid, SNAPSHOTTYPE.TRADELASTCONFIRMOK);
}

/**
 * `CUser::AddTradeConsent` (`User.h:270`) -- bodyless, header NULL_ID. The
 * commit succeeded; the client closes the window.
 */
export function buildTradeConsent(): Buffer {
  return hdr(NULL_ID, SNAPSHOTTYPE.TRADECONSENT);
}
