/**
 * CheckpointSystem -- periodic 30 s flush of live player checkpoint state.
 *
 * C++ snapshots each character roughly every 30 s (`CUser::Snapshot` /
 * `SavePlayer`, MoverParam.cpp). The disconnect path
 * (`JoinService.disconnectByCharId`) already covers graceful logout; this loop
 * covers the OTHER case -- a hard server crash (kill -9, OOM, power loss)
 * where no per-socket `close` fires. Without it, a crash mid-session loses all
 * position/HP progress since the last login.
 *
 * It flushes only the checkpoint fields (position, angle, vitals, stats, bank
 * gold) -- dupe-critical state (gold/exp/inventory/skills) is already
 * write-through + WAL-backed at mutation time, so the loop has no part in
 * crash-recovery for those.
 *
 * Owns its own `setInterval` (idempotent start/stop mirroring `AISystem`),
 * stopped on shutdown via `index.ts`. No `await` in the callback body (rule
 * 05) -- the flush is fire-and-forget per player.
 *
 * @module systems/checkpoint
 */

import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'checkpoint' });

/** C++ save cadence (~30 s). */
const FLUSH_INTERVAL_MS = 30_000;

export interface CheckpointSystemDeps {
  /** Flush every live player's checkpoint state (see `JoinService.flushAll`). */
  flush: () => void;
}

export class CheckpointSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: CheckpointSystemDeps) {}

  /** Begin the checkpoint loop (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.deps.flush();
      } catch (err) {
        logger.error({ err }, 'Checkpoint loop failed');
      }
    }, FLUSH_INTERVAL_MS);
  }

  /** Stop the checkpoint loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
