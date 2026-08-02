/**
 * MoverBroadcastSerializer byte-length tests -- MOVERMOVED2 / MOVERBEHAVIOR2 /
 * MOVERANGLE. These frames are flight-only; a wrong byte count desyncs every
 * peer's `OnMoverMoved2`/`OnMoverBehavior2`/`OnMoverAngle` reader.
 *
 * Wire layout from `CUserMng::AddMoverMoved2` (`User.cpp:4910`),
 * `AddMoverBehavior2` (`:4930`), `AddMoverAngle` (`:4949`).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MoverBroadcastSerializer } from '../../../src/net/snapshot/moverBroadcast.serializer';

const s = new MoverBroadcastSerializer();

const frame2 = {
  v: { x: 1, y: 2, z: 3 }, vd: { x: 4, y: 5, z: 6 }, f: 7,
  fAngleX: 0.1, fAccPower: 0.2, fTurnAngle: 0.3,
  dwState: 0, dwStateFlag: 0x08, dwMotion: 1, nMotionEx: 0, nLoop: 0,
  dwMotionOption: 0, nTickCount: 0n, nFrame: 2,
};

// Outer SNAPSHOT frame: [DWORD SNAPSHOT][DWORD objidPlayer][WORD count=1]
// [DWORD senderObjid][WORD subtype][body]. Header = 4+4+2+4+2 = 16 bytes.
const HEADER = 16;

describe('MoverBroadcastSerializer -- flight frame lengths', () => {
  it('buildMoved2 = 16 header + 73 body (trailing nFrame:BYTE)', () => {
    const buf = s.buildMoved2(0xaaaa, frame2);
    // 12 floats(vd,v,f,angleX,acc,turn) + state/flag/motion(3*4) + motionEx/loop(2*4)
    // + motionOption(4) + tickCount(8) + nFrame(1) = 48+12+4+8+1 = 73
    assert.equal(buf.length, HEADER + 73);
    assert.equal(buf.readUInt16LE(14), 0x00cc, 'SNAPSHOTTYPE_MOVERMOVED2');
  });

  it('buildBehavior2 = 16 header + 72 body (NO trailing nFrame)', () => {
    const buf = s.buildBehavior2(0xaaaa, frame2);
    assert.equal(buf.length, HEADER + 72, 'behavior2 is moved2 minus the nFrame byte');
    assert.equal(buf.readUInt16LE(14), 0x00cd, 'SNAPSHOTTYPE_MOVERBEHAVIOR2');
  });

  it('buildAngle = 16 header + 48 body (no state/motion block)', () => {
    const buf = s.buildAngle(0xaaaa, {
      v: { x: 1, y: 2, z: 3 }, vd: { x: 4, y: 5, z: 6 }, f: 7,
      fAngleX: 0.1, fAccPower: 0.2, fTurnAngle: 0.3, nTickCount: 0n,
    });
    // v(12) + vd(12) + f(4) + angleX(4) + acc(4) + turn(4) + tick(8) = 48.
    assert.equal(buf.length, HEADER + 48);
    assert.equal(buf.readUInt16LE(14), 0x00ce, 'SNAPSHOTTYPE_MOVERANGLE');
  });
});
