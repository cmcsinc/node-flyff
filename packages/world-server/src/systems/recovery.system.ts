/**
 * RecoverySystem -- passive HP/MP/FP regen for living players.
 *
 * Port of `CMover::ProcessRecovery` (`_Common/Mover.cpp:8167`) stand branch:
 * every `NEXT_TICK_RECOVERYSTAND` (3 s) a player NOT in `IsAttackMode()` (no
 * damage taken in the last 10 s) recovers `GetHPRecovery/GetMPRecovery/
 * GetFPRecovery`. Combat (`m_nAtkCnt` in C++) is ported as a wall-clock cursor
 * `m_tmLastDamage` stamped by `AISystem.monsterSwing` on every hit.
 *
 * Sit regen (2 s, party Stretching 1.8x/1.5x) is out of scope -- no sit state or
 * party system yet; ponytail: add a sit branch + multiplier when motion/party
 * land. Monster passive regen is intentionally NOT ported (no S->C monster-HP
 * sync packet -- server-side heal desyncs the client; see memory
 * `v15-monster-leash-heal-no-sync`).
 *
 * Owns its own `setInterval` (idempotent start/stop mirroring `CheckpointSystem`),
 * stopped on shutdown via `index.ts`. No `await` in the callback (rule 05).
 * `maxFatiguePoint` is recomputed per tick -- cheap, idempotent, and keeps FP
 * max correct after a level-up without a separate mutation hook.
 *
 * @module systems/recovery
 */

import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { CPlayer } from '../entities/player.js';
import { getJobProps } from '../combat/tables.js';
import { maxFatiguePoint, standRecovery } from '../combat/formulas.js';
import { buildSetPointParam, DST_HP, DST_MP, DST_FP } from '../net/snapshot/pointParam.serializer.js';

const logger = createLogger({ module: 'recovery' });

/** Poll cadence -- finer than the 3 s regen tick so the combat gate is responsive. */
const TICK_INTERVAL_MS = 1_000;
/** `NEXT_TICK_RECOVERYSTAND` (`Mover.h:111`) -- stand regen fires every 3 s. */
const STAND_INTERVAL_MS = 3_000;
/** `IsAttackMode` window (`Mover.cpp:9229`) -- 10 s (v9+ `__RECOVERY10`). */
const COMBAT_GATE_MS = 10_000;

export interface RecoverySystemDeps {
  readonly playerManager: PlayerManager;
}

export class RecoverySystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: RecoverySystemDeps) {}

  /** Begin the recovery loop (idempotent). */
  start(): void {
    if (this.timer) return;
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
    }
  }

  private recoverOne(p: CPlayer, now: number): void {
    if (p.m_bDead || p.m_nHp <= 0) return;

    // FP has no DB column -- derive max from the formula each tick so it tracks
    // level/STA without a level-up hook.
    const job = getJobProps(p.m_nJob);
    p.m_nMaxFp = maxFatiguePoint(p.m_nLevel, p.m_nSta, job.fFactorMaxFP);

    // Combat gate: in C++ the in-combat branch pushes `m_dwTickRecoveryStand`
    // forward, so regen waits a fresh 3 s after combat clears. Mirror that.
    // `m_tmLastDamage === 0` means never hit -- not the same as "hit at t=0".
    if (p.m_tmLastDamage !== 0 && now - p.m_tmLastDamage < COMBAT_GATE_MS) {
      p.m_tmNextRecovery = now + STAND_INTERVAL_MS;
      return;
    }
    if (now < p.m_tmNextRecovery) return;
    p.m_tmNextRecovery = now + STAND_INTERVAL_MS;

    const rec = standRecovery(
      p.m_nLevel, p.m_nSta, p.m_nInt,
      p.m_nMaxHp, p.m_nMaxMp, p.m_nMaxFp,
      job,
    );

    const hpBefore = p.m_nHp;
    const mpBefore = p.m_nMp;
    const fpBefore = p.m_nFp;
    p.m_nHp = Math.min(p.m_nMaxHp, hpBefore + rec.hp);
    p.m_nMp = Math.min(p.m_nMaxMp, mpBefore + rec.mp);
    p.m_nFp = Math.min(p.m_nMaxFp, fpBefore + rec.fp);

    if (p.m_nHp !== hpBefore) {
      p._dirty.add('m_nHp');
      this.deps.playerManager.sendTo(p, buildSetPointParam(p.m_idPlayer, DST_HP, p.m_nHp));
    }
    if (p.m_nMp !== mpBefore) {
      p._dirty.add('m_nMp');
      this.deps.playerManager.sendTo(p, buildSetPointParam(p.m_idPlayer, DST_MP, p.m_nMp));
    }
    if (p.m_nFp !== fpBefore) {
      this.deps.playerManager.sendTo(p, buildSetPointParam(p.m_idPlayer, DST_FP, p.m_nFp));
    }
  }

  /** Stop the recovery loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
