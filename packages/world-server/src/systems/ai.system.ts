/**
 * AISystem — monster FSM: idle wander + aggro + pursue (RAGE) + return-home.
 *
 * Ports `CAIMonster` (`_AIInterface/AIMonster.cpp`) state-by-state. The world
 * has no central 50 ms tick yet, so {@link start} runs its own 100 ms timer
 * (C++ ticks at 67 ms — close enough for movement/attack cadence); {@link tick}
 * is public for the future unified loop and tests.
 *
 * **States** (per `AIMonster.cpp:30-56`):
 *   - **Idle** (no target, not leashing): wander every 5–6 s within the 30 m
 *     `RANGE_MOVE` leash, OR sight-acquire a player if `BELLI ∈ ACTIVE_BELLI`.
 *   - **RAGE** (has `m_idTarget`): step toward the player server-side; swing on
 *     `REATTACK_DELAY_MS` cadence when within `MELEE_ATTACK_RANGE`. Leash at
 *     150 m from spawn OR 120 m from `m_vPosDamage` → return home.
 *   - **Return** (`m_bReturnToBegin`): run home at 2.66×; restore HP + clear
 *     target on arrival.
 *
 * **Wire model** (research `User.cpp:4705`, `AIMonster.cpp:145-171`): the server
 * emits ONE destination packet per state change — `DESTPOS` (0xc1) for idle /
 * return-home, `MOVERSETDESTOBJ` (0xc2) on aggro acquire (the client then walks
 * the monster to FOLLOW the moving player objid). Server `m_vPos` is stepped
 * each tick so attack-range + leash gates see a faithful position.
 *
 * Offense: `AISystem` owns NPC swings now (C++ `OnActTimer` cadence) —
 * `CombatService.triggerRage` only sets the target on a player's hit. No `await`
 * in tick (rule 05); no socket refs (rule 02) — egress via `ZoneManager`.
 *
 * ponytail: full aggro table (currently single-slot), `dwReAttackDelay` per
 * mover, ranged/healer AI, flight, collision-aware stuck teleport.
 *
 * @module systems/ai
 */

import type { SpawnManager } from '../managers/spawn.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { CPlayer } from '../entities/player.js';
import type { CMover } from '../entities/mover.js';
import type { Vec3 } from '../entities/player.js';
import { resolveMelee, xRandomRng, type Rng } from '../combat/formulas.js';
import { playerCombatant, moverCombatant } from '../combat/combatants.js';
import { AF_MISS } from '../combat/tables.js';
import {
  RANGE_MOVE, RAGE_LEASH, RANGE_RETURN_TO_BEGIN, HOME_ARRIVAL, SIGHT_RANGE,
  PURSUE_SPEED_FACTOR, RETURN_SPEED_FACTOR, CHASE_WINDOW_MS,
  RETURN_STUCK_MS, REATTACK_JITTER_MS, RANGE_REATTACK_DELAY_MS, SPEED_SCALE,
  AGGRO_LEVEL_BAND, OBJMSG_ATK1, OBJMSG_ATK_RANGE1,
} from '../combat/aiConstants.js';
import { DestPosSerializer } from '../net/snapshot/destPos.serializer.js';
import { DestObjSerializer } from '../net/snapshot/destObj.serializer.js';
import { DamageSerializer } from '../net/snapshot/damage.serializer.js';
import { MeleeAttackSerializer } from '../net/snapshot/meleeAttack.serializer.js';
import { RangeAttackSerializer } from '../net/snapshot/rangeAttack.serializer.js';
import { VISIBILITY_RADIUS, NULL_ID } from '../net/snapshot/constants.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'ai-system' });

const TICK_MS = 100;
const STOP_MIN_MS = 5000;
const STOP_JITTER_MS = 1000;
const STAGGER_MS = 5000;
const WANDER_BOX = 10;
const RANGE_MOVE_SQ = RANGE_MOVE * RANGE_MOVE;

export interface AISystemDeps {
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
  playerManager: Pick<PlayerManager, 'get'>;
  rng?: Rng;
  /** Called when a player's HP reaches 0 from a monster swing. */
  onPlayerDeath?: (player: CPlayer, killerObjid: number) => void;
}

export class AISystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private readonly dest = new DestPosSerializer();
  private readonly destObj = new DestObjSerializer();
  private readonly damage = new DamageSerializer();
  private readonly meleeAttack = new MeleeAttackSerializer();
  private readonly rangeAttack = new RangeAttackSerializer();
  private readonly rng: Rng;
  constructor(private readonly deps: AISystemDeps) {
    this.rng = deps.rng ?? xRandomRng;
  }

  /** Begin the AI loop (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        logger.error({ err }, 'AI tick failed');
      }
    }, TICK_MS);
  }

  /** Stop the AI loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every live monster. Sync, no `await` (rule 05). */
  tick(now: number): void {
    const dtMs = this.lastTickMs === 0 ? TICK_MS : Math.min(200, Math.max(1, now - this.lastTickMs));
    this.lastTickMs = now;
    for (const m of this.deps.spawnManager.all()) {
      if (!m.m_bAttackable || m.m_bGuard || m.m_bDead) continue;
      if (m.m_idTarget !== NULL_ID) this.pursue(m, now, dtMs);
      else if (m.m_bReturnToBegin) this.stepReturnHome(m, now, dtMs);
      else this.idleOrAcquire(m, now);
    }
  }

  // --- Idle: sight-aggro scan, else wander ----------------------------------

  private idleOrAcquire(m: CMover, now: number): void {
    if (m.m_tmNextWander === 0) {
      m.m_tmNextWander = now + randInt(0, STAGGER_MS);
      return;
    }
    if (m.m_bActiveAttack !== 0 && this.acquireBySight(m, now)) return;
    if (now < m.m_tmNextWander) return;
    this.wander(m, now);
  }

  /**
   * Sight-scan `SIGHT_RANGE` for the nearest eligible player; acquire if found.
   * Eligible = alive AND within `AGGRO_LEVEL_BAND` levels above the mob. The
   * level cap is a CUSTOM deviation (ponytail in `aiConstants.ts`); vanilla
   * `ScanTarget` aggros any level.
   */
  private acquireBySight(m: CMover, now: number): boolean {
    const players = this.deps.zoneManager.playersNear(m.m_vPos, m.m_nZoneId, SIGHT_RANGE)
      .filter((p) => !p.m_bDead && p.m_nLevel <= m.m_nLevel + AGGRO_LEVEL_BAND);
    if (players.length === 0) return false;
    let nearest = players[0]!;
    let best = distSq2(m.m_vPos, nearest.m_vPos);
    for (let i = 1; i < players.length; i++) {
      const d = distSq2(m.m_vPos, players[i]!.m_vPos);
      if (d < best) { best = d; nearest = players[i]!; }
    }
    this.acquire(m, nearest, now);
    return true;
  }

  /** Pick the next idle wander dest, leash it, broadcast DESTPOS. */
  private wander(m: CMover, now: number): void {
    const dx = randInt(-WANDER_BOX, WANDER_BOX);
    const dz = randInt(-WANDER_BOX, WANDER_BOX);
    const dest: Vec3 = { x: m.m_vPos.x + dx, y: m.m_vPos.y, z: m.m_vPos.z + dz };
    let target: Vec3;
    if (distSq2(dest, m.m_vPosBegin) <= RANGE_MOVE_SQ) {
      target = dest;
    } else if (distSq2(m.m_vPos, m.m_vPosBegin) > RANGE_MOVE_SQ) {
      target = m.m_vPosBegin;
    } else {
      m.m_tmNextWander = now + stopInterval();
      return;
    }
    this.moveTo(m, target, now, false);
  }

  // --- RAGE: pursue target, swing in range, leash --------------------------

  private pursue(m: CMover, now: number, dtMs: number): void {
    const target = this.deps.playerManager.get(m.m_idTarget);
    if (target === undefined || target.m_nHp <= 0 || target.m_bDead) {
      this.startReturn(m, now);
      return;
    }
    // Spawn-anchor (150 m) OR damage-pos (120 m) leash → go home.
    if (distSq2(m.m_vPos, m.m_vPosBegin) > RAGE_LEASH * RAGE_LEASH
      || distSq2(m.m_vPos, m.m_vPosDamage) > RANGE_RETURN_TO_BEGIN * RANGE_RETURN_TO_BEGIN) {
      this.startReturn(m, now);
      return;
    }
    const rangeSq = m.m_nAttackRange * m.m_nAttackRange;
    // Step only while out of range so ranged monsters hold at `m_nAttackRange`
    // (don't close to contact); melee monsters close until within range too.
    if (distSq2(m.m_vPos, target.m_vPos) > rangeSq) {
      stepToward(m, target.m_vPos, PURSUE_SPEED_FACTOR, m.m_fSpeedBase, dtMs);
      if (distSq2(m.m_vPos, target.m_vPos) > rangeSq) return; // still closing
    }
    if (now < m.m_nextAttackTick) return;
    this.monsterSwing(m, target);
    m.m_nextAttackTick = now + (m.m_bRangeAttack
      ? RANGE_REATTACK_DELAY_MS
      : m.m_nReAttackDelay + randInt(0, REATTACK_JITTER_MS));
  }

  /**
   * NPC → player swing — broadcasts the attack animation
   * (`SNAPSHOTTYPE_MELEE_ATTACK` or `SNAPSHOTTYPE_RANGE_ATTACK`) so peers see
   * the monster wind up, then resolves `resolveMelee` (same formula either
   * way) and broadcasts DAMAGE. Mirrors C++ `DoAttack`/`DoAttackRange` →
   * `AddMeleeAttack`/`AddRangeAttack` → damage round-trip.
   */
  private monsterSwing(m: CMover, target: CPlayer): void {
    const animPkt = m.m_bRangeAttack
      ? this.rangeAttack.build(m.m_idMover, { dwAtkMsg: OBJMSG_ATK_RANGE1, objid: target.m_idPlayer, nParam2: 0, nParam3: 0, idSfxHit: 0 })
      : this.meleeAttack.build(m.m_idMover, { dwAtkMsg: OBJMSG_ATK1, objid: target.m_idPlayer, nParam2: 0, nParam3: 0 });
    this.deps.zoneManager.broadcastAround(m.m_vPos, m.m_nZoneId, VISIBILITY_RADIUS, animPkt);

    const result = resolveMelee(moverCombatant(m), playerCombatant(target), this.rng);
    let dealt = 0;
    if (result.hit && result.damage > 0 && !(result.atkFlags & AF_MISS)) {
      const before = target.m_nHp;
      target.m_nHp = Math.max(0, before - result.damage);
      dealt = before - target.m_nHp;
      target._dirty.add('m_nHp');
    }
    this.deps.zoneManager.broadcastAround(
      target.m_vPos, target.m_nZoneId, VISIBILITY_RADIUS,
      this.damage.build(target.m_idPlayer, { attackerObjid: m.m_idMover, hit: dealt, atkFlags: result.atkFlags }),
    );
    if (target.m_nHp <= 0) {
      this.deps.onPlayerDeath?.(target, m.m_idMover);
    }
  }

  // --- Acquire + Return home -----------------------------------------------

  /** `STATE_RAGE` entry — set target, leash origin, pursue speed, follow packet. */
  private acquire(m: CMover, target: CPlayer, now: number): void {
    m.m_idTarget = target.m_idPlayer;
    m.m_vPosDamage = { ...m.m_vPos };
    m.m_tmAttack = now + CHASE_WINDOW_MS;
    m.m_fSpeedFactor = PURSUE_SPEED_FACTOR;
    m.m_nextAttackTick = 0;
    m.m_tmNextWander = 0;
    const pkt = this.destObj.build(m.m_idMover, target.m_idPlayer, m.m_nAttackRange);
    this.deps.zoneManager.broadcastAround(m.m_vPos, m.m_nZoneId, VISIBILITY_RADIUS, pkt);
  }

  /** `DoReturnToBegin(TRUE)` — drop target, run home at 2.66×. */
  private startReturn(m: CMover, now: number): void {
    m.m_idTarget = NULL_ID;
    m.m_bReturnToBegin = true;
    m.m_tmReturnToBegin = now;
    m.m_fSpeedFactor = RETURN_SPEED_FACTOR;
    this.moveTo(m, m.m_vPosBegin, now, false);
  }

  /** Step home; on arrival restore HP + reset. 20 s stuck-cap → snap home. */
  private stepReturnHome(m: CMover, now: number, dtMs: number): void {
    if (distSq2(m.m_vPos, m.m_vPosBegin) <= HOME_ARRIVAL * HOME_ARRIVAL
      || now - m.m_tmReturnToBegin > RETURN_STUCK_MS) {
      m.m_vPos = { ...m.m_vPosBegin };
      m.m_vDestPos = { ...m.m_vPosBegin };
      m.m_bReturnToBegin = false;
      m.m_fSpeedFactor = 1.0;
      m.m_nHitPoint = m.m_nMaxHitPoint;
      m.m_tmNextWander = now + stopInterval();
      return;
    }
    stepToward(m, m.m_vPosBegin, RETURN_SPEED_FACTOR, m.m_fSpeedBase, dtMs);
  }

  // --- Shared: commit a positional move (snap + DESTPOS) -------------------

  /** Snap `m_vPos` to `target`, record dest, broadcast DESTPOS, arm next wander. */
  private moveTo(m: CMover, target: Vec3, now: number, _walk: boolean): void {
    m.m_vPos = { ...target };
    m.m_vDestPos = { ...target };
    m.m_tmNextWander = now + stopInterval();
    const pkt = this.dest.build(m.m_idMover, { vPos: target, fForward: 1 });
    this.deps.zoneManager.broadcastAround(m.m_vPos, m.m_nZoneId, VISIBILITY_RADIUS, pkt);
  }
}

// --- helpers ----------------------------------------------------------------

/** Step `m.m_vPos` toward `dest` on the ground plane by `speedFactor·fSpeed·dt`. */
function stepToward(m: CMover, dest: Vec3, speedFactor: number, fSpeed: number, dtMs: number): void {
  if (fSpeed <= 0) return;
  const dx = dest.x - m.m_vPos.x;
  const dz = dest.z - m.m_vPos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const step = (fSpeed * speedFactor * SPEED_SCALE) * (dtMs / 1000);
  if (step >= d) {
    m.m_vPos = { x: dest.x, y: m.m_vPos.y, z: dest.z };
  } else {
    m.m_vPos = { x: m.m_vPos.x + (dx / d) * step, y: m.m_vPos.y, z: m.m_vPos.z + (dz / d) * step };
  }
}

/** Inclusive random int in `[min, max]`. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 5–6 s stop interval — `SEC(5) + xRandom(SEC(1))`. */
function stopInterval(): number {
  return STOP_MIN_MS + Math.floor(Math.random() * STOP_JITTER_MS);
}

/** Ground-plane (x/z) squared distance. */
function distSq2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
