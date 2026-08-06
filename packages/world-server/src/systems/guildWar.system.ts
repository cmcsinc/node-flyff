/**
 * GuildWarSystem -- the guild-war expiry + master-absence tick.
 *
 * Port of `CGuildWarMng::Process` (`_Common/guildwar.cpp:332-343`), which vanilla
 * calls from the world frame loop behind the `EVE_GUILDWAR` flag
 * (`ThreadMng.cpp:466`).
 *
 * **The interval is a deliberate rate change.** C++ calls `Process` on every pass
 * of a `WaitForSingleObject(..., 1)` loop -- roughly a thousand times a second --
 * and each pass bumps `nAbsent` for any side whose master is offline. Nothing
 * reads that number's absolute value; `OnWarTimeout` only compares the two sides
 * (`DPCoreSrvr.cpp:1722`). So the manager normalizes the counter to whole seconds
 * and this system ticks at one second, which preserves every comparison while
 * making the stored value mean something.
 *
 * The other job -- expiring a war past its two hours -- is time-based, so a
 * one-second poll resolves a war within a second of its deadline.
 *
 * Owns its own `setInterval` (idempotent start/stop, mirroring
 * {@link GuildSalarySystem}), stopped on shutdown via `index.ts`. No `await` in
 * the callback (rule 05) -- the service's persistence goes through the manager
 * fire-and-forget.
 *
 * @module systems/guildWar
 */

import { createLogger } from '@flyff/core/logger';
import type { GuildWarService } from '@flyff/guild';

const logger = createLogger({ module: 'guild-war' });

/**
 * Poll interval. Matches the manager's `nAbsent` accumulation unit, so each tick
 * contributes exactly one second of absence and the two stay in step.
 */
const TICK_INTERVAL_MS = 1000;

export interface GuildWarSystemDeps {
  readonly warService: Pick<GuildWarService, 'tick'>;
}

export class GuildWarSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: GuildWarSystemDeps) {}

  /** Begin the war poll (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'GuildWarSystem started');
    this.timer = setInterval(() => {
      try {
        this.deps.warService.tick(TICK_INTERVAL_MS);
      } catch (err) {
        logger.error({ err }, 'guild war tick failed');
      }
    }, TICK_INTERVAL_MS);
  }

  /** Stop the poll (idempotent). */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('GuildWarSystem stopped');
  }
}
