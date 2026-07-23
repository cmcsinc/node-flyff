import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { ScriptDialogSerializer } from '../../../src/net/snapshot/scriptDialog.serializer';
import {
  NULL_ID,
  SNAPSHOTTYPE_RUNSCRIPTFUNC,
  FUNCTYPE_SAY,
  FUNCTYPE_ADDKEY,
  FUNCTYPE_REMOVEALLKEY,
  FUNCTYPE_EXIT,
} from '@flyff/world-core';

const PLAYER = 99;

/** Parse one SNAPSHOT/RUNSCRIPTFUNC frame back into its op list. */
function parse(buf: Buffer): { cb: number; ops: Array<Record<string, number | string>> } {
  const r = new PacketReader(buf);
  assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
  assert.equal(r.readDword(), NULL_ID);
  const cb = r.readWord();
  const ops: Array<Record<string, number | string>> = [];
  for (let i = 0; i < cb; i++) {
    assert.equal(r.readDword(), PLAYER, 'entry objid is the clicker');
    assert.equal(r.readWord(), SNAPSHOTTYPE_RUNSCRIPTFUNC);
    const funcType = r.readWord();
    const op: Record<string, number | string> = { funcType };
    if (funcType === FUNCTYPE_SAY) {
      op.text = r.readString();
      op.quest = r.readDword();
    } else if (funcType === FUNCTYPE_ADDKEY) {
      op.word = r.readString();
      op.key = r.readString();
      op.param = r.readDword();
      op.quest = r.readDword();
    }
    // REMOVEALLKEY / EXIT carry no payload.
    ops.push(op);
  }
  return { cb, ops };
}

describe('ScriptDialogSerializer', () => {
  it('wraps Say + AddKey + Exit in one SNAPSHOT frame (byte-exact via round-trip)', () => {
    const s = new ScriptDialogSerializer();
    const buf = s.build(PLAYER, [
      { type: 'removeAllKeys' },
      { type: 'say', text: 'hi' },
      { type: 'addKey', word: 'Buy', key: '1' },
      { type: 'exit' },
    ]);
    const { cb, ops } = parse(buf);
    assert.equal(cb, 4);
    assert.deepEqual(ops[0], { funcType: FUNCTYPE_REMOVEALLKEY });
    assert.deepEqual(ops[1], { funcType: FUNCTYPE_SAY, text: 'hi', quest: 0 });
    assert.deepEqual(ops[2], { funcType: FUNCTYPE_ADDKEY, word: 'Buy', key: '1', param: 0, quest: 0 });
    assert.deepEqual(ops[3], { funcType: FUNCTYPE_EXIT });
  });

  it('passes AddKey param + quest through', () => {
    const s = new ScriptDialogSerializer();
    const { ops } = parse(s.build(PLAYER, [
      { type: 'addKey', word: 'w', key: '2', param: 7, quest: 13 },
    ]));
    assert.equal(ops[0]!.param, 7);
    assert.equal(ops[0]!.quest, 13);
  });

  it('emits cb=0 for an empty op list', () => {
    const s = new ScriptDialogSerializer();
    const r = new PacketReader(s.build(PLAYER, []));
    r.readDword(); r.readDword();
    assert.equal(r.readWord(), 0);
  });
});
