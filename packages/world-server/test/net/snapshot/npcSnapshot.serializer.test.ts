import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { CMover } from '../../../src/entities/mover.js';
import { NpcSnapshotSerializer } from '../../../src/net/snapshot/npcSnapshot.serializer.js';
import {
  SNAPSHOTTYPE_ADD_OBJ, OT_MOVER, MI_SMALL_MUSHPOIE, NULL_ID,
} from '../../../src/net/snapshot/constants.js';

/** Monster -- no outfit -> empty characterKey, uSize=0. */
function makeMonster(id: number, hp: number): CMover {
  return CMover.spawn(
    id,
    { modelIndex: MI_SMALL_MUSHPOIE, level: 1, hp, name: 'Mushpang' },
    { x: 100, y: 50, z: -25 },
    1,
  );
}

/** Human NPC with full outfit (Homeit: RIN suit+gauntlet+boots). */
function makeEquippedNpc(id: number): CMover {
  const m = CMover.spawn(
    id,
    { modelIndex: 12, level: 1, hp: 1000, name: 'Homeit', scale: 1.0, outfit: {
      characterKey: 'MaDa_Homeit',
      hairMesh: 1,
      hairColor: 0xff0000ff,
      headMesh: 3,
      equip: [
        { parts: 2, itemId: 1029 },  // PARTS_UPPER_BODY II_ARM_F_RIN_SUIT06
        { parts: 4, itemId: 1329 },  // PARTS_HAND        II_ARM_F_RIN_GAUNTLET06
        { parts: 5, itemId: 1629 },  // PARTS_FOOT        II_ARM_F_RIN_BOOTS06
      ],
    } },
    { x: 7000, y: 100, z: 3300 },
    1,
  );
  m.m_fAngle = 1.5;
  return m;
}

/**
 * Dialog-only NPC (Mikyel): AddMenu(MMI_DIALOG) but NO SetFigure/SetEquip.
 * `characterKey` is set standalone (decoupled from outfit) so the client can
 * resolve its `m_abMoverMenu` -> right-click "Dialog" option.
 */
function makeDialogNpc(id: number): CMover {
  return CMover.spawn(
    id,
    { modelIndex: 12, level: 1, hp: 1000, name: 'Mikyel', characterKey: 'MaFl_Mikyel' },
    { x: 1000, y: 100, z: 2000 },
    1,
  );
}

describe('NpcSnapshotSerializer', () => {
  const serializer = new NpcSnapshotSerializer();

  it('emits a zero-entry SNAPSHOT frame for an empty batch', () => {
    const buf = serializer.build([]);
    // [SNAPSHOT:DWORD][objidPlayer:DWORD][cb:WORD] = 10 bytes
    assert.equal(buf.length, 10);
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 0);
  });

  it('writes SNAPSHOT/ADD_OBJ + NPC branch byte-exact for one monster (empty characterKey)', () => {
    const buf = serializer.build([makeMonster(0x40000000, 77)]);
    // Frame(10) + entry(82) = 92. Entry = objid(4)+hdr(2)+objType(1)+objIndex(4)
    //   +CObj(21)+CCtrl(4)+prefix(20)
    //   +NPC-branch(hairMesh1+hairColor4+headMesh1+key(4+0)+uSize1+atk1+pat1+evt1+evtCnt4+speed4 = 22)
    //   +buffs(4) = 82
    assert.equal(buf.length, 92);

    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), NULL_ID);
    assert.equal(buf.readUInt16LE(8), 1); // cb

    // ADD_OBJ prefix
    assert.equal(buf.readUInt32LE(10), 0x40000000);
    assert.equal(buf.readUInt16LE(14), SNAPSHOTTYPE_ADD_OBJ);
    assert.equal(buf.readUInt8(16), OT_MOVER);
    assert.equal(buf.readUInt32LE(17), MI_SMALL_MUSHPOIE);

    // CObj::Serialize
    assert.equal(buf.readUInt8(21), OT_MOVER);
    assert.equal(buf.readUInt32LE(22), MI_SMALL_MUSHPOIE);
    assert.equal(buf.readUInt16LE(26), 100); // scale 1.0
    assert.equal(buf.readFloatLE(28), 100);
    assert.equal(buf.readFloatLE(32), 50);
    assert.equal(buf.readFloatLE(36), -25);

    // CCtrl m_objid after 2-byte angle at 40-41
    assert.equal(buf.readUInt32LE(42), 0x40000000);

    // CMover prefix: motion(46)+bPlayer(48)+hp(49)
    assert.equal(buf.readUInt16LE(46), 0);
    assert.equal(buf.readUInt8(48), 0); // m_bPlayer -> NPC branch
    assert.equal(buf.readUInt32LE(49), 77);
  });

  it('serializes a human NPC outfit: characterKey + equip parts', () => {
    const buf = serializer.build([makeEquippedNpc(0x40000001)]);
    // Frame(10) + entry(102) = 112. Entry delta vs monster (82):
    //   characterKey "MaDa_Homeit" = 11 chars -> +11 vs empty key
    //   equip 3 * {parts1 + itemId2} = +9
    //   -> 82 + 11 + 9 = 102. Total = 112.
    assert.equal(buf.length, 112);
    assert.equal(buf.readUInt16LE(8), 1);

    // Layout: frame(10) + ADD_OBJ(11)=21 + CObj(21)=42 + CCtrl(4)=46
    //   + CMover prefix(20)=66 -> NPC branch:
    //   hairMesh(66) hairColor(67) headMesh(71) keyLen(72) key(76..86)
    //   uSize(87) equip0(88..90) equip1(91..93) equip2(94..96)
    //   activeAttack(97) movePattern(98) moveEvent(99) moveEventCnt(100) speed(104) buffs(108)
    assert.equal(buf.readUInt8(66), 1);                  // hairMesh
    assert.equal(buf.readUInt32LE(67), 0xff0000ff);      // hairColor
    assert.equal(buf.readUInt8(71), 3);                  // headMesh
    assert.equal(buf.readUInt32LE(72), 11);              // strlen "MaDa_Homeit"
    assert.equal(buf.subarray(76, 87).toString('ascii'), 'MaDa_Homeit');
    assert.equal(buf.readUInt8(87), 3);                  // uSize
    assert.equal(buf.readUInt8(88), 2);                  // equip0 parts (PARTS_UPPER_BODY)
    assert.equal(buf.readUInt16LE(89), 1029);            // equip0 itemId (RIN_SUIT06)
    assert.equal(buf.readUInt8(91), 4);                  // equip1 parts (PARTS_HAND)
    assert.equal(buf.readUInt16LE(92), 1329);            // equip1 itemId (RIN_GAUNTLET06)
    assert.equal(buf.readUInt8(94), 5);                  // equip2 parts (PARTS_FOOT)
    assert.equal(buf.readUInt16LE(95), 1629);            // equip2 itemId (RIN_BOOTS06)
    assert.equal(buf.readFloatLE(104), 1.0);             // m_fSpeedFactor
    assert.equal(buf.readUInt32LE(108), 0);              // buff count
  });

  it('chains multiple entries and bumps cb', () => {
    const buf = serializer.build([
      makeMonster(0x40000000, 1),
      makeMonster(0x40000001, 2),
    ]);
    assert.equal(buf.readUInt16LE(8), 2);
    assert.equal(buf.length, 10 + 2 * 82); // 174
    assert.equal(buf.readUInt32LE(92), 0x40000001); // second objid after frame+entry0
  });

  it('emits characterKey for a dialog-only NPC with no outfit (menu fix)', () => {
    const buf = serializer.build([makeDialogNpc(0x40000002)]);
    // Frame(10) + entry: monster base 82 + 11 chars "MaFl_Mikyel" = 93 -> 103.
    assert.equal(buf.length, 103);
    // Same NPC-branch layout as the equipped case up to uSize; key present,
    // hair/head zeroed, equip empty.
    assert.equal(buf.readUInt8(66), 0);                  // hairMesh
    assert.equal(buf.readUInt32LE(67), 0);               // hairColor
    assert.equal(buf.readUInt8(71), 0);                  // headMesh
    assert.equal(buf.readUInt32LE(72), 11);              // strlen "MaFl_Mikyel"
    assert.equal(buf.subarray(76, 87).toString('ascii'), 'MaFl_Mikyel');
    assert.equal(buf.readUInt8(87), 0);                  // uSize -- no equip parts
  });
});
