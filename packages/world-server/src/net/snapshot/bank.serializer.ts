/**
 * Bank S->C snapshots -- `CUser::AddPutItemBank` / `AddGetItemBank` /
 * `AddPutGoldBank` / `AddBankWindow` (`WORLDSERVER/User.cpp:965-1034`).
 *
 * All are per-user snapshots (`objid | WORD subtype | fields`) wrapped once in
 * PACKETTYPE_SNAPSHOT. Item bodies reuse the 75-byte CItemElem chain.
 *   PUTITEMBANK 0x0050: `[objid][0x0050][BYTE nSlot=tab][CItemElem body]`
 *   GETITEMBANK 0x0051: `[objid][0x0051][CItemElem body]` (no slot -- client appends)
 *   PUTGOLDBANK 0x0052: `[objid][0x0052][BYTE nSlot=tab][DWORD dwGold][DWORD dwGoldBank]`
 *   BANKWINDOW  0x0056: `[objid][0x0056][int nMode][DWORD dwId][DWORD dwItemId]`
 *
 * @module net/snapshot/bank
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';
import { writeCItemElemBody } from '@flyff/world-core';
import type { InventorySlot } from '@flyff/entities';

function snapshotFrame(objid: number, subtype: number, write: (w: PacketWriter) => void): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(subtype);
  write(w);
  return w.build();
}

/** Acknowledge an item deposited into bank tab `tab`. */
export function buildPutItemBank(objid: number, tab: number, bankSlot: number, item: InventorySlot): Buffer {
  return snapshotFrame(objid, SNAPSHOTTYPE.PUTITEMBANK, (w) => {
    w.writeByte(tab & 0xff);
    writeCItemElemBody(w, bankSlot, item);
  });
}

/** Acknowledge an item withdrawn (now in the player's bag). */
export function buildGetItemBank(objid: number, invSlot: number, item: InventorySlot): Buffer {
  return snapshotFrame(objid, SNAPSHOTTYPE.GETITEMBANK, (w) => {
    writeCItemElemBody(w, invSlot, item);
  });
}

/** Acknowledge gold moved into bank tab `tab`. dwGold=inv remainder, dwGoldBank=new bank total. */
export function buildPutGoldBank(objid: number, tab: number, dwGold: number, dwGoldBank: number): Buffer {
  return snapshotFrame(objid, SNAPSHOTTYPE.PUTGOLDBANK, (w) => {
    w.writeByte(tab & 0xff);
    w.writeDword(dwGold);
    w.writeDword(dwGoldBank);
  });
}

/** Withdraw-gold ack -- same layout as PUTGOLDBANK, GETGOLDBANK shares the subtype family. */
export function buildGetGoldBank(objid: number, tab: number, dwGold: number, dwGoldBank: number): Buffer {
  return buildPutGoldBank(objid, tab, dwGold, dwGoldBank);
}

/**
 * Open the bank window. `nMode` selects the client dialog (DPClient.cpp:2969
 * `if( nMode )`): 1 = `CWndConfirmBank` (enter-pin), 0 = `CWndBankPassword`
 * (set/change-pin). Set by `BankService.open` from `m_szBankPass`.
 */
export function buildBankWindow(objid: number, nMode: number, dwId: number = NULL_ID, dwItemId: number = 0): Buffer {
  return snapshotFrame(objid, SNAPSHOTTYPE.BANKWINDOW, (w) => {
    w.writeDword(nMode);
    w.writeDword(dwId);
    w.writeDword(dwItemId);
  });
}

/**
 * Bank password confirm ack -- `CUser::AddconfirmBankPass` (User.cpp:1065):
 * `[objid][0x0058][int nMode][DWORD dwId][DWORD dwItemId]`. nMode 1 = password
 * accepted -> client opens the bank; 0 = wrong password -> re-prompts.
 */
export function buildConfirmBankPass(objid: number, nMode: number, dwId: number = NULL_ID, dwItemId: number = 0): Buffer {
  return snapshotFrame(objid, SNAPSHOTTYPE.CONFIRMBANKPASS, (w) => {
    w.writeDword(nMode);
    w.writeDword(dwId);
    w.writeDword(dwItemId);
  });
}

/**
 * Change-bank-password ack -- `CUser::AddChangeBankPass` (User.cpp:1054):
 * `[objid][0x0057][int nMode][DWORD dwId][DWORD dwItemId]`. nMode 1 = old
 * password matched, new one saved -> client shows success; 0 = old password
 * wrong -> client re-prompts.
 */
export function buildChangeBankPass(objid: number, nMode: number, dwId: number = NULL_ID, dwItemId: number = 0): Buffer {
  return snapshotFrame(objid, SNAPSHOTTYPE.CHANGEBANKPASS, (w) => {
    w.writeDword(nMode);
    w.writeDword(dwId);
    w.writeDword(dwItemId);
  });
}
