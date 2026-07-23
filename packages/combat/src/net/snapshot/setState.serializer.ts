/**
 * S->C SETSTATE snapshot -- `SNAPSHOTTYPE_SETSTATE` (0x006a).
 *
 * Mirrors `CUser::AddSetState` (`WORLDSERVER/User.cpp:2407`):
 *   ar << GETID(pPlayer) << SNAPSHOTTYPE_SETSTATE;
 *   ar << nStr(DWORD) << nSta(DWORD) << nDex(DWORD) << nInt(DWORD)
 *      << (LONG)0 << nRemainGP(DWORD);
 *
 * **Self-only** (per-user `m_Snapshot`). The client's `OnSetState`
 * (`Neuz/DPClient.cpp:13376`) reads str/sta/dex/int + remainLP(0) + remainGP,
 * then refills HP/MP/FP to the new max. Sent on any stat allocation
 * (`OnModifyStatus`) and on GM `/stat`.
 *
 * @module net/snapshot/setState.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_SETSTATE, NULL_ID } from '@flyff/world-core';

export interface StateFrame {
  readonly str: number;
  readonly sta: number;
  readonly dex: number;
  readonly int: number;
  readonly remainGP: number;
}

export class SetStateSerializer {
  build(playerObjid: number, f: StateFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(playerObjid);
    w.writeWord(SNAPSHOTTYPE_SETSTATE);
    w.writeDword(f.str);        // m_nStr (DWORD)
    w.writeDword(f.sta);        // m_nSta
    w.writeDword(f.dex);        // m_nDex
    w.writeDword(f.int);        // m_nInt
    w.writeDword(0);            // m_nRemainLP (always 0 -- unused v15)
    w.writeDword(f.remainGP);   // m_nRemainGP
    return w.build();
  }
}
