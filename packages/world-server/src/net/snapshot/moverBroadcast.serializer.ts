/**
 * S->C MOVERMOVED / MOVERBEHAVIOR broadcasts -- movement + motion echo to peers.
 *
 * Mirrors `CUserMng::AddMoverMoved` (`User.cpp:4839`) and `AddMoverBehavior`
 * (`User.cpp:4857`) -- byte-identical 60-byte bodies; only the sub-type differs:
 *   ar << GETID( pMover ) << SNAPSHOTTYPE_MOVERMOVED|MOVERBEHAVIOR;
 *   ar << v << vd << f;
 *   ar << dwState << dwStateFlag << dwMotion << nMotionEx;
 *   ar << nLoop << dwMotionOption << nTickCount;
 *
 * Wrapped in a SNAPSHOT packet like all peer broadcasts (see destPos.serializer
 * for the outer-frame note -- `objidPlayer` is unused client-side, shared packet).
 *
 * @module net/snapshot/moverBroadcast.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { Vec3 } from '@flyff/entities';
import {
  SNAPSHOTTYPE_MOVERMOVED, SNAPSHOTTYPE_MOVERBEHAVIOR,
  SNAPSHOTTYPE_MOVERCORR, SNAPSHOTTYPE_MOVERMOVED2, NULL_ID,
} from '@flyff/world-core';

/**
 * Parsed 60-byte PLAYERMOVED/PLAYERBEHAVIOR body (DPSrvr.cpp:2271 OnPlayerMoved).
 * Field widths/types match the C++ `ar >>` reads exactly. `nTickCount` is an
 * `__int64` echoed verbatim -- `bigint` to preserve the full 64-bit pattern.
 */
export interface MovementFrame {
  v: Vec3;                 // position (Vec3, 12B)
  vd: Vec3;                // velocity/delta (Vec3, 12B)
  f: number;               // angle (float, 4B)
  dwState: number;         // DWORD
  dwStateFlag: number;     // DWORD
  dwMotion: number;        // DWORD
  nMotionEx: number;       // int32 (signed)
  nLoop: number;           // int32 (signed)
  dwMotionOption: number;  // DWORD
  nTickCount: bigint;      // __int64 (8B) -- echo bit pattern
}

export class MoverBroadcastSerializer {
  /** Build the SNAPSHOT/MOVERMOVED broadcast payload (60-byte body). */
  buildMoved(senderObjid: number, frame: MovementFrame): Buffer {
    return this.build(SNAPSHOTTYPE_MOVERMOVED, senderObjid, frame);
  }

  /** Build the SNAPSHOT/MOVERBEHAVIOR broadcast payload (60-byte body). */
  buildBehavior(senderObjid: number, frame: MovementFrame): Buffer {
    return this.build(SNAPSHOTTYPE_MOVERBEHAVIOR, senderObjid, frame);
  }

  /** Build the SNAPSHOT/MOVERCORR broadcast payload (60-byte body, same as MOVERMOVED). */
  buildCorr(senderObjid: number, frame: MovementFrame): Buffer {
    return this.build(SNAPSHOTTYPE_MOVERCORR, senderObjid, frame);
  }

  /**
   * Build the SNAPSHOT/MOVERMOVED2 broadcast payload (73-byte body).
   *
   * Mirrors `CUserMng::AddMoverMoved2` (User.cpp): same leading fields as
   * MOVERMOVED plus `fAngleX, fAccPower, fTurnAngle` (3 floats) inserted
   * after `f`, and a trailing `nFrame:BYTE`.
   */
  buildMoved2(senderObjid: number, frame: Movement2Frame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(senderObjid);
    w.writeWord(SNAPSHOTTYPE_MOVERMOVED2);
    w.writeFloat(frame.v.x);  w.writeFloat(frame.v.y);  w.writeFloat(frame.v.z);
    w.writeFloat(frame.vd.x); w.writeFloat(frame.vd.y); w.writeFloat(frame.vd.z);
    w.writeFloat(frame.f);
    w.writeFloat(frame.fAngleX);
    w.writeFloat(frame.fAccPower);
    w.writeFloat(frame.fTurnAngle);
    w.writeDword(frame.dwState);
    w.writeDword(frame.dwStateFlag);
    w.writeDword(frame.dwMotion);
    w.writeLong(frame.nMotionEx);
    w.writeLong(frame.nLoop);
    w.writeDword(frame.dwMotionOption);
    w.writeQword(frame.nTickCount);
    w.writeByte(frame.nFrame);
    return w.build();
  }

  private build(subtype: number, senderObjid: number, frame: MovementFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(senderObjid);
    w.writeWord(subtype);
    w.writeFloat(frame.v.x);  w.writeFloat(frame.v.y);  w.writeFloat(frame.v.z);
    w.writeFloat(frame.vd.x); w.writeFloat(frame.vd.y); w.writeFloat(frame.vd.z);
    w.writeFloat(frame.f);
    w.writeDword(frame.dwState);
    w.writeDword(frame.dwStateFlag);
    w.writeDword(frame.dwMotion);
    w.writeLong(frame.nMotionEx);
    w.writeLong(frame.nLoop);
    w.writeDword(frame.dwMotionOption);
    w.writeQword(frame.nTickCount);
    return w.build();
  }
}

/**
 * Parsed 73-byte PLAYERMOVED2 body (DPSrvr.cpp:2397 OnPlayerMoved2). Adds the
 * flight fields `fAngleX, fAccPower, fTurnAngle` + `nFrame:BYTE` vs `MovementFrame`.
 */
export interface Movement2Frame extends MovementFrame {
  fAngleX: number;     // float
  fAccPower: number;   // float
  fTurnAngle: number;  // float
  nFrame: number;      // BYTE
}
