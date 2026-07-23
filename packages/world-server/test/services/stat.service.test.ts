import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player';
import { StatService } from '../../src/services/stat.service';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_SETSTATE } from '../../src/net/snapshot/constants';
import type { CharacterRow } from '@flyff/database';

/** Minimal CharacterRow for CPlayer.fromRow (mirrors player.test.ts). */
function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'TestHero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0, face_style: 3, skin_color: 1,
    level: 15, exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15, remain_gp: 0,
    x: 0, y: 0, z: 0, world_id: 'MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSocket() {
  const written: Buffer[] = [];
  return { write: (b: Buffer) => { written.push(b); return true; }, _written: written };
}

interface MockDeps {
  service: StatService;
  sent: Buffer[];
  journal: { type: string; payload: unknown }[];
  updateStatsCalls: Partial<{ strength: number; stamina: number; dexterity: number; intelligence: number; remain_gp: number }>[];
}

function makeService(): MockDeps {
  const sent: Buffer[] = [];
  const journal: { type: string; payload: unknown }[] = [];
  const updateStatsCalls: MockDeps['updateStatsCalls'] = [];
  const deps = {
    playerManager: { sendTo: (_p: unknown, b: Buffer) => { sent.push(b); } },
    charRepo: { updateStats: async (_id: number, s: MockDeps['updateStatsCalls'][number]) => { updateStatsCalls.push(s); } },
    journal: { append: (e: { type: string; payload: unknown }) => journal.push(e) },
  };
  const service = new StatService(deps);
  return { service, sent, journal, updateStatsCalls };
}

/** Read the DWORD at byte offset `off` (LE) from a buffer. */
function dwordAt(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off);
}

describe('StatService.applyStatPoints', () => {
  it('applies a valid allocation, decrements remainGP, journals + persists + echoes SETSTATE', () => {
    const p = CPlayer.fromRow(makeRow({ remain_gp: 10 }), makeSocket());
    const m = makeService();

    const out = m.service.applyStatPoints(p, { str: 2, sta: 1, dex: 0, int: 1 });

    assert.equal(out.ok, true);
    assert.equal(p.m_nStr, 17, 'STR 15 + 2');
    assert.equal(p.m_nSta, 16, 'STA 15 + 1');
    assert.equal(p.m_nDex, 15, 'DEX unchanged');
    assert.equal(p.m_nInt, 16, 'INT 15 + 1');
    assert.equal(p.m_nRemainGP, 6, 'remainGP 10 - 4');
    assert.ok(p._dirty.has('strength') && p._dirty.has('remain_gp'), 'dirty flags set');

    // WAL journal is ABSOLUTE post-state (idempotent replay).
    assert.equal(m.journal.length, 1);
    assert.equal(m.journal[0]!.type, 'CHAR_STATS');
    const payload = m.journal[0]!.payload as Record<string, number>;
    assert.deepEqual(
      { strength: payload.strength, stamina: payload.stamina, dexterity: payload.dexterity, intelligence: payload.intelligence, remain_gp: payload.remain_gp },
      { strength: 17, stamina: 16, dexterity: 15, intelligence: 16, remain_gp: 6 },
    );

    // Persisted fire-and-forget.
    assert.equal(m.updateStatsCalls.length, 1);
    assert.equal(m.updateStatsCalls[0]!.remain_gp, 6);

    // SETSTATE snapshot echoed to self only. build() is unframed: payload
    // starts at the SNAPSHOT DWORD (PacketWriter.build concatenates raw writes).
    assert.equal(m.sent.length, 1);
    const snap = m.sent[0]!;
    assert.equal(dwordAt(snap, 0), PACKETTYPE.SNAPSHOT, 'wrapped in SNAPSHOT');
    // [SNAPSHOT:4][NULL_ID:4][count:2][objid:4][SETSTATE:2] then str/sta/dex/int/lp/gp
    const typeWord = snap.readUInt16LE(14);
    assert.equal(typeWord, SNAPSHOTTYPE_SETSTATE, 'snapshot subtype is SETSTATE');
    const gp = dwordAt(snap, 16 + 4 * 5); // str/sta/dex/int/lp precede remainGP
    assert.equal(gp, 6, 'remainGP DWORD in SETSTATE body');
  });

  it('rejects any negative count', () => {
    const p = CPlayer.fromRow(makeRow({ remain_gp: 10 }), makeSocket());
    const m = makeService();
    const out = m.service.applyStatPoints(p, { str: -1, sta: 0, dex: 0, int: 0 });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'negative');
    assert.equal(p.m_nRemainGP, 10, 'unchanged');
    assert.equal(m.sent.length, 0, 'no echo on reject');
    assert.equal(m.journal.length, 0, 'no journal on reject');
  });

  it('rejects an all-zero allocation (sum must be > 0)', () => {
    const p = CPlayer.fromRow(makeRow({ remain_gp: 10 }), makeSocket());
    const m = makeService();
    const out = m.service.applyStatPoints(p, { str: 0, sta: 0, dex: 0, int: 0 });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'empty');
  });

  it('rejects when the sum exceeds remainGP', () => {
    const p = CPlayer.fromRow(makeRow({ remain_gp: 3 }), makeSocket());
    const m = makeService();
    const out = m.service.applyStatPoints(p, { str: 2, sta: 2, dex: 0, int: 0 });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'insufficient');
    assert.equal(p.m_nStr, 15, 'STR unchanged');
    assert.equal(p.m_nRemainGP, 3, 'remainGP unchanged');
  });

  it('accepts an exact-spend allocation (sum === remainGP -> 0)', () => {
    const p = CPlayer.fromRow(makeRow({ remain_gp: 5 }), makeSocket());
    const m = makeService();
    const out = m.service.applyStatPoints(p, { str: 5, sta: 0, dex: 0, int: 0 });
    assert.equal(out.ok, true);
    assert.equal(p.m_nStr, 20);
    assert.equal(p.m_nRemainGP, 0);
  });
});
