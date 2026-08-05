/**
 * BlinkwingSystem -- fires armed item channels when their timer elapses.
 *
 * Ports the `STATE_BASEMOTION_MODE` block of `CUser::Process`
 * (`WORLDSERVER/User.cpp:382-410`): once `dwTick >= m_nReadyTime`, C++ re-enters
 * `DoUseItem` for the channeling item, which this time passes `IsItemRedyTime`
 * and reaches the teleport. Here that second pass is
 * {@link BlinkwingService.complete}.
 *
 * C++ polls this from the per-user tick (every frame). A blinkwing channel is
 * 10 s and the Return scroll 300 s, so a 250 ms poll is well inside the
 * granularity a player can perceive while costing one `Map` sweep per tick.
 * Owns its own `setInterval` (idempotent start/stop, mirroring
 * {@link BuffSystem}); stopped on shutdown from `index.ts`. No `await` in the
 * callback (rule 05).
 *
 * @module systems/blinkwing
 */

import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { BlinkwingService } from '@flyff/inventory';

const logger = createLogger({ module: 'blinkwing' });

/** Poll cadence. Channels are 10 s / 300 s, so this is 40x finer than needed. */
const TICK_INTERVAL_MS = 250;

export interface BlinkwingSystemDeps {
  readonly playerManager: PlayerManager;
  readonly blinkwingService: BlinkwingService;
}

export class BlinkwingSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: BlinkwingSystemDeps) {}

  /** Begin the channel-completion loop (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'BlinkwingSystem started');
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        logger.error({ err }, 'Blinkwing channel loop failed');
      }
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('BlinkwingSystem stopped');
  }

  /** One completion pass -- public so a unified tick could drive it later. */
  tick(now: number): void {
    for (const p of this.deps.playerManager.all()) {
      if (p.m_nReadyTime === 0) continue;
      // C++ `CMover::DoDie` (`Mover.cpp:5391`) clears the channel outright. Without
      // this a player who dies mid-cast keeps STATE_BASEMOTION_MODE until the timer
      // runs out -- 5 minutes for the Return scroll -- and cannot start another.
      if (p.m_bDead) { this.deps.blinkwingService.cancel(p); continue; }
      if (now < p.m_nReadyTime) continue;
      this.deps.blinkwingService.complete(p);
    }
  }
}
