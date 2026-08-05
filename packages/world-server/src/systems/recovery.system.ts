/**
 * RecoverySystem -- passive HP/MP/FP regen for living players.
 *
 * Port of `CMover::ProcessRecovery` (`_Common/Mover.cpp:8167`) stand branch:
 * every `NEXT_TICK_RECOVERYSTAND` (3 s) a player NOT in `IsAttackMode()` (no
 * damage taken in the last 10 s) recovers `GetHPRecovery/GetMPRecovery/
 * GetFPRecovery`. Combat (`m_nAtkCnt` in C++) is ported as a wall-clock cursor
 * `m_tmLastDamage` stamped by `AISystem.monsterSwing` (damage taken) and
 * `CombatService.applyHit` (damage dealt) -- fighting in either direction
 * pauses regen for the 10 s window.
 *
 * Sit regen (2 s, party Stretching 1.8x/1.5x) is out of scope -- no sit state or
 * party system yet; ponytail: add a sit branch + multiplier when motion/party
 * land. Monster passive regen is intentionally NOT ported (no S->C monster-HP
 * sync packet -- server-side heal desyncs the client; see memory
 * `v19-monster-leash-heal-no-sync`).
 *
 * Owns its own `setInterval` (idempotent start/stop mirroring `CheckpointSystem`),
 * stopped on shutdown via `index.ts`. No `await` in the callback (rule 05).
 * `maxFatiguePoint` is recomputed per tick -- cheap, idempotent, and keeps FP
 * max correct after a level-up without a separate mutation hook.
 *
 * @module systems/recovery
 */

import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { getJobProps } from '@flyff/combat';
import { standRecovery } from '@flyff/combat';
import { buildSetPointParam, DST_HP, DST_MP, DST_FP, VISIBILITY_RADIUS } from '@flyff/world-core';

const logger = createLogger({ module: 'recovery' });

/** Poll cadence -- finer than the 3 s regen tick so the combat gate is responsive. */
const TICK_INTERVAL_MS = 1_000;
/** `NEXT_TICK_RECOVERYSTAND` (`Mover.h:111`) -- stand regen fires every 3 s. */
const STAND_INTERVAL_MS = 3_000;
/** `IsAttackMode` window (`Mover.cpp:9229`) -- 10 s (v9+ `__RECOVERY10`). */
const COMBAT_GATE_MS = 10_000;

export interface RecoverySystemDeps {
  readonly playerManager: PlayerManager;
  /**
   * Vicinity fan-out for the regen `SETPOINTPARAM` frames. C++
   * `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4658`) is
   * `FOR_VISIBILITYRANGE`, *including* the mover itself -- every visible
   * player's HP bar tracks the regen, not just the owner's. Optional so existing
   * tests can construct the system without it; absent falls back to self-only.
   */
  readonly zoneManager?: ZoneManager;
  /**
   * Cheer-point regen. C++ drives `CMover::CheckTickCheer` from the same
   * per-user tick as `ProcessRecovery` (`WORLDSERVER/User.cpp:438`), so it
   * rides this loop rather than owning a second timer. Optional so existing
   * tests can construct the system without it.
   */
  readonly cheerService?: { tick(player: CPlayer, now: number): void };
  /**
   * Campus point regen. C++ calls `CCampusHelper::RecoveryCampusPoint` from the
   * same per-user tick as `ProcessRecovery` (`WORLDSERVER/User.cpp:433`), so it
   * rides this loop too. Only regenerates while a player's campus points are
   * negative -- the service owns that check.
   */
  readonly campusService?: { recoverPoints(player: CPlayer, now: number): void };
}

export class RecoverySystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: RecoverySystemDeps) {}

  /** Begin the recovery loop (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'RecoverySystem started');
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        logger.error({ err }, 'Recovery loop failed');
      }
    }, TICK_INTERVAL_MS);
  }

  /** One regen pass -- public so a unified tick could drive it later. */
  tick(now: number): void {
    for (const p of this.deps.playerManager.all()) {
      this.recoverOne(p, now);
      // Cheer points regen regardless of combat state (CheckTickCheer has no
      // IsAttackMode gate, unlike ProcessRecovery), so it sits outside recoverOne.
      this.deps.cheerService?.tick(p, now);
      // Campus points: also outside recoverOne (no combat gate), and a no-op
      // unless the balance is negative.
      this.deps.campusService?.recoverPoints(p, now);
    }
  }

  private recoverOne(p: CPlayer, now: number): void {
    if (p.m_bDead || p.m_nHp <= 0) {
      logger.debug({ charId: p.m_idPlayer, dead: p.m_bDead, hp: p.m_nHp }, 'recover skip dead');
      return;
    }

    // Player vitals maxes are formula-derived (C++ `GetMaxOriginHitPoint`/
    // `ManaPoint`/`FatiguePoint`), NOT DB-backed -- the client computes the same
    // formula and displays it, so the server must match or regen clamps against
    // a stale ceiling (the DB `max_hp`/`max_mp` columns). Recompute each tick
    // so it tracks level/STA/INT without a level-up hook.
    const job = getJobProps(p.m_nJob);
    // Buffed maxes: getMaxHp/Mp/Fp fold equip + DST bonuses (DST_HP_MAX flat +
    // DST_HP_MAX_RATE %). Bare `maxHitPoint()` omits them, so a +HP_MAX ring
    // wouldn't raise the regen ceiling until unequip clamped it.
    p.m_nMaxHp = p.getMaxHp();
    p.m_nMaxMp = p.getMaxMp();
    p.m_nMaxFp = p.getMaxFp();

    // Combat gate: in C++ the in-combat branch pushes `m_dwTickRecoveryStand`
    // forward, so regen waits a fresh 3 s after combat clears. Mirror that.
    // `m_tmLastDamage === 0` means never hit -- not the same as "hit at t=0".
    // Stamped both when the player takes damage (`AISystem.monsterSwing`) AND
    // when they deal it (`CombatService.applyHit`) -- fighting = no regen.
    if (p.m_tmLastDamage !== 0 && now - p.m_tmLastDamage < COMBAT_GATE_MS) {
      logger.debug(
        { charId: p.m_idPlayer, sinceDmg: now - p.m_tmLastDamage },
        'recover gated (combat)',
      );
      p.m_tmNextRecovery = now + STAND_INTERVAL_MS;
      return;
    }
    if (now < p.m_tmNextRecovery) return;
    p.m_tmNextRecovery = now + STAND_INTERVAL_MS;

    const rec = standRecovery(
      p.m_nLevel, p.getSta(), p.getInt(),
      p.m_nMaxHp, p.m_nMaxMp, p.m_nMaxFp,
      job,
      p.m_params,
    );

    logger.debug(
      { charId: p.m_idPlayer, hp: p.m_nHp, maxHp: p.m_nMaxHp, mp: p.m_nMp, maxMp: p.m_nMaxMp, fp: p.m_nFp, maxFp: p.m_nMaxFp, rec: { hp: rec.hp, mp: rec.mp, fp: rec.fp } },
      'recover fire',
    );

    const hpBefore = p.m_nHp;
    const mpBefore = p.m_nMp;
    const fpBefore = p.m_nFp;
    p.m_nHp = Math.min(p.m_nMaxHp, hpBefore + rec.hp);
    p.m_nMp = Math.min(p.m_nMaxMp, mpBefore + rec.mp);
    p.m_nFp = Math.min(p.m_nMaxFp, fpBefore + rec.fp);

    if (p.m_nHp !== hpBefore) {
      p._dirty.add('m_nHp');
      this.syncVital(p, DST_HP, p.m_nHp);
    }
    if (p.m_nMp !== mpBefore) {
      p._dirty.add('m_nMp');
      this.syncVital(p, DST_MP, p.m_nMp);
    }
    if (p.m_nFp !== fpBefore) {
      this.syncVital(p, DST_FP, p.m_nFp);
    }
  }

  /**
   * Push one `SETPOINTPARAM` to the whole visibility range (self included), per
   * `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4658`). This is what
   * keeps another player's HP bar live in the target display -- without it a
   * peer's bar only moves on DAMAGE deltas and drifts on regen/heal.
   */
  private syncVital(p: CPlayer, dst: number, value: number): void {
    const packet = buildSetPointParam(p.m_idPlayer, dst, value);
    if (this.deps.zoneManager) {
      this.deps.zoneManager.broadcastAround(p.m_vPos, p.m_nZoneId, VISIBILITY_RADIUS, packet);
      return;
    }
    this.deps.playerManager.sendTo(p, packet);
  }

  /** Stop the recovery loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
