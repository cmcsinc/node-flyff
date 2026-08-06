/**
 * GuildSalarySystem -- the 21:00 guild payroll tick.
 *
 * Port of `CGuildMng::Process` (`_Common/guild.cpp:1089`), which vanilla calls
 * from the world-server frame loop. It reads the wall clock rather than counting
 * elapsed time: at hour 21 it pays every guild that can afford its full payroll,
 * at hour 22 it clears the once-per-day latches. The latch is what keeps a
 * once-per-evening payout correct despite being polled continuously.
 *
 * Because the whole decision is "what hour is it", the poll interval only has to
 * be fine enough not to miss an hour boundary. One minute is two orders of
 * magnitude finer than needed and costs a Map walk per minute.
 *
 * Owns its own `setInterval` (idempotent start/stop, mirroring `BuffSystem` /
 * `RecoverySystem`), stopped on shutdown via `index.ts`. No `await` in the
 * callback (rule 05) -- {@link GuildContributionService.tickSalary} does its
 * persistence fire-and-forget through the manager.
 *
 * @module systems/guildSalary
 */

import { createLogger } from '@flyff/core/logger';
import type { GuildContributionService } from '@flyff/guild';

const logger = createLogger({ module: 'guild-salary' });

/**
 * Poll interval. C++ checks on every frame; the decision is hour-granular, so a
 * minute is ample and cannot skip the 21:00 or 22:00 boundary.
 */
const TICK_INTERVAL_MS = 60_000;

export interface GuildSalarySystemDeps {
  readonly contributionService: Pick<GuildContributionService, 'tickSalary'>;
}

export class GuildSalarySystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: GuildSalarySystemDeps) {}

  /** Begin the payroll poll (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'GuildSalarySystem started');
    this.timer = setInterval(() => {
      try {
        this.deps.contributionService.tickSalary();
      } catch (err) {
        logger.error({ err }, 'guild salary tick failed');
      }
    }, TICK_INTERVAL_MS);
  }

  /** Stop the poll (idempotent). */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('GuildSalarySystem stopped');
  }
}
