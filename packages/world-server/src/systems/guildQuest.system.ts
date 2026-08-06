/**
 * GuildQuestSystem -- the guild-quest arena tick.
 *
 * Port of `CGuildQuestProcessor::Process`'s call site: `ThreadMng.cpp:413`,
 * inside the one-second block of the world thread. Unlike the guild-war tick,
 * this one really is a one-second poll in the original, so the interval is
 * faithful rather than normalized.
 *
 * Note the C++ call site is **not** gated on `EVE_WORMON` -- `Process` runs
 * every second whether or not the flag is on, and simply walks an empty table.
 * `GuildQuestService.tick` re-checks the flag itself, mirroring that shape while
 * making a flag-off world do no work.
 *
 * Owns its own `setInterval` (idempotent start/stop, mirroring
 * {@link GuildWarSystem}), stopped on shutdown via `index.ts`. No `await` in the
 * callback (rule 05) -- the service's persistence goes through the manager
 * fire-and-forget.
 *
 * @module systems/guildQuest
 */

import { createLogger } from '@flyff/core/logger';
import type { GuildQuestService } from '@flyff/guild';

const logger = createLogger({ module: 'guild-quest' });

/** `ThreadMng.cpp:413` -- the one-second world block. */
const TICK_INTERVAL_MS = 1000;

export interface GuildQuestSystemDeps {
  readonly questService: Pick<GuildQuestService, 'tick'>;
}

export class GuildQuestSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: GuildQuestSystemDeps) {}

  /** Begin the arena poll (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_INTERVAL_MS }, 'GuildQuestSystem started');
    this.timer = setInterval(() => {
      try {
        this.deps.questService.tick();
      } catch (err) {
        logger.error({ err }, 'guild quest tick failed');
      }
    }, TICK_INTERVAL_MS);
  }

  /** Stop the poll (idempotent). */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('GuildQuestSystem stopped');
  }
}
