/**
 * Unit tests for `ChangeJobServiceImpl` -- the `ChangeJob(n)` dialog sink.
 *
 * Validates the C++ `DPSrvr.cpp:4697-4719` + `AddChangeJob` (MoverParam.cpp:1727)
 * port: Vagrant level-15 gate, expert/pro job range, roster re-seed, WAL journal,
 * SET_JOB_SKILL (self) + SET_NEAR_JOB_SKILL (vicinity) snapshots, class persist.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { ChangeJobServiceImpl } from '../../src/services/changeJob.service';
import { SNAPSHOTTYPE_SET_JOB_SKILL, SNAPSHOTTYPE_SET_NEAR_JOB_SKILL, NULL_ID } from '@flyff/world-core';

/** Minimal CharacterRow for CPlayer.fromRow (mirrors stat.service.test.ts). */
function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'TestHero', slot: 0, class: 0, gender: 0,
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
  service: ChangeJobServiceImpl;
  sent: Buffer[];
  broadcast: Buffer[];
  journal: { type: string; payload: unknown }[];
  updateClassCalls: { id: number; classId: number }[];
}

/** Build the service with mocked deps + a 2-skill Knight roster (job 6). */
function makeService(): MockDeps {
  const sent: Buffer[] = [];
  const broadcast: Buffer[] = [];
  const journal: { type: string; payload: unknown }[] = [];
  const updateClassCalls: MockDeps['updateClassCalls'] = [];
  const deps = {
    charRepo: { updateClass: async (id: number, classId: number) => { updateClassCalls.push({ id, classId }); } },
    skills: {
      skills: new Map([
        [150, { id: 150, tier: 2, job: 6, reqLevel: 60 }], // PRO, Knight
        [151, { id: 151, tier: 2, job: 6, reqLevel: 65 }], // PRO, Knight
        [152, { id: 152, tier: 1, job: 1, reqLevel: 5 }],  // EXPERT, Mercenary (lineage)
      ]),
    },
    playerManager: { sendTo: (_p: unknown, b: Buffer) => { sent.push(b); } },
    zoneManager: {
      broadcastAround: (_pos: unknown, _z: number, _r: number, b: Buffer, _except?: unknown) => { broadcast.push(b); return 0; },
    },
    journal: { append: (e: { type: string; payload: unknown }) => journal.push(e) },
  };
  const service = new ChangeJobServiceImpl(deps as never);
  return { service, sent, broadcast, journal, updateClassCalls };
}

/** Read the WORD at byte offset `off` (LE). */
function wordAt(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off);
}
/** Read the DWORD at byte offset `off` (LE). */
function dwordAt(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off);
}

describe('ChangeJobServiceImpl.changeJob', () => {
  it('changes job for a level-15 vagrant: sets m_nJob, re-seeds roster, persists', () => {
    const p = CPlayer.fromRow(makeRow({ class: 0, level: 15 }), makeSocket());
    const m = makeService();

    m.service.changeJob(p, 6); // -> Knight

    assert.equal(p.m_nJob, 6, 'job set to Knight');
    assert.ok(p._dirty.has('m_nJob'), 'm_nJob flagged dirty');
    assert.ok(p._dirty.has('m_aJobSkill'), 'm_aJobSkill flagged dirty');
    // Roster re-seeded: the two Knight PRO skills now occupy the pro slots.
    const proSkills = p.m_aJobSkill.filter((s) => s.skillId !== NULL_ID).map((s) => s.skillId);
    assert.ok(proSkills.includes(150) && proSkills.includes(151), 'Knight skills seeded');
    // Persisted fire-and-forget.
    assert.equal(m.updateClassCalls.length, 1);
    assert.equal(m.updateClassCalls[0]!.classId, 6);
  });

  it('WAL-journals CHAR_JOB with absolute class + roster (idempotent replay)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService();

    m.service.changeJob(p, 6);

    assert.equal(m.journal.length, 1);
    assert.equal(m.journal[0]!.type, 'CHAR_JOB');
    const payload = m.journal[0]!.payload as { class: number; roster: Array<{ slot: number; skillId: number; level: number }> };
    assert.equal(payload.class, 6);
    assert.ok(payload.roster.length > 0, 'roster journaled');
  });

  it('emits SET_JOB_SKILL to self + SET_NEAR_JOB_SKILL to vicinity', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService();

    m.service.changeJob(p, 6);

    assert.equal(m.sent.length, 1, 'one packet to self');
    assert.equal(m.broadcast.length, 1, 'one packet to vicinity');
    // Packet layout: [SNAPSHOT:4][NULL_ID:4][count:2][objid:4][TYPE:2][body...]
    // TYPE is the WORD at offset 14; the nJob DWORD follows at offset 16.
    assert.equal(wordAt(m.sent[0]!, 14), SNAPSHOTTYPE_SET_JOB_SKILL, 'self = SET_JOB_SKILL');
    assert.equal(dwordAt(m.sent[0]!, 16), 6, 'SET_JOB_SKILL carries nJob=6');
    assert.equal(wordAt(m.broadcast[0]!, 14), SNAPSHOTTYPE_SET_NEAR_JOB_SKILL, 'vicinity = SET_NEAR_JOB_SKILL');
    assert.equal(dwordAt(m.broadcast[0]!, 16), 6, 'SET_NEAR_JOB_SKILL carries nJob=6');
  });

  it('rejects a vagrant below level 15 (C++ TID_GAME_CHGJOBLEVEL15)', () => {
    const p = CPlayer.fromRow(makeRow({ level: 14 }), makeSocket());
    const m = makeService();
    m.service.changeJob(p, 6);
    assert.equal(p.m_nJob, 0, 'job unchanged');
    assert.equal(m.sent.length, 0, 'no packets');
    assert.equal(m.journal.length, 0, 'no journal');
    assert.equal(m.updateClassCalls.length, 0, 'no persist');
  });

  it('rejects a non-vagrant (already changed job)', () => {
    const p = CPlayer.fromRow(makeRow({ class: 1, level: 15 }), makeSocket()); // Mercenary
    const m = makeService();
    m.service.changeJob(p, 6);
    assert.equal(p.m_nJob, 1, 'job unchanged');
    assert.equal(m.sent.length, 0);
    assert.equal(m.updateClassCalls.length, 0);
  });

  it('rejects an out-of-range target job (< 1 or > 15)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService();
    m.service.changeJob(p, 0);  // vagrant->vagrant invalid
    m.service.changeJob(p, 16); // past professional
    assert.equal(p.m_nJob, 0, 'job unchanged');
    assert.equal(m.updateClassCalls.length, 0);
  });
});
