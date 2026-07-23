/**
 * CombatService -- runs the v15 melee damage pipeline on a player->mover swing.
 *
 * Wires the pure {@link resolveMelee} math to live state: resolves the target
 * via `SpawnManager`, applies `MinusHP` to the mover, broadcasts the DAMAGE
 * snapshot (the per-mover HP sync), and on death grants exp (level-diff mult +
 * LimitExp cap + level-up cascade), broadcasts MOVERDEATH, and removes the
 * mover. Exp + level are WAL-journaled before the ack (rule 04).
 *
 * Server-authoritative (rule 03): the client's `dwAtkFlags`/`nParam3` never
 * enter the damage math -- hit/miss, crit, damage are all recomputed from
 * `CPlayer`/`CMover` stats via the injected `Rng`.
 *
 * ponytail: drops (propMoverEx.inc), respawn queue, equipped-weapon model,
 * hit-share party grouping, stealHP/skills -- see `docs/combat-plan.md`.
 *
 * @module services/combat
 */

import type { Journal } from '@flyff/database';
import type { CharacterRepository } from '@flyff/database';
import type { SkillDefinition, SkillLevel } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';
import type { SpawnManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import {
  resolveMelee, xRandomRng, expLevelDiffMult, addExp, cumulativeExp,
  type Rng, type MeleeResult,
} from '../combat/formulas';
import { resolveSkillCast } from '../combat/skillFormulas';
import { EXP_TABLE } from '@flyff/entities';
import { AF_MISS } from '../combat/tables';
import { playerCombatant, moverCombatant } from '../combat/combatants';
import type { ItemLookup } from '../combat/equipStats';
import { CHASE_WINDOW_MS, PURSUE_SPEED_FACTOR } from '@flyff/entities';
import { isMoverAttackableBy } from './combat.policy';
import { MODE } from '@flyff/entities';
import type { DropService } from './drop.service';
import { DamageSerializer } from '../net/snapshot/damage.serializer';
import { MoverDeathSerializer } from '../net/snapshot/moverDeath.serializer';
import { SetExperienceSerializer } from '../net/snapshot/setExperience.serializer';
import { SetLevelSerializer } from '../net/snapshot/setLevel.serializer';
import { DestObjSerializer } from '../net/snapshot/destObj.serializer';
import { DoUseSkillPointSerializer } from '../net/snapshot/doUseSkillPoint.serializer';
import { SetStateSerializer } from '../net/snapshot/setState.serializer';
import { VISIBILITY_RADIUS, NULL_ID } from '../net/snapshot/constants';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'combat-service' });

export interface CombatServiceDeps {
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
  playerManager: PlayerManager;
  charRepo: Pick<CharacterRepository, 'updateLevelAndExp' | 'updateSkillPoints' | 'updateStats'>;
  journal?: Journal;
  rng?: Rng;
  /**
   * Optional kill hook (Phase 7 -- wired to `QuestTrackerSystem.onKill`). Called
   * with the slain mover's `m_dwIndex` (MI_*) so active quests can increment
   * matching `SetEndCondKillNPC` slots.
   */
  questTracker?: { onKill(killer: CPlayer, victimModelIdx: number): void };
  /** Optional drop-roller (Phase A-C). Spawns ground piles for the kill. */
  dropService?: DropService;
  /** Optional item-definition lookup -- folds equipped weapon/armor into ATK/DEF. */
  getItem?: ItemLookup;
}

export type CombatOutcome =
  | { ok: true; hit: boolean; damage: number; killed: boolean }
  | { ok: false; reason: 'invalid_target' | 'target_dead' | 'target_not_attackable' };

export class CombatService {
  private readonly damage = new DamageSerializer();
  private readonly death = new MoverDeathSerializer();
  private readonly setExp = new SetExperienceSerializer();
  private readonly setLevel = new SetLevelSerializer();
  private readonly destObj = new DestObjSerializer();
  private readonly douseSkillPoint = new DoUseSkillPointSerializer();
  private readonly setState = new SetStateSerializer();
  private readonly rng: Rng;
  constructor(private readonly deps: CombatServiceDeps) {
    this.rng = deps.rng ?? xRandomRng;
  }

  /** Resolve a melee swing from `player` onto `targetObjid`. */
  resolveAttack(player: CPlayer, targetObjid: number): CombatOutcome {
    const t = this.resolveTarget(player, targetObjid);
    if (!t.ok) return t;
    const result = resolveMelee(playerCombatant(player, this.deps.getItem), moverCombatant(t.mover), this.rng);
    return this.applyHit(player, t.mover, this.withOneKill(player, t.mover, result));
  }

  /**
   * Resolve a skill cast's damage from `player` onto `targetObjid`. Same target
   * validation + DAMAGE broadcast + death/exp/rage tail as `resolveAttack`; only
   * the ATK source differs (`resolveSkillCast` from `skillFormulas.ts`).
   */
  resolveSkill(
    player: CPlayer,
    targetObjid: number,
    skill: SkillDefinition,
    level: SkillLevel,
  ): CombatOutcome {
    const t = this.resolveTarget(player, targetObjid);
    if (!t.ok) return t;
    const result = resolveSkillCast({
      attacker: playerCombatant(player, this.deps.getItem),
      defender: moverCombatant(t.mover),
      skill, level, rng: this.rng,
    });
    return this.applyHit(player, t.mover, this.withOneKill(player, t.mover, result));
  }

  /** Shared target validation for melee + skill swings. */
  private resolveTarget(
    player: CPlayer,
    targetObjid: number,
  ): { ok: true; mover: CMover } | { ok: false; reason: 'invalid_target' | 'target_dead' | 'target_not_attackable' } {
    const mover = this.deps.spawnManager.get(targetObjid);
    if (mover === undefined) return { ok: false, reason: 'invalid_target' };
    if (mover.m_bDead) return { ok: false, reason: 'target_dead' };
    if (!isMoverAttackableBy(player, mover)) return { ok: false, reason: 'target_not_attackable' };
    return { ok: true, mover };
  }

  /** `/ok` ONEKILL_MODE override -- GM one-shot forces lethal damage. */
  private withOneKill(player: CPlayer, mover: CMover, result: MeleeResult): MeleeResult {
    if ((player.m_dwMode & MODE.ONEKILL) === 0) return result;
    return { hit: true, damage: mover.m_nHitPoint, atkFlags: result.atkFlags & ~AF_MISS };
  }

  /**
   * Shared damage tail: apply MinusHP, record hit-share, broadcast DAMAGE
   * (per-mover HP sync), then grant exp + broadcast death if lethal, else rage.
   */
  private applyHit(player: CPlayer, mover: CMover, eff: MeleeResult): CombatOutcome {
    const dealt = applyDamage(mover, eff);
    // Stamp the attacker's combat cursor so stand regen pauses for 10 s
    // (RecoverySystem gate). C++ only flags the defender (`m_nAtkCnt = 1` on
    // `OnDamaged`), but a player actively fighting is in combat by any common
    // reading, so we treat dealt damage as combat too.
    if (dealt > 0) player.m_tmLastDamage = Date.now();
    recordHit(mover, player.m_idPlayer, dealt);
    const packet = this.damage.build(mover.m_idMover, {
      attackerObjid: player.m_idPlayer,
      hit: dealt,
      atkFlags: eff.atkFlags,
    });
    this.deps.zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, packet);
    const killed = mover.m_nHitPoint <= 0;
    if (killed) this.onDeath(player, mover);
    else this.triggerRage(mover, player);
    return { ok: true, hit: eff.hit, damage: dealt, killed };
  }

  /**
   * `AIMSG_DAMAGE` (`AIMonster.cpp:485-500`) -- being hit makes the monster rage
   * on its attacker. Sets the aggro target + damage-pos leash origin + pursue
   * speed + one `MOVERSETDESTOBJ` broadcast so peer clients walk the monster
   * toward the player. The actual swing runs on the `AISystem` tick (the C++
   * `OnActTimer` cadence), NOT here -- combat no longer retaliates inline.
   *
   * No-op if the monster is already chasing a target (C++ `MoveToDst(objid)`
   * early-outs on target-repeat, `AIMonster.cpp:159`). Any hit attackable
   * monster rages; peaceful town NPCs never reach here (non-attackable).
   */
  private triggerRage(mover: CMover, player: CPlayer): void {
    if (mover.m_idTarget !== NULL_ID) return;
    mover.m_idTarget = player.m_idPlayer;
    mover.m_vPosDamage = { ...mover.m_vPos };
    mover.m_tmAttack = Date.now() + CHASE_WINDOW_MS;
    mover.m_fSpeedFactor = PURSUE_SPEED_FACTOR;
    mover.m_nextAttackTick = 0; // ready to swing as soon as in range
    // Info-level: this is the "passive mob fought back" signal (cautious/MELEE
    // bells retaliate via this path, not sight). If a hit lands and this never
    // fires, the mob isn't retaliating -- the #1 "not aggro when attacked" clue.
    logger.info(
      { moverId: mover.m_idMover, mi: mover.m_dwIndex, target: player.m_idPlayer },
      'monster retaliated (acquired attacker)',
    );
    const pkt = this.destObj.build(mover.m_idMover, player.m_idPlayer, mover.m_nAttackRange);
    this.deps.zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, pkt);
  }

  /** `OnDied` NPC fast-path: broadcast MOVERDEATH, grant exp, remove mover. */
  private onDeath(killer: CPlayer, mover: CMover): void {
    mover.m_bDead = true;
    const deathPkt = this.death.build(mover.m_idMover, killer.m_idPlayer, 0);
    this.deps.zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, deathPkt);
    this.grantExp(killer, mover);
    // Roll drops while the mover still holds its pos + hit-share table.
    this.deps.dropService?.roll(mover, killer);
    // Phase 7 -- increment SetEndCondKillNPC slots before the mover leaves scope.
    this.deps.questTracker?.onKill(killer, mover.m_dwIndex);
    this.deps.spawnManager.kill(mover.m_idMover);
  }

  /**
   * `SubExperience` -> `AddExperienceSolo` (Mover.cpp:5992/6085).
   * base = nExpValue * level-diff mult; cap = min(base, LimitExp); journal
   * before ack; cascade level-ups (within-level exp resets to 0, excess carries
   * over); persist async.
   */
  private grantExp(player: CPlayer, mover: CMover): void {
    const base = Math.floor(mover.m_nExpValue * expLevelDiffMult(player.m_nLevel, mover.m_nLevel));
    const cap = Math.min(base, EXP_TABLE[player.m_nLevel]?.nLimitExp ?? base);
    if (cap <= 0) {
      // Debug (LOG_LEVEL=debug): explains "killed but no exp" -- either the
      // monster's nExpValue is 0 or the player out-levels it (mult floors 0).
      logger.debug(
        {
          charId: player.m_idPlayer,
          monsterExp: mover.m_nExpValue,
          monsterLevel: mover.m_nLevel,
          playerLevel: player.m_nLevel,
        },
        'no exp granted (cap 0)',
      );
      return;
    }

    // m_nExp is within-level (resets at each boundary); addExp carries excess.
    const prevLevel = player.m_nLevel;
    const gain = addExp(player.m_nLevel, player.m_nExp, cap);
    player.m_nExp = gain.exp;
    player.m_nLevel = gain.level;
    player._dirty.add('m_nExp');
    if (gain.levelsGained > 0) {
      // Refill HP/MP/FP to max on level-up (derived max recomputed elsewhere).
      player.m_nHp = player.m_nMaxHp;
      player.m_nMp = player.m_nMaxMp;
      player._dirty.add('m_nLevel');
      player._dirty.add('m_nHp');
      player._dirty.add('m_nMp');
      this.grantSkillPoints(player, prevLevel);
      this.grantGrowthPoints(player, prevLevel);
    }

    // WAL journal the ABSOLUTE post-state before the client ack (rule 04).
    // Idempotent -- the boot replayer re-applies this exact (level, exp) if the
    // fire-and-forget persist below lost the race with a crash. Stored as a
    // JSON-safe string so BigInt precision survives the round-trip.
    const cumulative = String(Math.floor(cumulativeExp(player.m_nLevel, player.m_nExp)));
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_EXP',
      payload: { level: player.m_nLevel, exp: cumulative },
    });

    // SETEXPERIENCE -> self only (wire expects cumulative nExp1).
    this.deps.playerManager.sendTo(player, this.setExp.build(player.m_idPlayer, {
      exp: cumulativeExp(player.m_nLevel, player.m_nExp), level: player.m_nLevel,
    }));
    // SETLEVEL -> vicinity, skips self (only if leveled).
    if (gain.levelsGained > 0) {
      this.deps.zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        this.setLevel.build(player.m_idPlayer, player.m_nLevel),
        player,
      );
    }

    // Persist async -- fire-and-forget (rule 02: service calls repo, no SQL).
    // DB stores cumulative (matches C++ m_nExp1 column semantics). The WAL row
    // above is the crash-recovery backup for this write.
    this.deps.charRepo.updateLevelAndExp(
      player.m_idPlayer, player.m_nLevel, BigInt(cumulative),
    ).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'exp persist failed'));
  }

  /**
   * Level-up SP grant -- `((level-1)/20)+2` per level reached
   * (`MoverParam.cpp:1434`). Adds to both `m_nSkillLevel` (total earned) and
   * `m_nSkillPoint` (unspent). Notifies the client via the DOUSESKILLPOINT
   * snapshot (carries the unchanged roster + the new SP), then persists
   * fire-and-forget. ponytail: WAL `SKILL_LEARN` type + replayer for crash
   * recovery; job-match check on learn.
   */
  private grantSkillPoints(player: CPlayer, prevLevel: number): void {
    let spGain = 0;
    for (let lvl = prevLevel + 1; lvl <= player.m_nLevel; lvl++) {
      spGain += Math.floor((lvl - 1) / 20) + 2;
    }
    if (spGain <= 0) return;
    player.m_nSkillLevel += spGain;
    player.m_nSkillPoint += spGain;
    player._dirty.add('m_nSkillPoint');
    this.deps.playerManager.sendTo(
      player,
      this.douseSkillPoint.build(player.m_idPlayer, player.m_aJobSkill, player.m_nSkillPoint),
    );
    this.deps.charRepo.updateSkillPoints(
      player.m_idPlayer, player.m_nSkillPoint, player.m_nSkillLevel,
    ).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'skill-point persist failed'));
  }

  /**
   * Level-up stat-point (GP) grant -- `EXPCHARACTER.dwLPPoint` per level
   * reached (`_Common/Mover.cpp:1601`). Adds to spendable `m_nRemainGP` and
   * notifies the client via SETSTATE (carries unchanged STR/STA/DEX/INT + the
   * new GP total). Persisted fire-and-forget; the WAL `CHAR_EXP` row above
   * already pins level, so only `remain_gp` needs the cold write here.
   */
  private grantGrowthPoints(player: CPlayer, prevLevel: number): void {
    let gpGain = 0;
    for (let lvl = prevLevel + 1; lvl <= player.m_nLevel; lvl++) {
      gpGain += EXP_TABLE[lvl]?.dwLPPoint ?? 0;
    }
    if (gpGain <= 0) return;
    player.m_nRemainGP += gpGain;
    player._dirty.add('remain_gp');
    this.deps.playerManager.sendTo(
      player,
      this.setState.build(player.m_idPlayer, {
        str: player.m_nStr, sta: player.m_nSta,
        dex: player.m_nDex, int: player.m_nInt,
        remainGP: player.m_nRemainGP,
      }),
    );
    this.deps.charRepo.updateStats(player.m_idPlayer, {
      strength: player.m_nStr, stamina: player.m_nSta,
      dexterity: player.m_nDex, intelligence: player.m_nInt,
      remain_gp: player.m_nRemainGP,
    }).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'growth-point persist failed'));
  }
}

// --- Combat damage helpers ---------------------------------------------------

/** Apply `MinusHP` to the mover; returns damage actually dealt (0 on miss). */
function applyDamage(mover: CMover, result: MeleeResult): number {
  if (!result.hit || result.damage <= 0 || result.atkFlags & AF_MISS) return 0;
  const hp = Math.max(0, mover.m_nHitPoint - result.damage);
  const dealt = mover.m_nHitPoint - hp;
  mover.m_nHitPoint = hp;
  return dealt;
}

/** Accumulate per-attacker damage for future hit-share exp (v1: single attacker). */
function recordHit(mover: CMover, attackerId: number, damage: number): void {
  if (damage <= 0) return;
  mover.m_idEnemies.set(attackerId, (mover.m_idEnemies.get(attackerId) ?? 0) + damage);
}
