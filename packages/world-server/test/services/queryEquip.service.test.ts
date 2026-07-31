/**
 * QueryEquipService / QueryEquipSerializer tests -- 0xf000d009 + 0xf000d00a.
 *
 * Covers the C++ gates from `DPSrvr::OnQueryEquip` (DPSrvr.cpp:7128): unknown
 * target drops silently, EQUIP_DENIAL_MODE refuses non-GMs with the arg-less
 * DEFINEDTEXT1 form, GMs bypass the bit, and the emitted body is byte-exact vs
 * `CUser::AddQueryEquip` (User.cpp:2635).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, MODE, AUTH, MAX_INVENTORY } from '@flyff/entities';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { SNAPSHOTTYPE_MODIFYMODE } from '@flyff/world-core';
import { QueryEquipService, TID_DIAG_0088 } from '../../src/services/queryEquip.service';

interface Sent { readonly buf: Buffer }

function makePlayer(charId: number, authority = AUTH.GENERAL): CPlayer {
  const p = Object.create(CPlayer.prototype) as CPlayer & { m_Inventory: unknown[] };
  p.m_idPlayer = charId;
  p.m_bAuthority = authority;
  p.m_dwMode = 0;
  p.m_nZoneId = 1;
  p.m_vPos = { x: 0, y: 0, z: 0 };
  p.m_Inventory = new Array(73).fill(undefined);
  return p as CPlayer;
}

function makeDeps(players: readonly CPlayer[]) {
  const sent: Sent[] = [];
  const broadcasts: Sent[] = [];
  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    sendTo: (_p: CPlayer, buf: Buffer) => { sent.push({ buf }); },
  } as unknown as ConstructorParameters<typeof QueryEquipService>[0]['playerManager'];
  const zoneManager = {
    broadcastAround: (_pos: unknown, _z: number, _r: number, buf: Buffer) => {
      broadcasts.push({ buf }); return 1;
    },
  } as unknown as ConstructorParameters<typeof QueryEquipService>[0]['zoneManager'];
  return { deps: { playerManager, zoneManager }, sent, broadcasts };
}

/** Strip the SNAPSHOT/NULL_ID/count preamble and return objid + subtype + body reader. */
function openSnapshot(buf: Buffer): { objid: number; subtype: number; r: PacketReader } {
  const r = new PacketReader(buf);
  assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
  r.readDword();                       // objidPlayer
  assert.equal(r.readWord(), 1);       // cb
  const objid = r.readDword();
  const subtype = r.readWord();
  return { objid, subtype, r };
}

describe('QueryEquipService', () => {
  it('drops silently when the target is not in world', () => {
    const me = makePlayer(1);
    const { deps, sent } = makeDeps([me]);
    const out = new QueryEquipService(deps).queryEquip(me, 999);
    assert.deepEqual(out, { ok: false, reason: 'not-found' });
    assert.equal(sent.length, 0);
  });

  it('refuses a non-GM when the target set EQUIP_DENIAL_MODE, via DEFINEDTEXT1', () => {
    const me = makePlayer(1);
    const target = makePlayer(2);
    target.m_dwMode |= MODE.EQUIP_DENIAL;
    const { deps, sent } = makeDeps([me, target]);

    const out = new QueryEquipService(deps).queryEquip(me, 2);
    assert.deepEqual(out, { ok: false, reason: 'denied' });
    assert.equal(sent.length, 1);

    // Arg-less form: subtype 0x0094 and NO trailing string (User.cpp:2246).
    const { objid, subtype, r } = openSnapshot(sent[0]!.buf);
    assert.equal(objid, 1);                              // sent to self
    assert.equal(subtype, SNAPSHOTTYPE.DEFINEDTEXT1);
    assert.equal(r.readDword(), TID_DIAG_0088);
    assert.equal(r.remaining, 0);
  });

  it('lets a GM bypass EQUIP_DENIAL_MODE', () => {
    const gm = makePlayer(1, AUTH.GAMEMASTER);
    const target = makePlayer(2);
    target.m_dwMode |= MODE.EQUIP_DENIAL;
    const { deps, sent } = makeDeps([gm, target]);

    const out = new QueryEquipService(deps).queryEquip(gm, 2);
    assert.deepEqual(out, { ok: true, parts: 0 });
    assert.equal(openSnapshot(sent[0]!.buf).subtype, SNAPSHOTTYPE.QUERYEQUIP);
  });

  it('emits one entry per occupied equip part, byte-exact vs AddQueryEquip', () => {
    const me = makePlayer(1);
    const target = makePlayer(2);
    // Parts 0 and 5 occupied; the rest empty.
    target.m_Inventory[MAX_INVENTORY + 0] =
      { itemId: 111, count: 1, element: 3, element_level: 7 };
    target.m_Inventory[MAX_INVENTORY + 5] =
      { itemId: 222, count: 1 };                 // no element fields -> 0/0
    const { deps, sent } = makeDeps([me, target]);

    const out = new QueryEquipService(deps).queryEquip(me, 2);
    assert.deepEqual(out, { ok: true, parts: 2 });

    const { objid, subtype, r } = openSnapshot(sent[0]!.buf);
    assert.equal(objid, 2);                       // header carries the INSPECTED objid
    assert.equal(subtype, SNAPSHOTTYPE.QUERYEQUIP);
    assert.equal(r.readDword(), 2);               // int cbEquip

    // Entry 1 -- part 0.
    assert.equal(r.readDword(), 0);               // nParts
    assert.equal(r.readQword(), 0n);               // randomOptItemId (unmodelled)
    assert.equal(r.readDword(), 0);               // piercingSize
    assert.equal(r.readDword(), 0);               // ultimatePiercingSize
    assert.equal(r.readDword(), 0);               // petVis size
    assert.equal(r.readByte(), 3);                // m_bItemResist
    assert.equal(r.readDword(), 7);               // m_nResistAbilityOption

    // Entry 2 -- part 5, unset element fields default to 0.
    assert.equal(r.readDword(), 5);
    assert.equal(r.readQword(), 0n);
    r.readDword(); r.readDword(); r.readDword();
    assert.equal(r.readByte(), 0);
    assert.equal(r.readDword(), 0);
    assert.equal(r.remaining, 0);
  });

  it('setAllowInspect toggles the mode bit and broadcasts MODIFYMODE', () => {
    const me = makePlayer(1);
    const { deps, broadcasts } = makeDeps([me]);
    const svc = new QueryEquipService(deps);

    svc.setAllowInspect(me, false);
    assert.equal(me.m_dwMode & MODE.EQUIP_DENIAL, MODE.EQUIP_DENIAL);
    const { subtype, r } = openSnapshot(broadcasts[0]!.buf);
    assert.equal(subtype, SNAPSHOTTYPE_MODIFYMODE);
    assert.equal(r.readDword(), MODE.EQUIP_DENIAL);

    svc.setAllowInspect(me, true);
    assert.equal(me.m_dwMode & MODE.EQUIP_DENIAL, 0);
    assert.equal(broadcasts.length, 2);
  });
});
