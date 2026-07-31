/**
 * S->C MOVERFOCUS snapshot -- `SNAPSHOTTYPE_MOVERFOCUS` (0x003b).
 *
 * Mirrors `CUser::AddMoverFocus` (`WORLDSERVER/User.cpp:2534`):
 *   ar << NULL_ID << SNAPSHOTTYPE_MOVERFOCUS;
 *   ar << pMover->m_idPlayer << pMover->GetGold() << pMover->GetExp1();
 *
 * Wire layout after the SNAPSHOT/NULL_ID/count preamble:
 *   objid:DWORD (= NULL_ID, NOT the focused player) | 0x003b:WORD
 *   uidPlayer:DWORD | dwGold:DWORD | nExp1:__int64
 *
 * **Self-only** -- goes to the GM who clicked, never the focused player.
 * `nExp1` is the within-level exp (see memory `flyff-exp-within-level-model`).
 *
 * @module net/snapshot/moverFocus.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_MOVERFOCUS } from '@flyff/world-core';

export interface MoverFocusFrame {
  readonly uidPlayer: number;
  readonly gold: number;
  readonly exp: number;
}

export class MoverFocusSerializer {
  build(f: MoverFocusFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(NULL_ID);                    // objid slot -- NULL_ID per AddMoverFocus
    w.writeWord(SNAPSHOTTYPE_MOVERFOCUS);
    w.writeDword(f.uidPlayer);
    w.writeDword(Math.max(0, Math.floor(f.gold)) >>> 0);
    w.writeQword(Math.max(0, Math.floor(f.exp)));  // nExp1 (__int64)
    return w.build();
  }
}
