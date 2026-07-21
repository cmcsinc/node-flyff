/**
 * DOEQUIP S→C snapshots — equip-change confirm (self) + vicinity render.
 *
 * Self (`CUser::AddDoEquip`, `User.cpp:1197`):
 *   `[objid][SNAPSHOTTYPE_DOEQUIP=0x0006][BYTE nId][DWORD dwItemId][BYTE fEquip]`
 * Vicinity (`CUserMng::AddDoEquip`, `User.cpp:4515`):
 *   `[objid][0x0006][BYTE nId][DWORD idGuild][BYTE fEquip]
 *    [EQUIP_INFO 12B raw: DWORD dwId, int nOption, BYTE byFlag + 3B MSVC pad]
 *    [int nPart]`
 *
 * EQUIP_INFO is `{DWORD,int,BYTE}` = 9 bytes but MSVC pads the struct to 12 —
 * the 3 trailing pad bytes are written literal zero. Omitting them desyncs the
 * stream (nPart reads garbage) and crashes Neuz. #1 equip wire risk.
 *
 * `nId` is the inventory elem objid; in our model the slot index (BYTE-truncated,
 * matches the C++ cast at User.cpp:4522). `fEquip` = 1 equip / 0 unequip.
 *
 * @module net/snapshot/doEquip
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID } from './constants.js';

export interface EquipInfoBody {
  /** propItem id (CItemElem.m_dwItemId). */
  dwId: number;
  /** Ability option — refine<<4 (CItemElem.m_nAbilityOption). */
  nOption: number;
  /** Item flag (CItemElem.m_byFlag). */
  byFlag: number;
}

/** Self-confirm: sent only to the equipper. */
export function buildDoEquipSelf(objid: number, nId: number, dwItemId: number, fEquip: boolean): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE.DOEQUIP);
  w.writeByte(nId & 0xff);
  w.writeDword(dwItemId);
  w.writeByte(fEquip ? 1 : 0);
  return w.build();
}

/** Vicinity broadcast: sent to peers so they render the weapon/armor on the body. */
export function buildDoEquipVicinity(
  objid: number,
  nId: number,
  fEquip: boolean,
  info: EquipInfoBody,
  nPart: number,
): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE.DOEQUIP);
  w.writeByte(nId & 0xff);
  w.writeDword(0);            // idGuild (hardcoded 0 in this build — User.cpp:4518)
  w.writeByte(fEquip ? 1 : 0);
  // EQUIP_INFO — 12 bytes raw (MSVC pads {DWORD,int,BYTE} to 12).
  w.writeDword(info.dwId);    // DWORD dwId
  w.writeDword(info.nOption); // int nOption
  w.writeByte(info.byFlag);   // BYTE byFlag
  w.writeByte(0);             // pad
  w.writeByte(0);             // pad
  w.writeByte(0);             // pad
  w.writeDword(nPart);        // int nPart
  return w.build();
}
