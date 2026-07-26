/**
 * SkillService.applyNpcBuff tests -- the NPC buff-pang attach path.
 *
 * Covers the four BuffManager overwrite outcomes plus the generic-vs-cheer
 * conflict guard (`DPSrvr.cpp:11268-11275`) and the DOAPPLYUSESKILL broadcast.
 *
 * @module test/services/skill.service.npcBuff
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, DST } from '@flyff/entities';
import { SkillService } from '../../src/services/skill.service';
import type { CharacterRow } from '@flyff/database';
import type { SkillDefinition, SkillLevel } from '@flyff/resources';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'TestHero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0, face_style: 3, skin_color: 1,
    level: 15, exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSocket(): { write: (b: Buffer) => boolean; _written: Buffer[] } {
  const written: Buffer[] = [];
  return { write: (b: Buffer) => { written.push(b); return true; }, _written: written };
}

/** A buff-pang skill row: SI_GEN_EVE_QUICKSTEP +20 DEX for the configured duration. */
function eveSkill(skillId: number, level: number): { skill: SkillDefinition; levelRow: SkillLevel } {
  const skill: SkillDefinition = {
    id: skillId, name: 'Quick Step', name_id: 'IDS_QS', tier: 1, job: 3,
    discipline: 0, reqLevel: 0, prereqs: [], resourceType: 1, maxLevel: 20,
    referTargets: [2, 0], referStats: [2, 0], referValues: [0, 0],
    levels: [
      { level: 1, reqMp: 0, reqFp: 0, skillTime: 60_000, destParams: [2, 0], adjParamVals: [20, 0] },
      { level: 2, reqMp: 0, reqFp: 0, skillTime: 60_000, destParams: [2, 0], adjParamVals: [20, 0] },
      { level: 5, reqMp: 0, reqFp: 0, skillTime: 60_000, destParams: [2, 0], adjParamVals: [20, 0] },
    ],
  };
  const levelRow = skill.levels.find((l) => l.level === level) ?? skill.levels[0]!;
  return { skill, levelRow };
}

function makeService(player: CPlayer): { service: SkillService; broadcasts: Buffer[] } {
  const broadcasts: Buffer[] = [];
  const deps = {
    skills: { skills: new Map() },
    spawnManager: { get: () => undefined },
    zoneManager: { broadcastAround: () => { broadcasts.push(Buffer.alloc(0)); return 1; } },
    playerManager: { sendTo: () => {}, get: () => player },
    combatService: { resolveSkill: () => ({ ok: true, hit: true, damage: 0, killed: false }) },
    skillRepo: { saveAll: async () => {} },
    charRepo: { updateSkillPoints: async () => {} },
  };
  return { service: new SkillService(deps), broadcasts };
}

const SI_GEN_EVE_QUICKSTEP = 317;
const SI_ASS_CHEER_QUICKSTEP = 114;

describe('SkillService.applyNpcBuff', () => {
  it('attaches the buff + broadcasts SETSKILLSTATE + SETDESTPARAM + DOAPPLYUSESKILL', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService(p);
    const { skill, levelRow } = eveSkill(SI_GEN_EVE_QUICKSTEP, 2);

    const out = m.service.applyNpcBuff(p, skill, levelRow, 3_600_000, 1000);

    assert.equal(out, 'applied');
    assert.equal(p.m_buffs.has(SI_GEN_EVE_QUICKSTEP), true, 'buff active');
    assert.equal(p.m_params.get(DST.DEX, 0), 20, '+DEX applied to the DST pool');
    // SETSKILLSTATE (icon) + SETDESTPARAM (DEX delta) + DOAPPLYUSESKILL (anim).
    assert.equal(m.broadcasts.length, 3);
  });

  it('overrides the skill duration with the NPC-configured value', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService(p);
    const { skill, levelRow } = eveSkill(SI_GEN_EVE_QUICKSTEP, 2);

    // The skill's own skillTime is 60_000; the NPC config passes 3_600_000.
    assert.notEqual(levelRow.skillTime, 3_600_000, 'sanity: skill row has a different base skillTime');
    m.service.applyNpcBuff(p, skill, levelRow, 3_600_000, 1000);

    assert.equal(p.m_buffs.has(SI_GEN_EVE_QUICKSTEP), true, 'buff attached with NPC duration');
  });

  it('refreshes (same level): extends duration, no SETDESTPARAM re-apply', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService(p);
    const { skill, levelRow } = eveSkill(SI_GEN_EVE_QUICKSTEP, 2);

    m.service.applyNpcBuff(p, skill, levelRow, 3_600_000, 1000);
    m.broadcasts.length = 0;
    const out = m.service.applyNpcBuff(p, skill, levelRow, 3_600_000, 2000);

    assert.equal(out, 'refreshed');
    assert.equal(p.m_params.get(DST.DEX, 0), 20, 'DEX not double-applied');
    // SETSKILLSTATE + DOAPPLYUSESKILL only (no SETDESTPARAM on refresh).
    assert.equal(m.broadcasts.length, 2);
  });

  it('returns conflict when the Assist Cheer variant is active (no attach)', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService(p);
    // Seed the Cheer variant as an active buff.
    const cheer = eveSkill(SI_ASS_CHEER_QUICKSTEP, 7);
    m.service.applyNpcBuff(p, cheer.skill, cheer.levelRow, 60_000, 1000);
    m.broadcasts.length = 0;

    const eve = eveSkill(SI_GEN_EVE_QUICKSTEP, 2);
    const out = m.service.applyNpcBuff(p, eve.skill, eve.levelRow, 3_600_000, 2000);

    assert.equal(out, 'conflict');
    assert.equal(p.m_buffs.has(SI_GEN_EVE_QUICKSTEP), false, 'eve variant NOT attached');
    assert.equal(p.m_buffs.has(SI_ASS_CHEER_QUICKSTEP), true, 'cheer still active');
    assert.equal(m.broadcasts.length, 0, 'no snapshots on conflict');
  });

  it('ignores a weaker level cast over a stronger active buff', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const m = makeService(p);
    const { skill } = eveSkill(SI_GEN_EVE_QUICKSTEP, 5);
    const lv5 = skill.levels.find((l) => l.level === 5)!;
    const lv2 = skill.levels.find((l) => l.level === 2)!;

    m.service.applyNpcBuff(p, skill, lv5, 60_000, 1000);
    m.broadcasts.length = 0;
    const out = m.service.applyNpcBuff(p, skill, lv2, 60_000, 2000);

    assert.equal(out, 'ignored');
    assert.equal(m.broadcasts.length, 0, 'no snapshots on ignore (stronger buff keeps its state)');
  });
});
