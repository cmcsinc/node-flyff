import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QueryGetDestObjService } from '../../src/services/queryGetDestObj.service';
import { DestObjSerializer } from '../../src/net/snapshot/destObj.serializer';
import { SNAPSHOTTYPE_GETDESTOBJ, NULL_ID } from '../../src/net/snapshot/constants';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

const requester = { m_idPlayer: 1 } as unknown as CPlayer;

/** PlayerManager whose `get` returns `mover` for objid 100, else undefined. */
function pm(mover: CPlayer | undefined): PlayerManager {
  return { get: (id: number) => (id === 100 ? mover : undefined) } as unknown as PlayerManager;
}

function moverOf(objid: number, dest: number, range: number): CPlayer {
  return { m_idPlayer: objid, m_idDestObj: dest, m_fArrivalRange: range } as unknown as CPlayer;
}

describe('QueryGetDestObjService', () => {
  it('replies with SNAPSHOT/GETDESTOBJ when the mover has a destination', () => {
    const svc = new QueryGetDestObjService(pm(moverOf(100, 200, 1.5)), new DestObjSerializer());
    const out = svc.query(requester, 100);
    assert.ok(out.reply instanceof Buffer);
    const b = out.reply!;
    // [SNAPSHOT DWORD][NULL_ID DWORD][cb=1 WORD][objid 100][0x004a][dest 200][1.5f]
    assert.equal(b.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(b.readUInt32LE(4), NULL_ID);
    assert.equal(b.readUInt16LE(8), 1);
    assert.equal(b.readUInt32LE(10), 100);
    assert.equal(b.readUInt16LE(14), SNAPSHOTTYPE_GETDESTOBJ);
    assert.equal(b.readUInt32LE(16), 200);
    assert.equal(b.readFloatLE(20), 1.5);
  });

  it('replies nothing when the mover has no destination (IsEmptyDestObj)', () => {
    const svc = new QueryGetDestObjService(pm(moverOf(100, NULL_ID, 0)), new DestObjSerializer());
    const out = svc.query(requester, 100);
    assert.equal(out.reply, undefined);
  });

  it('replies nothing when the mover is unknown', () => {
    const svc = new QueryGetDestObjService(pm(undefined), new DestObjSerializer());
    const out = svc.query(requester, 999);
    assert.equal(out.reply, undefined);
  });

  it('replies nothing for NULL_ID objid', () => {
    const svc = new QueryGetDestObjService(pm(moverOf(100, 200, 1.5)), new DestObjSerializer());
    const out = svc.query(requester, NULL_ID);
    assert.equal(out.reply, undefined);
  });
});
