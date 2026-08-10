/**
 * AdminCommandService -- executes admin-panel commands against the live world.
 *
 * The three actions the admin panel can trigger. Each reuses the existing,
 * already-correct in-world path rather than re-deriving it:
 *
 * - **kick**: send the forced-logout notice (see `kick.serializer.ts` -- the
 *   C++ server sends NOTHING and the v19 client silently freezes on a bare
 *   close), then `socket.destroy()` after a short grace window so the notice
 *   actually leaves the wire. The close lets `index.ts`'s `onDisconnect` hook
 *   run (party cleanup + `joinService.disconnectByCharId` checkpoint flush).
 *   This is deliberately NOT the `/out` GM command's path
 *   (`command.service.ts:570`), which destroys the socket AND removes the
 *   player from `PlayerManager` itself -- pre-empting the hook, so position /
 *   vitals / stats never get flushed.
 * - **teleport**: SETPOS (`SNAPSHOTTYPE_SETPOS` 0x0010) + vicinity resend,
 *   mirroring `CommandService.applyReplace`. Never REPLACE (0x00f2): it nulls
 *   the client's `g_pPlayer` (`DPClient.cpp:2352`) and the first window to
 *   deref it crashes. With no coords, the destination is the player's zone
 *   `revival.position` -- the same "town" source `RevivalService.
 *   teleportToRevival` uses (revival.service.ts:221).
 * - **mailPushed**: re-push the mailbox + re-evaluate `MODE_MAILBOX` so an
 *   online player sees admin mail immediately.
 * - **kickAll**: the same kick, fanned over every online player, but with the
 *   state flush **awaited** rather than left to the socket-close hook. The hook
 *   path is fire-and-forget (`void joinService.disconnectByCharId`), which is
 *   fine for one player leaving a running world and useless for a drain --
 *   nothing would be durable before the caller returns.
 *
 * Offline characters are a silent no-op for kick/teleport/mailPushed: the DB
 * row is already the source of truth for a logged-out player (the admin panel
 * edits it directly), and JOIN re-reads it.
 *
 * @module services/adminCommand.service
 */

import { Validate } from '@flyff/core/utils/validate';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, Vec3 } from '@flyff/entities';
import type { ZoneDefinition } from '@flyff/resources';
import type { PlayerManager } from '@flyff/world-core';
import type { MailHandler } from '@flyff/mail';
import type { AdminCommandSink } from '../ipc/adminListener';
import type { SetPosSerializer } from '../net/snapshot/setPos.serializer';
import { buildKickNotice, KICK_CLOSE_DELAY_MS } from '../net/snapshot/kick.serializer';

const logger = createLogger({ module: 'admin-command-service' });

export interface AdminCommandServiceDeps {
  playerManager: PlayerManager;
  setPosSer: SetPosSerializer;
  zones: { byNumericId: Map<number, ZoneDefinition> };
  /** Re-diffs the player's view (ADD_OBJ/DEL_OBJ) after a teleport. */
  refreshVisibility: (player: CPlayer) => void;
  mailHandler?: MailHandler;
  /** Notice -> close grace window. Defaults to `KICK_CLOSE_DELAY_MS`. */
  kickCloseDelayMs?: number;
  /**
   * State flush for one character -- `JoinService.disconnectByCharId`. Only
   * `kickAll` needs it (single kicks let the socket-close hook do the flush);
   * omit it and `kickAll` disconnects without saving.
   */
  saveAndLeave?: (charId: number) => Promise<void>;
  /**
   * Pre-removal teardown for one player -- the same work the dispatcher's
   * socket-close hook does before `disconnectByCharId` (party, trade, friend,
   * campus, visibility). `kickAll` MUST run it explicitly: `saveAndLeave` drops
   * the player from `PlayerManager`, so by the time the deferred socket close
   * fires the hook can no longer resolve them and the teardown is skipped.
   *
   * The one that loses data is trade: `putGold` debits `m_nGold` and journals
   * the debited `CHAR_GOLD` at stake time, and only `tradeService.onDisconnect`
   * refunds it. Without this, anyone staging a trade when an operator clicks
   * Stop has the debit replayed on the next boot -- permanently lost penya.
   */
  beforeLeave?: (player: CPlayer) => void;
}

/** What `kickAll` did, for the caller to log or report. */
export interface KickAllResult {
  /** Players online when the drain started. */
  total: number;
  /** Players whose state flush resolved. */
  saved: number;
  /** charIds whose flush rejected -- they are still disconnected. */
  failed: number[];
}

export class AdminCommandService implements AdminCommandSink {
  private readonly closeDelayMs: number;

  constructor(private readonly deps: AdminCommandServiceDeps) {
    this.closeDelayMs = deps.kickCloseDelayMs ?? KICK_CLOSE_DELAY_MS;
  }

  /**
   * Disconnect a live player. Notice first, close second -- see the module note
   * on why a bare close leaves the v19 client frozen in-world. The socket-close
   * hook does the state flush and manager removal (not `/out`'s path).
   */
  kick(charId: number): void {
    const player = this.deps.playerManager.get(charId);
    if (!player) {
      logger.info({ charId }, 'admin kick: character not online -- no-op');
      return;
    }
    logger.info({ charId, name: player.m_szName }, 'admin kick');
    // Best-effort: a dead socket must not stop the close below.
    try {
      this.deps.playerManager.sendTo(player, buildKickNotice(player.m_idPlayer));
    } catch (err) {
      logger.warn({ err, charId }, 'admin kick: notice write failed -- closing anyway');
    }
    const socket = player.socket;
    const timer = setTimeout(() => socket.destroy?.(), this.closeDelayMs);
    // Never hold the event loop open on shutdown (rule 05 -- timers must not
    // outlive what they reference).
    timer.unref();
  }

  /**
   * Disconnect every online player and persist their state. For maintenance
   * drains: an operator wants everyone out with nothing lost, before a restart
   * or a resource reload.
   *
   * Order matters, and differs from single `kick` on purpose:
   *   1. notice to every socket first, so all clients start their message box in
   *      the same window rather than staggered behind N awaits
   *   2. `saveAndLeave` per player, awaited -- this is the whole point; the
   *      socket-close hook's fire-and-forget flush would still be in flight
   *   3. close the sockets after the grace window
   *
   * `saveAndLeave` (`JoinService.disconnectByCharId`) already swallows its own DB
   * errors and removes the player from the manager, so step 2 both saves and
   * de-registers. A rejection is still caught here: one bad row must not strand
   * the rest of the server online.
   *
   * @param reason free-form label for the audit log
   */
  async kickAll(reason = 'admin'): Promise<KickAllResult> {
    const players = this.deps.playerManager.all();
    const result: KickAllResult = { total: players.length, saved: 0, failed: [] };
    if (players.length === 0) {
      logger.info({ reason }, 'admin kickAll: nobody online -- no-op');
      return result;
    }
    logger.info({ reason, total: result.total }, 'admin kickAll: draining world');

    // 1. Notices first -- collect sockets so the close still works after
    //    saveAndLeave drops each player from the manager.
    const sockets: { destroy?: () => void }[] = [];
    for (const player of players) {
      sockets.push(player.socket);
      try {
        this.deps.playerManager.sendTo(player, buildKickNotice(player.m_idPlayer));
      } catch (err) {
        logger.warn({ err, charId: player.m_idPlayer }, 'admin kickAll: notice write failed');
      }
    }

    // 2. Awaited flush. Sequential, not Promise.all: a full server hitting the
    //    DB with N concurrent multi-table writes is how a drain turns into a
    //    timeout (rule 04 -- no unbounded concurrent DB work).
    const save = this.deps.saveAndLeave;
    const beforeLeave = this.deps.beforeLeave;
    if (save) {
      for (const player of players) {
        const charId = player.m_idPlayer;
        // Teardown that needs the live player object (trade gold refund above
        // all) -- `save` removes them from the manager, so it cannot run after.
        try {
          beforeLeave?.(player);
        } catch (err) {
          logger.error({ err, charId }, 'admin kickAll: pre-leave teardown failed');
        }
        try {
          await save(charId);
          result.saved++;
        } catch (err) {
          logger.error({ err, charId }, 'admin kickAll: state flush failed -- disconnecting anyway');
          result.failed.push(charId);
        }
      }
    } else {
      logger.warn('admin kickAll: no saveAndLeave wired -- disconnecting WITHOUT saving');
    }

    // 3. Close. Deferred for the same reason single kick defers.
    const timer = setTimeout(() => {
      for (const socket of sockets) {
        try {
          socket.destroy?.();
        } catch {
          // Already-dead socket -- nothing to do.
        }
      }
    }, this.closeDelayMs);
    timer.unref();

    logger.info(
      { reason, total: result.total, saved: result.saved, failed: result.failed.length },
      'admin kickAll complete',
    );
    return result;
  }

  /** Move a live player. No coords => their zone's revival point ("town"). */
  teleport(charId: number, x?: number, z?: number): void {
    const player = this.deps.playerManager.get(charId);
    if (!player) {
      logger.info({ charId }, 'admin teleport: character not online -- no-op');
      return;
    }
    const pos = x !== undefined && z !== undefined
      ? { x, y: 0, z }
      : this.townPos(player);
    if (!pos) {
      logger.warn({ charId, zoneId: player.m_nZoneId }, 'admin teleport: no revival point for zone');
      return;
    }
    try {
      Validate.pos(pos.x, pos.y, pos.z);
    } catch {
      logger.warn({ charId, pos }, 'admin teleport: invalid position');
      return;
    }
    player.m_vPos = pos;
    player._dirty.add('x');
    player._dirty.add('y');
    player._dirty.add('z');
    this.deps.playerManager.sendTo(player, this.deps.setPosSer.build(player.m_idPlayer, pos));
    this.deps.refreshVisibility(player);
    logger.info({ charId, pos }, 'admin teleport');
  }

  /** Re-push the mailbox to a live player after the admin panel inserts mail. */
  mailPushed(charId: number): void {
    const player = this.deps.playerManager.get(charId);
    if (!player) return; // offline -- they'll see it on JOIN
    const h = this.deps.mailHandler;
    if (!h) return;
    void h.sendMailBox(player);
  }

  /** The zone's revival point, i.e. where `/revive`-in-town lands. */
  private townPos(player: CPlayer): Vec3 | null {
    const zone = this.deps.zones.byNumericId.get(player.m_nZoneId);
    if (!zone) return null;
    return { ...zone.revival.position };
  }
}
