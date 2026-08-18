/**
 * `MVRF_CRITICAL` one-shot party crit bonus -- service-level consumption tests.
 *
 * Ports the party arm of `GetCriticalProb` (`MoverAttack.cpp:697-707`). The
 * lookup + clear live in `CombatService` (the seam keeps `@flyff/combat` free of
 * a `@flyff/party` import); the resulting integer rides `Combatant.partyCritBonus`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CombatService } from '../../src/services/combat.service';
import type { Rng } from '../../src/combat/formulas';
import { CPlayer, CMover, MVRF, NULL_ID } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    remain_gp: 0, skill_point: 0, skill_level: 0,
    pk_propensity: 0, pk_value: 0, pk_time: 0, pk_exp: 0,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

/** Always-hit, never-crit, fixed-roll rng. */
function makeRng(): Rng {
  const seq = [0, 99, 50];
  let i = 0;
  return { int: () => seq[i++ % seq.length], range: () => 16 };
}

const MOVER_OPTS = {
  modelIndex: 20, name: 'Aibatt', level: 1, hp: 500,
  atkMin: 16, atkMax: 16, armor: 3, hr: 40, er: 3, expValue: 2,
};

let nextObjid = 0x40001000;

/** Fresh player + mover + service. `partySize` records the charIds it is asked about. */
function makeHarness(partySize?: (charId: number) => number) {
  const socket = { write: () => true };
  const player = CPlayer.fromRow(makeRow(), socket);
  player.m_nZoneId = 1;
  player.m_vPos = { x: 0, y: 0, z: 0 };
  const mover = CMover.spawn(nextObjid++, MOVER_OPTS, { x: 0, y: 0, z: 0 }, 1);
  const spawns = new Map([[mover.m_idMover, mover]]);
  const combat = new CombatService({
    // @ts-expect-error -- mock managers satisfy only the read surface
    spawnManager: { get: (id: number) => spawns.get(id), kill: () => {} },
    zoneManager: { broadcastAround: () => 1 },
    playerManager: { sendTo: () => {} },
    charRepo: { updateLevelAndExp: async () => {} },
    journal: { append: () => {} },
    rng: makeRng(),
    partySize,
  });
  return { player, mover, combat };
}

describe('MVRF_CRITICAL party crit bonus consumption', () => {
  it('a melee swing clears the armed flag', () => {
    const asked: number[] = [];
    const { player, mover, combat } = makeHarness((id) => { asked.push(id); return 6; });
    player.m_idParty = 77;
    player.m_dwFlag |= MVRF.CRITICAL;

    combat.resolveAttack(player, mover.m_idMover);

    assert.equal(player.m_dwFlag & MVRF.CRITICAL, 0, 'one-shot flag consumed');
    assert.deepEqual(asked, [player.m_idPlayer], 'partySize queried with the attacker charId');
  });

  it('the flag is cleared even when the party lookup fails (stale party id)', () => {
    // C++ clears m_dwFlag OUTSIDE the `pParty &&` guard (MoverAttack.cpp:707), so
    // a stale id still burns the charge.
    const { player, mover, combat } = makeHarness(() => 0);
    player.m_idParty = 999;
    player.m_dwFlag |= MVRF.CRITICAL;

    combat.resolveAttack(player, mover.m_idMover);

    assert.equal(player.m_dwFlag & MVRF.CRITICAL, 0, 'charge burned anyway');
  });

  it('a solo player (no party id) still spends the flag but is never looked up', () => {
    let calls = 0;
    const { player, mover, combat } = makeHarness(() => { calls++; return 8; });
    player.m_idParty = NULL_ID;
    player.m_dwFlag |= MVRF.CRITICAL;

    combat.resolveAttack(player, mover.m_idMover);

    assert.equal(player.m_dwFlag & MVRF.CRITICAL, 0);
    assert.equal(calls, 0, 'guarded by m_idparty, matching the C++ outer `if`');
  });

  it('no flag armed -> no party lookup at all', () => {
    let calls = 0;
    const { player, mover, combat } = makeHarness(() => { calls++; return 8; });
    player.m_idParty = 77;

    combat.resolveAttack(player, mover.m_idMover);

    assert.equal(calls, 0, 'cheap when the bonus is not armed (the steady state)');
  });

  it('a skill cast does NOT consume the flag', async () => {
    // `IsCriticalAttack` returns FALSE for any skill attack BEFORE reaching
    // `GetCriticalProb` (MoverAttack.cpp:800), so a skill never rolls crit and
    // never burns the charge.
    const { loadSkills } = await import('@flyff/resources');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/data');
    const idx = await loadSkills(dir);
    const skill = idx.skills.get(1);
    if (!skill) throw new Error('Clean Hit (id=1) not loaded');

    let calls = 0;
    const { player, mover, combat } = makeHarness(() => { calls++; return 8; });
    player.m_idParty = 77;
    player.m_dwFlag |= MVRF.CRITICAL;

    combat.resolveSkill(player, mover.m_idMover, skill, skill.levels[0]!);

    assert.equal(player.m_dwFlag & MVRF.CRITICAL, MVRF.CRITICAL, 'still armed after a skill');
    assert.equal(calls, 0);
  });
});
