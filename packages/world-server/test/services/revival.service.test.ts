/**
 * RevivalService unit tests -- death flag/broadcast + the 3 revive branches.
 * Mock managers capture broadcasts + self-sends; snapshot subtypes verified.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RevivalService } from '../../src/services/revival.service';
import { CPlayer } from '../../src/entities/player';
import type { CharacterRow } from '@flyff/database';
import { II_SYS_SYS_SCR_RESURRECTION } from '../../src/combat/aiConstants';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

function snapshotSubtype(payload: Buffer): number {
  return payload.readUInt16LE(14);
}

function makeDeps(zoneRevival = { x: 6978, y: 100, z: 3329 }) {
  const broadcasts: Buffer[] = [];
  const sends: Buffer[] = [];
  const journal: Array<{ charId: number; type: string; payload: unknown }> = [];
  const repoExp: Array<{ id: number; level: number; exp: bigint }> = [];
  const repoInv: Array<{ id: number; slot: number; qty?: number }> = [];
  return {
    broadcasts, sends, journal, repoExp, repoInv,
    deps: {
      charRepo: {
        updateLevelAndExp: async (id: number, level: number, exp: bigint) => {
          repoExp.push({ id, level, exp });
        },
      },
      inventoryRepo: {
        updateQuantity: async (id: number, slot: number, qty: number) => {
          repoInv.push({ id, slot, qty });
        },
        removeItem: async (id: number, slot: number) => {
          repoInv.push({ id, slot });
        },
      },
      journal: { append: (e: { charId: number; type: string; payload: unknown }) => journal.push(e) },
      zoneManager: {
        broadcastAround: (_p: unknown, _z: number, _r: number, buf: Buffer) => {
          broadcasts.push(buf);
          return 1;
        },
      },
      playerManager: { sendTo: (_p: unknown, buf: Buffer) => { sends.push(buf); } },
      zones: { byNumericId: new Map([[1, { revival: { position: zoneRevival } }]]) },
    },
  };
}

describe('RevivalService', () => {
  it('onPlayerDeath sets dead flag, broadcasts MOVERDEATH, sends ACTMSG STOP+DIE to self', () => {
    const { deps, broadcasts, sends } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_nHp = 0;

    svc.onPlayerDeath(p, 0x40000000);

    assert.equal(p.m_bDead, true);
    // Vicinity: MOVERDEATH (0x00c7).
    assert.equal(snapshotSubtype(broadcasts[0]), 0x00c7);
    // Self: ACTMSG STOP + ACTMSG DIE.
    assert.equal(sends.length, 2);
    assert.equal(snapshotSubtype(sends[0]), 0x0002);
    assert.equal(snapshotSubtype(sends[1]), 0x0002);
  });

  it('onPlayerDeath is idempotent (double-trigger does not double-broadcast)', () => {
    const { deps, broadcasts } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_nHp = 0;

    svc.onPlayerDeath(p, 0x40000000);
    svc.onPlayerDeath(p, 0x40000000);
    assert.equal(broadcasts.length, 1);
  });

  it('revive SCROLL rejects when not dead', () => {
    const { deps } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_nHp = 100;
    assert.deepEqual(svc.revive(p, 'SCROLL'), { ok: false, reason: 'not_dead' });
  });

  it('revive SCROLL rejects when no scroll in inventory', () => {
    const { deps } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_bDead = true;
    p.m_nHp = 0;
    assert.deepEqual(svc.revive(p, 'SCROLL'), { ok: false, reason: 'no_scroll' });
  });

  it('revive SCROLL consumes 1 scroll, restores HP to 20%, no exp penalty', () => {
    const { deps, broadcasts, journal } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow({ level: 30, exp: 5000n }), { write: () => true });
    p.m_nMaxHp = 200; // formula-derived in fromRow; pin to the test's ceiling
    p.m_bDead = true;
    p.m_nHp = 0;
    p.m_nExp = 100;
    p.m_Inventory[0] = { itemId: II_SYS_SYS_SCR_RESURRECTION, count: 3 };

    const out = svc.revive(p, 'SCROLL');
    assert.equal(out.ok, true);
    assert.equal(p.m_Inventory[0]?.count, 2); // decremented, not removed
    assert.equal(p.m_bDead, false);
    assert.equal(p.m_nHp, 40); // floor(200 * 0.2)
    assert.equal(p.m_nExp, 100); // unchanged -- no penalty on scroll revive
    assert.equal(journal[0].type, 'INVENTORY_SLOT');
    assert.deepEqual(journal[0].payload, { slot: 0, itemId: II_SYS_SYS_SCR_RESURRECTION, count: 2 });
    assert.equal(snapshotSubtype(broadcasts[0]), 0x00a1); // SNAPSHOTTYPE_REVIVAL
  });

  it('revive SCROLL removes the slot when the last scroll is consumed', () => {
    const { deps } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_bDead = true;
    p.m_nHp = 0;
    p.m_Inventory[5] = { itemId: II_SYS_SYS_SCR_RESURRECTION, count: 1 };

    svc.revive(p, 'SCROLL');
    assert.equal(p.m_Inventory[5], null);
  });

  it('revive LODESTAR applies exp penalty, teleports to revival pos, broadcasts', () => {
    const { deps, broadcasts, sends, journal, repoExp } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow({ level: 30 }), { write: () => true });
    p.m_bDead = true;
    p.m_nHp = 0;
    p.m_nExp = 50_000; // within-level exp (set directly to bypass cumulative conversion)
    const expBefore = p.m_nExp;

    const out = svc.revive(p, 'LODESTAR');
    assert.equal(out.ok, true);
    assert.equal(p.m_bDead, false);
    assert.equal(p.m_nExp < expBefore, true); // exp penalty applied
    assert.equal(journal.some((j) => j.type === 'CHAR_EXP'), true);
    assert.equal(repoExp.length, 1); // persisted
    // Teleported to the zone revival position.
    assert.equal(p.m_vPos.x, 6978);
    // SETEXPERIENCE self-send (exp loss) + SETPOS self-send (same-world teleport).
    assert.equal(sends.length >= 2, true);
    const setpos = sends.find((b) => snapshotSubtype(b) === 0x0010); // SNAPSHOTTYPE_SETPOS
    assert.equal(setpos !== undefined, true);
    assert.equal(snapshotSubtype(broadcasts[0]), 0x00a2); // SNAPSHOTTYPE_REVIVAL_TO_LODESTAR
  });

  it('revive LODESTAR skips exp penalty at level <= 20', () => {
    const { deps, journal } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow({ level: 15 }), { write: () => true });
    p.m_bDead = true;
    p.m_nHp = 0;
    p.m_nExp = 50;

    svc.revive(p, 'LODESTAR');
    assert.equal(p.m_nExp, 50); // no loss
    assert.equal(journal.some((j) => j.type === 'CHAR_EXP'), false);
  });

  it('revive LODELIGHT is rejected (C++ empty stub)', () => {
    const { deps } = makeDeps();
    const svc = new RevivalService(deps);
    const p = CPlayer.fromRow(makeRow(), { write: () => true });
    p.m_bDead = true;
    p.m_nHp = 0;
    assert.deepEqual(svc.revive(p, 'LODELIGHT'), { ok: false, reason: 'lodelight_unsupported' });
  });
});
