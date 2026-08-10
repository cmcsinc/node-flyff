/**
 * PkDecaySystem -- periodic PK-value decay (`CMover::ProcessPKValue`).
 *
 * A player's PK state (`m_dwPKPropensity` / `m_nPKValue`) is not permanent.
 * C++ `ProcessPKValue` (driven off the `CF_SEC` tick) decrements the PK value
 * over time: each PK point decays after a fixed interval since the last PK
 * action (`m_dwPKTime`). When `m_nPKValue` reaches 0, the player is no longer
 * chaotic (`m_dwPKPropensity = 0`) and guards stop attacking them.
 *
 * Owns its own `setInterval` (idempotent start/stop mirroring `BuffSystem`),
 * stopped on shutdown via `index.ts`. No `await` in the callback (rule 05).
 *
 * The decayed PK state is persisted fire-and-forget via `CharacterRepository.
 * updatePKState`; the previous WAL `PK_KILL` row pins a known-good state for
 * crash recovery. The PK snapshot is re-broadcast on every change so peers see
 * the name color drop in real time.
 *
 * ponytail: per-PK-level decay rate table (`KarmaProp`), PK-exp counter-decay,
 * and the C++ exponential decay curve (`PKValue *= 0.9` per tick) -- the v1
 * linear decrement is the simplest correct shape.
 *
 * @module systems/pkDecay
 */

import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CharacterRepository } from '@flyff/database';
import type { CPlayer } from '@flyff/entities';

const logger = createLogger({ module: 'pkDecay' });

/** The decay sweep cadence (C++ `ProcessPKValue` fires off the CF_SEC tick). */
const TICK_INTERVAL_MS = 60_000;
/**
 * Wall-clock ms a player must remain PK-action-free before one PK point decays
 * (C++ decay is gated on elapsed time since `m_dwPKTime`). 5 minutes per point.
 */
const PK_DECAY_COOLDOWN_MS = 5 * 60_000;

export interface PkDecaySystemDeps {
  readonly playerManager: PlayerManager;
  readonly charRepo: Pick<CharacterRepository, 'updatePKState'>;
}

export class PkDecaySystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: PkDecaySystemDeps) {}

  /** Begin the decay sweep (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'PkDecaySystem started');
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        logger.error({ err }, 'PK decay loop failed');
      }
    }, TICK_INTERVAL_MS);
  }

  /** One decay pass -- public so a unified tick could drive it later. */
  tick(now: number): void {
    for (const p of this.deps.playerManager.all()) {
      if (p.m_bDead) continue;
      if (!p.isChaotic()) continue; // nothing to decay
      this.decayOne(p, now);
    }
  }

  /**
   * Decrement one PK point from `p` if the cooldown since its last PK action has
   * elapsed. When `m_nPKValue` hits 0, clear chaotic state entirely. Persists
   * fire-and-forget. Idempotent -- a chaotic player with no recent PK action
   * decays exactly one point per `PK_DECAY_COOLDOWN_MS`.
   */
  private decayOne(p: CPlayer, now: number): void {
    const elapsed = now - p.m_dwPKTime;
    if (elapsed < PK_DECAY_COOLDOWN_MS) return;
    p.m_nPKValue = Math.max(0, p.m_nPKValue - 1);
    if (p.m_nPKValue === 0) {
      // PK value exhausted -- player is no longer chaotic.
      p.m_dwPKPropensity = 0;
    }
    // Stamp a new decay base so the next point waits its full cooldown.
    p.m_dwPKTime = now;
    p._dirty.add('m_nPKValue');
    p._dirty.add('m_dwPKPropensity');
    p._dirty.add('m_dwPKTime');
    logger.info(
      { charId: p.m_idPlayer, pkValue: p.m_nPKValue, chaotic: p.isChaotic() },
      'PK value decayed',
    );
    // Persist fire-and-forget (rule 02: service calls repo, no SQL).
    this.deps.charRepo.updatePKState(
      p.m_idPlayer, p.m_dwPKPropensity, p.m_nPKValue, p.m_dwPKTime,
    ).catch((err: unknown) => { logger.error({ err, charId: p.m_idPlayer }, 'PK decay persist failed'); });
  }

  /** Stop the decay sweep (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}