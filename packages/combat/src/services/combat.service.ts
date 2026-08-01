/**
 * CombatService -- runs the v19 melee damage pipeline on a player->mover swing.
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
  resolveMelee, xRandomRng, expLevelDiffMult, addExp,
  type Rng, type MeleeResult,
} from '../combat/formulas';
import { resolveSkillCast } from '../combat/skillFormulas';
import { AF_MISS } from '../combat/tables';
import { playerCombatant, moverCombatant } from '../combat/combatants';
import type { ItemLookup } from '../combat/equipStats';
import { CHASE_WINDOW_MS, PURSUE_SPEED_FACTOR, EXP_TABLE } from '@flyff/entities';
import { isMoverAttackableBy, isPlayerAttackableBy } from './combat.policy';
import { MODE } from '@flyff/entities';
import { DamageSerializer } from '../net/snapshot/damage.serializer';
import { MoverDeathSerializer } from '../net/snapshot/moverDeath.serializer';
import { SetExperienceSerializer } from '../net/snapshot/setExperience.serializer';
import { SetLevelSerializer } from '../net/snapshot/setLevel.serializer';
import { DestObjSerializer } from '../net/snapshot/destObj.serializer';
import { DoUseSkillPointSerializer } from '@flyff/world-core';
import { SetStateSerializer } from '../net/snapshot/setState.serializer';
import { VISIBILITY_RADIUS, NULL_ID } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'combat-service' });

export interface CombatServiceDeps {
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
  playerManager: PlayerManager;
  charRepo: Pick<CharacterRepository, 'updateLevelAndExp' | 'updateSkillPoints' | 'updateStats' | 'updatePKState'>;
  journal?: Journal;
  rng?: Rng;
  /**
   * Optional kill hook (Phase 7 -- wired to `QuestTrackerSystem.onKill`). Called
   * with the slain mover's `m_dwIndex` (MI_*) so active quests can increment
   * matching `SetEndCondKillNPC` slots.
   */
  questTracker?: { onKill(killer: CPlayer, victimModelIdx: number): void };
  /**
   * Optional drop-roller (Phase A-C). Spawns ground piles for the kill.
   * Structural type -- compose.ts binds the real `DropService` (in @flyff/
   * inventory), which satisfies this signature without combat depending on it.
   */
  dropService?: { roll(mover: CMover, killer: CPlayer): void };
  /** Optional item-definition lookup -- folds equipped weapon/armor into ATK/DEF. */
  getItem?: ItemLookup;
  /**
   * Optional PvP death hook (wired to `RevivalService.onPlayerDeath`). Called
   * when a player kills another player so the revival loop can flag the victim
   * dead + open the revive dialog. Combat must not depend on the revival service
   * directly (layer boundary), so this seam mirrors `questTracker`.
   */
  onPvpKill?: (victim: CPlayer, killerObjid: number) => void;
  /**
   * Optional party-exp seam (wired to `PartyService.distributeExp` in
   * `compose.ts`). If the killer is in a party, this returns the number of
   * members who received a share (and we skip the solo grant); otherwise null
   * and combat runs its normal solo grant. Keeps `@flyff/combat` free of any
   * `@flyff/party` import (structural type -- closure satisfies the signature).
   */
  partyExp?: (killer: CPlayer, mover: CMover, baseExp: number) => number | null;
  /**
   * Optional same-party predicate (wired to a `PartyManager` lookup in
   * `compose.ts`, the same closure `LootService` gets). Used by the hit-share
   * exp split to pool co-party attackers' damage into ONE share before handing
   * it to {@link CombatServiceDeps.partyExp}. Without it every attacker is
   * treated as unaffiliated, so a 3-member party splitting a mob three ways
   * would each run their own party split on a third of the exp. Structural
   * type -- keeps `@flyff/combat` free of any `@flyff/party` import.
   */
  sameParty?: (a: number, b: number) => boolean;
  /**
   * Optional level-up hook (wired to `CampusService.onLevelUp` in `compose.ts`).
   * Fires once per exp grant that crossed at least one level boundary, AFTER
   * `m_nLevel` is final -- campus rewards key on the exact new level
   * (`CCampusHelper::SetLevelUpReward`, `CampusHelper.cpp:418`), so an early call
   * would read the old value. Same structural-seam pattern as `partyExp`, keeping
   * `@flyff/combat` free of a `@flyff/social` import.
   */
  onLevelUp?: (player: CPlayer, prevLevel: number) => void;
}

/** One `m_idEnemies` row: an attacker and their cumulative recorded damage. */
interface HitShare {
  readonly id: number;
  readonly hit: number;
}

export type CombatOutcome =
  | { ok: true; hit: boolean; damage: number; killed: boolean; effectProc?: boolean }
  | { ok: false; reason: 'invalid_target' | 'target_dead' | 'target_not_attackable' | 'pvp_not_enabled' };

/**
 * Resolved target -- either an NPC mover (PvE) or a live player (PvP). The
 * `kind` discriminant routes the defender through the right Combatant builder
 * (`moverCombatant` vs `playerCombatant`) and selects the death tail
 * (`onDeath` grant-exp for NPC, `onPvpKill` for player).
 */
export type ResolvedTarget =
  | { kind: 'npc'; mover: CMover }
  | { kind: 'player'; target: CPlayer };

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
    const attacker = playerCombatant(player, this.deps.getItem);
    const target = t.target;
    if (target.kind === 'player') {
      // PvP: defender is a live player. The 0.60 PvP damage multiplier + the
      // PvP hit-rate branch apply automatically inside the formula (both
      // combatants are `kind: 'player'`).
      const defender = playerCombatant(target.target);
      const result = resolveMelee(attacker, defender, this.rng);
      return this.applyHitPlayer(player, target.target, this.withOneKillPlayer(player, target.target, result));
    }
    const mover = target.mover;
    const result = resolveMelee(attacker, moverCombatant(mover), this.rng);
    return this.applyHit(player, mover, this.withOneKill(player, mover, result));
  }

  /**
   * Resolve a skill cast's damage from `player` onto `targetObjid`. Same target
   * validation + DAMAGE broadcast + death/exp/rage tail as `resolveAttack`; only
   * the ATK source differs (`resolveSkillCast` from `skillFormulas.ts`).
   *
   * **Multi-hit** (`nSkillCount`, docs #4 §"Multi-hit"): each hit is a full
   * damage roll + its own DAMAGE snapshot + its own HP deduct. The chain stops
   * the moment the target dies (its `m_bDead` gate prevents a second `onDeath`
   * = double exp/drops). For single-hit skills (`skillCount` absent/1) this
   * runs exactly once = the old path. Resource spend + USESKILL broadcast stay
   * in `SkillService.cast` (one cast = one resource charge; per-hit MP split is
   * display-only, total is unchanged).
   *
   * ponytail: 4-frame per-hit spacing (client animation cadence). Server-side
   * all hits resolve in the same tick; spacing is a client visual concern.
   */
  resolveSkill(
    player: CPlayer,
    targetObjid: number,
    skill: SkillDefinition,
    level: SkillLevel,
  ): CombatOutcome {
    const t = this.resolveTarget(player, targetObjid);
    if (!t.ok) return t;
    const attacker = playerCombatant(player, this.deps.getItem);
    const hits = Math.max(1, level.skillCount ?? 1);
    // C++ MoverAttack.cpp:925 -- `factor /= (float)pAddSkillProp->nSkillCount`
    // Each hit deals 1/nSkillCount of the base damage.
    const hitDivisor = hits > 1 ? hits : 1;
    let last: CombatOutcome = { ok: true, hit: true, damage: 0, killed: false };
    const target = t.target;
    if (target.kind === 'player') {
      const defender = playerCombatant(target.target);
      for (let i = 0; i < hits; i++) {
        if (target.target.m_bDead) break;
        const raw = resolveSkillCast({ attacker, defender, skill, level, rng: this.rng });
        const result: MeleeResult = hitDivisor > 1
          ? { ...raw, damage: Math.floor(raw.damage / hitDivisor) }
          : raw;
        last = this.applyHitPlayer(player, target.target, this.withOneKillPlayer(player, target.target, result));
      }
      return last;
    }
    const mover = target.mover;
    const defender = moverCombatant(mover);
    for (let i = 0; i < hits; i++) {
      if (mover.m_bDead) break; // target died mid-chain → stop (no double-death)
      const raw = resolveSkillCast({ attacker, defender, skill, level, rng: this.rng });
      const result: MeleeResult = hitDivisor > 1
        ? { ...raw, damage: Math.floor(raw.damage / hitDivisor) }
        : raw;
      last = this.applyHit(player, mover, this.withOneKill(player, mover, result));
    }
    return last;
  }

  /**
   * Shared target validation for melee + skill swings. Resolves an NPC mover
   * via `SpawnManager` (PvE) or a live player via `PlayerManager` (PvP). Player
   * targets are gated by `isPlayerAttackableBy` -- both attacker and victim
   * must have PK mode on (mutual PvP), otherwise the swing is rejected.
   */
  private resolveTarget(
    player: CPlayer,
    targetObjid: number,
  ): { ok: true; target: ResolvedTarget } | { ok: false; reason: 'invalid_target' | 'target_dead' | 'target_not_attackable' | 'pvp_not_enabled' } {
    // Self-target is never valid.
    if (targetObjid === player.m_idPlayer) return { ok: false, reason: 'invalid_target' };
    // NPC mover first (the common PvE path).
    const mover = this.deps.spawnManager.get(targetObjid);
    if (mover !== undefined) {
      if (mover.m_bDead) return { ok: false, reason: 'target_dead' };
      if (!isMoverAttackableBy(player, mover)) return { ok: false, reason: 'target_not_attackable' };
      return { ok: true, target: { kind: 'npc', mover } };
    }
    // Player target (PvP). `PlayerManager` keys by character id, which is the
    // same object-id space the client addresses via `objid` in the attack body.
    const target = this.deps.playerManager.get(targetObjid);
    if (target === undefined) return { ok: false, reason: 'invalid_target' };
    if (target.m_bDead) return { ok: false, reason: 'target_dead' };
    if (!isPlayerAttackableBy(player, target)) return { ok: false, reason: 'pvp_not_enabled' };
    return { ok: true, target: { kind: 'player', target } };
  }

  /** `/ok` ONEKILL_MODE override -- GM one-shot forces lethal damage. */
  private withOneKill(player: CPlayer, mover: CMover, result: MeleeResult): MeleeResult {
    if ((player.m_dwMode & MODE.ONEKILL) === 0) return result;
    return { hit: true, damage: mover.m_nHitPoint, atkFlags: result.atkFlags & ~AF_MISS };
  }

  /** `/ok` ONEKILL_MODE override for PvP -- forces lethal damage to a player. */
  private withOneKillPlayer(player: CPlayer, target: CPlayer, result: MeleeResult): MeleeResult {
    if ((player.m_dwMode & MODE.ONEKILL) === 0) return result;
    return { hit: true, damage: target.m_nHp, atkFlags: result.atkFlags & ~AF_MISS };
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
    return { ok: true, hit: eff.hit, damage: dealt, killed, effectProc: eff.effectProc };
  }

  /**
   * PvP damage tail (player→player). Mirrors `applyHit` but against a `CPlayer`
   * defender: apply MinusHP, broadcast DAMAGE, pause both players' stand regen,
   * and on lethal hit run `onPvpKill` (PK value increment + revival hook).
   * No exp grant (PvP kills give no exp in v19), no rage, no spawn removal.
   */
  private applyHitPlayer(player: CPlayer, target: CPlayer, eff: MeleeResult): CombatOutcome {
    const dealt = applyDamagePlayer(target, eff);
    if (dealt > 0) {
      player.m_tmLastDamage = Date.now();
      target.m_tmLastDamage = Date.now();
      target._dirty.add('m_nHp');
    }
    const packet = this.damage.build(target.m_idPlayer, {
      attackerObjid: player.m_idPlayer,
      hit: dealt,
      atkFlags: eff.atkFlags,
    });
    this.deps.zoneManager.broadcastAround(target.m_vPos, target.m_nZoneId, VISIBILITY_RADIUS, packet);
    const killed = target.m_nHp <= 0 && !target.m_bDead;
    if (killed) this.onPvpKill(player, target);
    return { ok: true, hit: eff.hit, damage: dealt, killed, effectProc: eff.effectProc };
  }

  /**
   * `OnDiedPVP` (AttackArbiter.cpp:821) -- the victim died to a player killer.
   * Increments the killer's PK value + propensity, stamps the PK-time decay base,
   * journals the PK state before the ack (rule 04), persists fire-and-forget,
   * and hands the victim off to the revival loop via the `onPvpKill` seam.
   */
  private onPvpKill(killer: CPlayer, victim: CPlayer): void {
    victim.m_bDead = true;
    victim._dirty.add('m_bDead');
    killer.m_nPKValue += 1;
    killer.m_dwPKPropensity = Math.max(killer.m_dwPKPropensity, 1);
    killer.m_dwPKTime = Date.now();
    killer._dirty.add('m_nPKValue');
    killer._dirty.add('m_dwPKPropensity');
    killer._dirty.add('m_dwPKTime');
    logger.info(
      { killer: killer.m_idPlayer, victim: victim.m_idPlayer, pkValue: killer.m_nPKValue },
      'player killed in PvP (PK value incremented)',
    );
    // WAL journal the killer's absolute PK state before the ack (rule 04).
    this.deps.journal?.append({
      charId: killer.m_idPlayer, type: 'PK_KILL',
      payload: {
        pkPropensity: killer.m_dwPKPropensity,
        pkValue: killer.m_nPKValue,
        pkTime: killer.m_dwPKTime,
        victimId: victim.m_idPlayer,
      },
    });
    // Persist the PK state fire-and-forget (rule 02: service calls repo).
    this.deps.charRepo.updatePKState(
      killer.m_idPlayer, killer.m_dwPKPropensity, killer.m_nPKValue, killer.m_dwPKTime,
    ).catch((err: unknown) => logger.error({ err, charId: killer.m_idPlayer }, 'PK state persist failed'));
    // Hand the victim to the revival loop (flags dead, broadcasts MOVERDEATH,
    // opens the revive dialog) -- combat must not depend on RevivalService.
    this.deps.onPvpKill?.(victim, killer.m_idPlayer);
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
    // Schedule corpse DEL_OBJ after CORPSE_DESPAWN_MS so clients drop the death
    // animation; respawn (if any) runs on its own independent timer. Admin
    // despawns (/rn, /ak) omit the flag and broadcast DEL_OBJ themselves.
    this.deps.spawnManager.kill(mover.m_idMover, { despawn: true });
  }

  /**
   * `CMover::SubExperience` -> `AddExperienceKillMember` (`Mover.cpp:6204/6297`).
   *
   * The kill's exp is NOT the killer's alone: it is divided by damage
   * contribution across every attacker in `m_idEnemies` who is still a live
   * player within 64m of the corpse. Attackers who share a party pool their
   * hits into ONE share, which then goes through the party split.
   *
   * Faithful order (the previous implementation skipped steps 1-3 and paid the
   * killer 100%, so a healer/support or a lower-damage party member got nothing
   * and a helper from outside the party stole the whole kill):
   *   1. `dwMaxEnemyHit` = sum of all recorded damage. 0 -> nobody gets exp.
   *   2. Per attacker in insertion order: skip if consumed, dead, out of 64m,
   *      or no longer online.
   *   3. If they are in a party, fold in the hits of every LATER attacker in the
   *      same party and mark those consumed (so the party is paid once).
   *   4. `share = rawExp * (hits / dwMaxEnemyHit)`.
   *   5. Pooled (party) -> `partyExp` seam; it returns null when the party split
   *      does not apply (only one member nearby) and we fall back to the solo
   *      grant, exactly as C++ calls `AddExperienceSolo(..., bParty=TRUE)`.
   *   6. Unpooled -> solo grant.
   *
   * `rawExp` is the mover's unmodified `nExpValue`: the level-difference
   * multiplier is applied per recipient (solo curve for a solo grant, the
   * separate party curve inside the party split), so it must NOT be pre-applied.
   */
  private grantExp(killer: CPlayer, mover: CMover): void {
    const rawExp = mover.m_nExpValue;
    if (rawExp <= 0) {
      logger.debug(
        { charId: killer.m_idPlayer, monsterLevel: mover.m_nLevel, mi: mover.m_dwIndex },
        'no exp granted (mover nExpValue is 0)',
      );
      return;
    }

    // 1. Total recorded damage. `m_idEnemies` is keyed by attacker objid; only
    // player attackers are ever recorded (recordHit is on the player paths).
    const attackers: HitShare[] = [];
    let totalHit = 0;
    for (const [id, hit] of mover.m_idEnemies) {
      attackers.push({ id, hit });
      totalHit += hit;
    }
    if (totalHit <= 0) {
      // Killed with 0 recorded damage (GM /ok one-shot writes the kill without a
      // hit row on some paths) -- pay the killer the whole thing rather than
      // dropping the exp on the floor.
      this.grantSoloExp(killer, mover, rawExp);
      return;
    }

    const consumed = new Set<number>();
    // The killer is already resolved; only OTHER attackers need a manager lookup.
    const resolve = (id: number): CPlayer | undefined =>
      id === killer.m_idPlayer ? killer : this.deps.playerManager.get(id);

    // ── Phase 1: pool same-party hits, then route to party or solo. ──
    // C++ AddExperienceKillMember zeroes every same-party member during a
    // forward scan (line 6339), then calls AddExperienceParty ONCE for the
    // combined share.  Mirror that: pool into a per-iteration `hits` total;
    // if any pooling occurred, queue a single party grant; otherwise queue a
    // solo grant.  Both are deferred to avoid granting inside the scan.
    //
    // Single-pass, no merge logic: the forward scan (slice(i+1)) always finds
    // ALL later same-party members.  Earlier same-party members are impossible
    // here because the earlier one's own forward scan already consumed them.
    const partyGrants: Array<{ representative: CPlayer; hits: number }> = [];
    const soloGrants: Array<{ attacker: CPlayer; hits: number }> = [];
    for (const [i, { id: attackerId, hit: ownHit }] of attackers.entries()) {
      if (consumed.has(attackerId)) continue;
      const attacker = resolve(attackerId);
      // `IsValidObj(pEnemy) && pDead->IsValidArea(pEnemy, 64.0f)` -- offline
      // or walked-away attackers are consumed immediately (C++ zeroes them at
      // line 6344) so later party members cannot pool their hits.
      if (!attacker || !inExpRange(attacker, mover)) { consumed.add(attackerId); continue; }

      // Pool same-party attackers' hits into this one representative.
      let hits = ownHit;
      let pooled = false;
      if (this.deps.sameParty) {
        for (const { id: otherId, hit: otherHit } of attackers.slice(i + 1)) {
          if (consumed.has(otherId)) continue;
          const other = resolve(otherId);
          if (!other || !inExpRange(other, mover)) { consumed.add(otherId); continue; }
          if (!this.deps.sameParty(attackerId, otherId)) continue;
          hits += otherHit;
          consumed.add(otherId);
          pooled = true;
        }
      }

      if (pooled) {
        partyGrants.push({ representative: attacker, hits });
      } else {
        soloGrants.push({ attacker, hits });
      }
    }

    // ── Phase 2: distribute party shares. ──
    // Each group's combined hit portion goes through the partyExp seam
    // (PartyService.distributeExp) which splits it among nearby members by
    // level-squared weighting.
    if (this.deps.partyExp) {
      for (const { representative, hits } of partyGrants) {
        const share = rawExp * (hits / totalHit);
        if (share > 0) this.deps.partyExp(representative, mover, share);
      }
    }

    // ── Phase 3: non-party solo grants. ──
    // Each attacker who was NOT pooled with same-party members gets their
    // individual share.  Still try the partyExp seam: it returns null when
    // the attacker has no party or is the only member nearby (C++
    // AddExperienceSolo(bParty=TRUE) fallback).
    for (const { attacker, hits } of soloGrants) {
      const share = rawExp * (hits / totalHit);
      if (share <= 0) continue;
      if (this.deps.partyExp) {
        const handled = this.deps.partyExp(attacker, mover, share);
        if (handled !== null) continue;
      }
      this.grantSoloExp(attacker, mover, share);
    }
  }

  /**
   * `AddExperienceSolo` (`Mover.cpp:6379`): apply the solo level-difference
   * multiplier to `rawShare`, clamp to this player's own `nLimitExp`, then grant.
   */
  private grantSoloExp(player: CPlayer, mover: CMover, rawShare: number): void {
    const base = Math.floor(rawShare * expLevelDiffMult(player.m_nLevel, mover.m_nLevel));
    const cap = Math.min(base, EXP_TABLE[player.m_nLevel]?.nLimitExp ?? base);
    if (cap <= 0) {
      // Debug (LOG_LEVEL=debug): explains "killed but no exp" -- either the
      // share rounded to 0 or the player out-levels the mob (mult floors 0.1).
      logger.debug(
        {
          charId: player.m_idPlayer,
          rawShare,
          monsterLevel: mover.m_nLevel,
          playerLevel: player.m_nLevel,
        },
        'no exp granted (cap 0)',
      );
      return;
    }
    this.grantExpAmount(player, cap);
  }

  /**
   * Apply `amount` exp to `player` -- the shared per-player grant body. Runs the
   * within-level `addExp` cascade, refills HP/MP/FP on level-up, WAL-journals
   * `CHAR_EXP`, sends SETEXPERIENCE (self) + SETLEVEL (vicinity), and persists
   * fire-and-forget. Called by {@link grantExp} (solo) AND by `PartyService
   * .distributeExp` (per-member split) so there is ONE exp-application path.
   */
  grantExpAmount(player: CPlayer, amount: number): void {
    if (amount <= 0) return;
    // m_nExp is within-level (resets at each boundary); addExp carries excess.
    const prevLevel = player.m_nLevel;
    const gain = addExp(player.m_nLevel, player.m_nExp, amount, player.jobLevelCap());
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
      // Campus level-up rewards. Runs last so `m_nLevel` is final -- rewards key
      // on the exact new level and graduation (level 75) dissolves the pairing.
      this.deps.onLevelUp?.(player, prevLevel);
    }

    // WAL journal the ABSOLUTE post-state before the client ack (rule 04).
    // Idempotent -- the boot replayer re-applies this exact (level, exp) if the
    // fire-and-forget persist below lost the race with a crash. Stored as a
    // JSON-safe string so BigInt precision survives the round-trip. m_nExp IS
    // the within-level value the DB + wire carry (no cumulative form).
    const exp = String(Math.floor(player.m_nExp));
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_EXP',
      payload: { level: player.m_nLevel, exp },
    });

    // SETEXPERIENCE -> self only (wire nExp1 = within-level m_nExp, resets to 0
    // at each level boundary -- matches C++ GetExp1() semantics). SP/skillLevel
    // MUST be carried here -- C++ AddSetExperience writes them (User.cpp:1123);
    // omitting them zeroes the client's SP display every kill and clobbers the
    // DOUSESKILLPOINT refresh sent in grantSkillPoints.
    this.deps.playerManager.sendTo(player, this.setExp.build(player.m_idPlayer, {
      exp: player.m_nExp, level: player.m_nLevel,
      skillLevel: player.m_nSkillLevel, skillPoint: player.m_nSkillPoint,
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
    // DB stores the within-level value (matches C++ m_nExp1 column semantics).
    // The WAL row above is the crash-recovery backup for this write.
    this.deps.charRepo.updateLevelAndExp(
      player.m_idPlayer, player.m_nLevel, BigInt(Math.floor(player.m_nExp)),
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
    // C++ `MoverParam.cpp:1446`: Master/Hero/LegendHero get +1 GP per level-up.
    const isMasterOrHero = player.m_nJob >= 16 && player.m_nJob <= 31;
    if (isMasterOrHero) {
      gpGain += player.m_nLevel - prevLevel;
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

/** `pDead->IsValidArea(pEnemy, 64.0f)` -- exp radius from the CORPSE, 3-D. */
const EXP_SHARE_RADIUS = 64;

/**
 * `IsValidArea(pEnemy, 64.0f)` (`Mover.cpp:6238`) for the hit-share scan:
 * same world (zone) and full 3-D squared distance from the corpse under 64².
 * Strict `<` matches C++.
 */
function inExpRange(player: CPlayer, mover: CMover): boolean {
  if (player.m_nZoneId !== mover.m_nZoneId) return false;
  const dx = player.m_vPos.x - mover.m_vPos.x;
  const dy = player.m_vPos.y - mover.m_vPos.y;
  const dz = player.m_vPos.z - mover.m_vPos.z;
  return dx * dx + dy * dy + dz * dz < EXP_SHARE_RADIUS * EXP_SHARE_RADIUS;
}

/**
 * Apply `MinusHP` to a player defender; returns damage actually dealt (0 on
 * miss). Floors HP at 0. Mirrors the NPC `applyDamage` helper but operates on
 * `CPlayer.m_nHp`. A PvP hit always deals at least 1 damage when it lands (C++
 * `nDamage = max(nDamage, 1)` before `MinusHP`, AttackArbiter.cpp:125).
 */
function applyDamagePlayer(target: CPlayer, result: MeleeResult): number {
  if (!result.hit || result.atkFlags & AF_MISS) return 0;
  let dmg = result.damage;
  if (dmg <= 0) dmg = 1; // PvP damage floor (C++ OnDamageMsgW)
  const hp = Math.max(0, target.m_nHp - dmg);
  const dealt = target.m_nHp - hp;
  target.m_nHp = hp;
  return dealt;
}
