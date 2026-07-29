/**
 * AdminCommandService -- executes admin-panel commands against the live world.
 *
 * The three actions the admin panel can trigger. Each reuses the existing,
 * already-correct in-world path rather than re-deriving it:
 *
 * - **kick**: `socket.destroy()`, letting `index.ts`'s `onDisconnect` hook run
 *   (party cleanup + `joinService.disconnectByCharId` checkpoint flush). This
 *   is deliberately NOT the `/out` GM command's path
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

const logger = createLogger({ module: 'admin-command-service' });

export interface AdminCommandServiceDeps {
  playerManager: PlayerManager;
  setPosSer: SetPosSerializer;
  zones: { byNumericId: Map<number, ZoneDefinition> };
  /** Re-emits the destination ADD_OBJ snapshot after a teleport. */
  resendVicinity: (player: CPlayer) => void;
  mailHandler?: MailHandler;
}

export class AdminCommandService implements AdminCommandSink {
  constructor(private readonly deps: AdminCommandServiceDeps) {}

  /**
   * Disconnect a live player. The socket-close hook does the state flush and
   * manager removal -- see the module note on why `/out`'s path is not reused.
   */
  kick(charId: number): void {
    const player = this.deps.playerManager.get(charId);
    if (!player) {
      logger.info({ charId }, 'admin kick: character not online -- no-op');
      return;
    }
    logger.info({ charId, name: player.m_szName }, 'admin kick');
    player.socket?.destroy?.();
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
    this.deps.resendVicinity(player);
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
