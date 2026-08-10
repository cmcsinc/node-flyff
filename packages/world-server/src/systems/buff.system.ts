/**
 * BuffSystem -- per-second timed-buff expiry sweep.
 *
 * Port of `CMover::ProcessBuff` (`_Common/Mover.cpp:3880`) driven off the
 * `CF_SEC` (1 s) tick: for every living player, {@link BuffManager.tick} drops
 * expired buffs (reversing their DST effects on `m_params`), and this system
 * broadcasts `REMOVESKILLINFULENCE` per expired buff so the client drops the
 * icon, then clamps HP/MP/FP so an expiring +MAX buff does not leave the player
 * over-cap (the equip `clampVitals` pattern).
 *
 * Owns its own `setInterval` (idempotent start/stop mirroring `RecoverySystem`),
 * stopped on shutdown via `index.ts`. No `await` in the callback (rule 05).
 *
 * ponytail: per-dst `SETDESTPARAM` sync on expiry (the client currently trusts
 * the server's DST pool; its own stat window may lag a buff drop until the next
 * SetState). Buff-grant items + death-clear (`clear()` on revive) wire in next.
 *
 * @module systems/buff
 */

import { createLogger } from '@flyff/core/logger';
import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import type { CPlayer, ActiveBuff } from '@flyff/entities';
import { buildRemoveSkillInfluence, buildResetDestParam, buildSetPointParam, DST_HP, DST_MP, DST_FP, VISIBILITY_RADIUS } from '@flyff/world-core';

const logger = createLogger({ module: 'buff' });

/** `CMover::ProcessBuff` fires every CF_SEC (1 s). */
const TICK_INTERVAL_MS = 1_000;

export interface BuffSystemDeps {
  readonly playerManager: PlayerManager;
  readonly zoneManager: ZoneManager;
}

export class BuffSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: BuffSystemDeps) {}

  /** Begin the expiry loop (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'BuffSystem started');
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        logger.error({ err }, 'Buff expiry loop failed');
      }
    }, TICK_INTERVAL_MS);
  }

  /** One expiry pass -- public so a unified tick could drive it later. */
  tick(now: number): void {
    for (const p of this.deps.playerManager.all()) {
      if (p.m_bDead) continue;
      // Apply due DoT ticks (poison/bleed) BEFORE the expiry sweep so a buff
      // expiring this second still deals its final-tick damage first.
      const dots = p.m_buffs.tickDots(now);
      if (dots.length > 0) this.onDots(p, dots);
      const expired = p.m_buffs.tick(now);
      if (expired.length > 0) this.onExpired(p, expired);
    }
  }

  /** Apply periodic-damage ticks: subtract HP, sync the bar, flag death. */
  private onDots(p: CPlayer, dots: readonly { buff: ActiveBuff; damage: number }[]): void {
    let total = 0;
    for (const d of dots) total += d.damage;
    if (total <= 0) return;
    p.m_nHp = Math.max(0, p.m_nHp - total);
    p._dirty.add('m_nHp');
    this.syncVital(p, DST_HP, p.m_nHp);
    // ponytail: DAMAGE snapshot (poison hit number/SFX) + killer attribution +
    // trigger onPlayerDeath when a DoT crosses 0 (currently combat/AI own death).
  }

  /** Broadcast removal + clamp vitals for the expired buffs. */
  private onExpired(p: CPlayer, expired: readonly ActiveBuff[]): void {
    for (const buff of expired) {
      this.deps.zoneManager.broadcastAround(
        p.m_vPos, p.m_nZoneId, VISIBILITY_RADIUS,
        buildRemoveSkillInfluence(p.m_idPlayer, buff.type, buff.skillId),
      );
      // Reverse each DST delta so the client's stat window drops the buff.
      for (const e of buff.effects) {
        this.deps.zoneManager.broadcastAround(
          p.m_vPos, p.m_nZoneId, VISIBILITY_RADIUS,
          buildResetDestParam(p.m_idPlayer, e.dst, e.adj),
        );
      }
    }
    // An expiring +HP_MAX/+MP_MAX/+FP_MAX buff may drop the cap below the
    // current vital -- clamp and sync so the client bar matches the server.
    this.clampVitals(p);
  }

  private clampVitals(p: CPlayer): void {
    const maxHp = p.getMaxHp();
    const maxMp = p.getMaxMp();
    const maxFp = p.getMaxFp();
    p.m_nMaxHp = maxHp;
    p.m_nMaxMp = maxMp;
    p.m_nMaxFp = maxFp;
    if (p.m_nHp > maxHp) {
      p.m_nHp = maxHp;
      p._dirty.add('m_nHp');
      this.syncVital(p, DST_HP, p.m_nHp);
    }
    if (p.m_nMp > maxMp) {
      p.m_nMp = maxMp;
      p._dirty.add('m_nMp');
      this.syncVital(p, DST_MP, p.m_nMp);
    }
    if (p.m_nFp > maxFp) {
      p.m_nFp = maxFp;
      this.syncVital(p, DST_FP, p.m_nFp);
    }
  }

  /**
   * One `SETPOINTPARAM` to the whole visibility range (self included), per
   * `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4658`). DoT ticks and
   * buff-expiry clamps must reach peers or a poisoned player's HP bar freezes in
   * everyone else's target display.
   */
  private syncVital(p: CPlayer, dst: number, value: number): void {
    this.deps.zoneManager.broadcastAround(
      p.m_vPos, p.m_nZoneId, VISIBILITY_RADIUS,
      buildSetPointParam(p.m_idPlayer, dst, value),
    );
  }

  /** Stop the expiry loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
