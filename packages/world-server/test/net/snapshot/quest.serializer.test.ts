import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import {
  writeQuestStruct,
  buildSetQuest,
  buildRemoveQuest,
  buildCheckedQuest,
  buildQuestTextTime,
  buildNpcPos,
  type RuntimeQuest,
} from '../../../src/net/snapshot/quest.serializer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import {
  SNAPSHOTTYPE_SETQUEST,
  SNAPSHOTTYPE_QUEST_REMOVE,
  SNAPSHOTTYPE_QUEST_CHECKED,
  SNAPSHOTTYPE_QUEST_TEXT_TIME,
  SNAPSHOTTYPE_QUESTHELPER_NPCPOS,
  NULL_ID,
} from '../../../src/net/snapshot/constants.js';

const sample: RuntimeQuest = {
  state: 7, time: 300, id: 42, killNpcNum: [3, 5], flags: 0b11,
};

describe('quest.serializer.ts', () => {
  it('writeQuestStruct emits exactly 12 bytes with the C++ field layout', () => {
    const w = new PacketWriter();
    writeQuestStruct(w, sample);
    const b = w.build();
    assert.equal(b.length, 12);
    assert.equal(b[0], 7);                       // m_nState
    assert.equal(b[1], 0);                       // pad
    assert.equal(b.readUInt16LE(2), 300);        // m_wTime
    assert.equal(b.readUInt16LE(4), 42);         // m_wId
    assert.equal(b.readUInt16LE(6), 3);          // killNPCNum[0]
    assert.equal(b.readUInt16LE(8), 5);          // killNPCNum[1]
    assert.equal(b[10], 0b11);                   // flags
    assert.equal(b[11], 0);                      // pad
  });

  it('buildSetQuest wraps the 12B struct in a SNAPSHOT/SETQUEST frame', () => {
    const b = buildSetQuest(0x100, sample);
    // SNAPSHOT dword | NULL_ID dword | count word | objid dword | subtype word | 12B
    assert.equal(b.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(b.readUInt32LE(4), NULL_ID);
    assert.equal(b.readUInt16LE(8), 1);
    assert.equal(b.readUInt32LE(10), 0x100);
    assert.equal(b.readUInt16LE(14), SNAPSHOTTYPE_SETQUEST);
    assert.equal(b.length, 16 + 12);
    assert.equal(b[16], 7);                      // state byte of embedded struct
  });

  it('buildRemoveQuest writes int32 type + DWORD questId', () => {
    const b = buildRemoveQuest(0x100, -1, 42);
    assert.equal(b.readUInt16LE(14), SNAPSHOTTYPE_QUEST_REMOVE);
    assert.equal(b.readInt32LE(16), -1);         // nRemoveType (signed)
    assert.equal(b.readUInt32LE(20), 42);        // dwQuestCancelID
    assert.equal(b.length, 16 + 8);
  });

  it('buildCheckedQuest writes BYTE size + size*WORD', () => {
    const b = buildCheckedQuest(0x100, [7, 8, 9]);
    assert.equal(b.readUInt16LE(14), SNAPSHOTTYPE_QUEST_CHECKED);
    assert.equal(b[16], 3);
    assert.equal(b.readUInt16LE(17), 7);
    assert.equal(b.readUInt16LE(19), 8);
    assert.equal(b.readUInt16LE(21), 9);
    assert.equal(b.length, 17 + 6);
  });

  it('buildQuestTextTime writes BOOL + int state + DWORD time', () => {
    const b = buildQuestTextTime(0x100, true, 2, 600);
    assert.equal(b.readUInt16LE(14), SNAPSHOTTYPE_QUEST_TEXT_TIME);
    assert.equal(b.readUInt32LE(16), 1);         // bFlag
    assert.equal(b.readInt32LE(20), 2);          // nState
    assert.equal(b.readUInt32LE(24), 600);       // dwTime
    assert.equal(b.length, 16 + 12);
  });

  it('buildNpcPos writes 3 floats', () => {
    const b = buildNpcPos(0x100, { x: 1.5, y: 2.5, z: 3.5 });
    assert.equal(b.readUInt16LE(14), SNAPSHOTTYPE_QUESTHELPER_NPCPOS);
    assert.equal(b.readFloatLE(16), 1.5);
    assert.equal(b.readFloatLE(20), 2.5);
    assert.equal(b.readFloatLE(24), 3.5);
    assert.equal(b.length, 16 + 12);
  });
});
