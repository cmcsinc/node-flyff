/**
 * CombatService — runs the v15 melee damage pipeline on a player→mover swing.
 *
 * Wires the pure {@link resolveMelee} math to live state: resolves the target
 * via `SpawnManager`, applies `MinusHP` to the mover, broadcasts the DAMAGE
 * snapshot (the per-mover HP sync), and on death grants exp (level-diff mult +
 * LimitExp cap + level-up cascade), broadcasts MOVERDEATH, and removes the
 * mover. Exp + level are WAL-journaled before the ack (rule 04).
 *
 * Server-authoritative (rule 03): the client's `dwAtkFlags`/`nParam3` never
 * enter the damage math — hit/miss, crit, damage are all recomputed from
 * `CPlayer`/`CMover` stats via the injected `Rng`.
 *
 * ponytail: drops (propMoverEx.inc), respawn queue, equipped-weapon model,
 * hit-share party grouping, stealHP/skills — see `docs/combat-plan.md`.
 *
 * @module services/combat
 */

import type { Journal } from '@flyff/database';
import type { CharacterRepository } from '@flyff/database';
import type { CPlayer } from '../entities/player.js';
import type { CMover } from '../entities/mover.js';
import type { SpawnManager } from '../managers/spawn.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { PlayerManager } from '../managers/player.manager.js';
import {
  resolveMelee, xRandomRng, expLevelDiffMult, addExp, cumulativeExp,
  type Combatant, type WeaponStats, type Rng, type MeleeResult,
} from '../combat/formulas.js';
import { EXP_TABLE } from '../combat/expTable.js';
import { NO_PROP, WT_MELEE_SWD, AF_MISS } from '../combat/tables.js';
import { isMoverAttackableBy } from './combat.policy.js';
import { DamageSerializer } from '../net/snapshot/damage.serializer.js';
import { MoverDeathSerializer } from '../net/snapshot/moverDeath.serializer.js';
import { SetExperienceSerializer } from '../net/snapshot/setExperience.serializer.js';
import { SetLevelSerializer } from '../net/snapshot/setLevel.serializer.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'combat-service' });

/** Bare-hand profile for an unarmed player (ponytail: read equipped weapon). */
const BARE_HAND: WeaponStats = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

/** Bare-hand stub for NPC (NPCs use raw propMover cols, not the weapon curve). */
const FIST_NPC: WeaponStats = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

/**
 * Base monster counter-attack interval (ms). v15 derives this from propMover
 * `nAttacksPerSec` via the `ATK_SPEED` table on the AI tick; ponytail: read the
 * real column once the resource converter exports it. 1200ms ≈ low-monster cadence.
 */
const RETALIATE_COOLDOWN_MS = 1200;

export interface CombatServiceDeps {
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
  playerManager: PlayerManager;
  charRepo: Pick<CharacterRepository, 'updateLevelAndExp'>;
  journal?: Journal;
  rng?: Rng;
  /**
   * Optional kill hook (Phase 7 — wired to `QuestTrackerSystem.onKill`). Called
   * with the slain mover's `m_dwIndex` (MI_*) so active quests can increment
   * matching `SetEndCondKillNPC` slots.
   */
  questTracker?: { onKill(killer: CPlayer, victimModelIdx: number): void };
}

export type CombatOutcome =
  | { ok: true; hit: boolean; damage: number; killed: boolean }
  | { ok: false; reason: 'invalid_target' | 'target_dead' | 'target_not_attackable' };

export class CombatService {
  private readonly damage = new DamageSerializer();
  private readonly death = new MoverDeathSerializer();
  private readonly setExp = new SetExperienceSerializer();
  private readonly setLevel = new SetLevelSerializer();
  private readonly rng: Rng;
  constructor(private readonly deps: CombatServiceDeps) {
    this.rng = deps.rng ?? xRandomRng;
  }

  /** Resolve a melee swing from `player` onto `targetObjid`. */
  resolveAttack(player: CPlayer, targetObjid: number): CombatOutcome {
    const mover = this.deps.spawnManager.get(targetObjid);
    if (mover === undefined) return { ok: false, reason: 'invalid_target' };
    if (mover.m_bDead) return { ok: false, reason: 'target_dead' };
    if (!isMoverAttackableBy(player, mover)) return { ok: false, reason: 'target_not_attackable' };

    const result: MeleeResult = resolveMelee(playerCombatant(player), moverCombatant(mover), this.rng);

    // Apply MinusHP + record hit-share even on a miss (0 damage).
    const dealt = applyDamage(mover, result);
    recordHit(mover, player.m_idPlayer, dealt);

    // Broadcast DAMAGE (vicinity) — the per-mover HP sync. dwHit=0 + AF_MISS on miss.
    const packet = this.damage.build(mover.m_idMover, {
      attackerObjid: player.m_idPlayer,
      hit: dealt,
      atkFlags: result.atkFlags,
    });
    this.deps.zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, packet);

    const killed = mover.m_nHitPoint <= 0;
    if (killed) this.onDeath(player, mover);
    else this.counterSwing(mover, player);
    return { ok: true, hit: result.hit, damage: dealt, killed };
  }

  /**
   * Reactive counter-attack — the monster swings back at its last attacker.
   *
   * C++ runs NPC swings on `CMover::OnActTimer` (its own attack-speed cadence,
   * independent of the player's swing event); this emulator has no central AI
   * tick yet, so v1 fires the counter-swing from the player's swing, throttled
   * by {@link CMover.m_nextAttackTick} so a monster never swings faster than its
   * `RETALIATE_COOLDOWN_MS / m_fSpeedFactor` cadence. Any hit monster retaliates
   * — `BELLI_PEACEFUL` gates *auto-aggro on sight* in C++, not self-defense, and
   * non-attackable town NPCs can't be hit at all so they never reach here.
   * ponytail: full AI tick (aggro-on-sight, chase via movement, range check).
   *
   * Player death (HP→0) clamps at 0; the DAMAGE broadcast is the HP sync so the
   * client shows its revive UI. ponytail: exp penalty + auto-revival + respawn.
   */
  private counterSwing(mover: CMover, player: CPlayer): void {
    const now = Date.now();
    if (now < mover.m_nextAttackTick) return;
    mover.m_nextAttackTick = now + RETALIATE_COOLDOWN_MS / mover.m_fSpeedFactor;

    const result = resolveMelee(moverCombatant(mover), playerCombatant(player), this.rng);
    let dealt = 0;
    if (result.hit && result.damage > 0 && !(result.atkFlags & AF_MISS)) {
      const before = player.m_nHp;
      player.m_nHp = Math.max(0, before - result.damage);
      dealt = before - player.m_nHp;
      player._dirty.add('m_nHp');
    }

    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.damage.build(player.m_idPlayer, { attackerObjid: mover.m_idMover, hit: dealt, atkFlags: result.atkFlags }),
    );

    if (player.m_nHp <= 0) {
      logger.warn({ charId: player.m_idPlayer, killerIdx: mover.m_dwIndex }, 'player killed by monster — revival handler pending');
    }
  }

  /** `OnDied` NPC fast-path: broadcast MOVERDEATH, grant exp, remove mover. */
  private onDeath(killer: CPlayer, mover: CMover): void {
    mover.m_bDead = true;
    const deathPkt = this.death.build(mover.m_idMover, killer.m_idPlayer, 0);
    this.deps.zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, deathPkt);
    this.grantExp(killer, mover);
    // Phase 7 — increment SetEndCondKillNPC slots before the mover leaves scope.
    this.deps.questTracker?.onKill(killer, mover.m_dwIndex);
    this.deps.spawnManager.kill(mover.m_idMover);
  }

  /**
   * `SubExperience` → `AddExperienceSolo` (Mover.cpp:5992/6085).
   * base = nExpValue × level-diff mult; cap = min(base, LimitExp); journal
   * before ack; cascade level-ups (within-level exp resets to 0, excess carries
   * over); persist async.
   */
  private grantExp(player: CPlayer, mover: CMover): void {
    const base = Math.floor(mover.m_nExpValue * expLevelDiffMult(player.m_nLevel, mover.m_nLevel));
    const cap = Math.min(base, EXP_TABLE[player.m_nLevel]?.nLimitExp ?? base);
    if (cap <= 0) return;

    // WAL journal BEFORE the exp mutation / client ack (rule 04).
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'EXP_GAIN', payload: { amount: cap, src: mover.m_dwIndex } });

    // m_nExp is within-level (resets at each boundary); addExp carries excess.
    const startLevel = player.m_nLevel;
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
    }

    // SETEXPERIENCE → self only (wire expects cumulative nExp1).
    this.deps.playerManager.sendTo(player, this.setExp.build(player.m_idPlayer, {
      exp: cumulativeExp(player.m_nLevel, player.m_nExp), level: player.m_nLevel,
    }));
    // SETLEVEL → vicinity, skips self (only if leveled).
    if (gain.levelsGained > 0) {
      this.deps.zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        this.setLevel.build(player.m_idPlayer, player.m_nLevel),
        player,
      );
    }

    // Persist async — fire-and-forget (rule 02: service calls repo, no SQL).
    // DB stores cumulative (matches C++ m_nExp1 column semantics).
    this.deps.charRepo.updateLevelAndExp(
      player.m_idPlayer, player.m_nLevel,
      BigInt(Math.floor(cumulativeExp(player.m_nLevel, player.m_nExp))),
    ).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'exp persist failed'));
  }
}

// --- Combatant views ---------------------------------------------------------

function playerCombatant(p: CPlayer): Combatant {
  return {
    kind: 'player', level: p.m_nLevel, job: p.m_nJob,
    str: p.m_nStr, sta: p.m_nSta, dex: p.m_nDex, int: p.m_nInt,
    weapon: BARE_HAND,
    npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0,
    element: NO_PROP,
  };
}

function moverCombatant(m: CMover): Combatant {
  return {
    kind: 'npc', level: m.m_nLevel, job: 0,
    str: 0, sta: 0, dex: 0, int: 0,
    weapon: FIST_NPC,
    npcAtkMin: m.m_nAtkMin, npcAtkMax: m.m_nAtkMax, npcArmor: m.m_nArmor,
    npcResisMagic: 0, npcHR: m.m_nHR, npcER: m.m_nER, element: m.m_nElement,
  };
}

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
