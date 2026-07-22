/**
 * JOIN handler -- client enter-world packet (`PACKETTYPE_JOIN`).
 *
 * This is the **client -> cache/world** JOIN sent by Neuz
 * (`Neuz/DPClient.cpp:8959` `CDPClient::SendJoin`), whose read order is fixed
 * by `CACHESERVER/Player.cpp:35` `CPlayer::Join`:
 *
 *   dwWorldId:DWORD  idPlayer:DWORD  dwAuthKey:DWORD  idParty:DWORD
 *   idGuild:DWORD    idWar:DWORD     uChannel:DWORD   nSlot:BYTE
 *   name:String      account:String  password:String  [messenger block]
 *
 * Note: `WORLDSERVER/DPSrvr.cpp:612` `OnAddUser` reads a *different*
 * (cache->world internal) layout. In v15 the CacheServer re-serializes the
 * packet before forwarding. This emulator has no separate cache layer, so the
 * world's client-facing port receives the Neuz-format packet directly.
 *
 * `nSlot >= 3` is rejected (C++ `OnAddUser` line 628). On a valid handoff +
 * character the handler delegates to `JoinService` and writes the JOIN
 * self-spawn snapshot back to the socket. On any failure the connection is
 * dropped (C++ destroys the ghost) -- no error packet on this path.
 *
 * @module handlers/join.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { sendPacket, type ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { createLogger } from '@flyff/core/logger.js';
import type { JoinService } from '../services/join.service.js';
import type { PlayerSnapshotSerializer } from '../net/snapshot/playerSnapshot.serializer.js';
import type { SetExperienceSerializer } from '../net/snapshot/setExperience.serializer.js';
import type { TaskBarSnapshotSerializer } from '../net/snapshot/taskbar.serializer.js';
import { cumulativeExp } from '../combat/formulas.js';

const logger = createLogger({ module: 'join-handler' });

export class JoinHandler {
  constructor(
    private joinService: JoinService,
    private snapshotSerializer: PlayerSnapshotSerializer,
    private setExperienceSerializer: SetExperienceSerializer,
    private taskbarSerializer: TaskBarSnapshotSerializer,
  ) {}

  async handleJoin(socket: ClientSocket, reader: PacketReader): Promise<void> {
    let outcome;
    try {
      const _dwWorldId = reader.readDword();
      const idPlayer = reader.readDword();
      const _dwAuthKey = reader.readDword();
      const _idParty = reader.readDword();
      const _idGuild = reader.readDword();
      const _idWar = reader.readDword();
      const _uChannel = reader.readDword();
      const nSlot = reader.readByte();
      const _name = reader.readString();
      const _account = reader.readString();
      const _password = reader.readString();

      if (nSlot >= 3) {
        logger.warn({ idPlayer, nSlot }, 'JOIN rejected -- slot out of range');
        socket.destroy();
        return;
      }

      outcome = await this.joinService.join(socket, idPlayer);
    } catch (error) {
      logger.error({ error }, 'JOIN parse failed');
      socket.destroy();
      return;
    }

    if (!outcome.ok) {
      logger.warn({ reason: outcome.reason }, 'JOIN rejected');
      socket.destroy();
      return;
    }

    // Promote the session BEFORE the snapshot goes out -- the client reacts to
    // the JOIN reply by sending MAP_KEY / movement / behavior, and every in-world
    // handler's session guard requires IN_WORLD (rule 03).
    socket.session.state = SessionState.IN_WORLD;
    socket.session.charId = outcome.player.m_idPlayer;

    sendPacket(socket, this.snapshotSerializer.build(outcome.player));

    // Push the loaded within-level exp so the bar reflects saved progress on
    // relog. The ADD_OBJ mover frame writes m_nExp1=0; without this self-only
    // SETEXPERIENCE the client shows 0 exp until the next kill/revive.
    sendPacket(socket, this.setExperienceSerializer.build(outcome.player.m_idPlayer, {
      exp: cumulativeExp(outcome.player.m_nLevel, outcome.player.m_nExp),
      level: outcome.player.m_nLevel,
      skillLevel: outcome.player.m_nSkillLevel,
      skillPoint: outcome.player.m_nSkillPoint,
    }));

    // Repush saved taskbar bindings (items/skills/emotes/chat macros) so the
    // F1-F9 grid repopulates. `SNAPSHOTTYPE_TASKBAR` (0x0097) is independent of
    // world load -- `CWndTaskBar::Serialize` (client) just fills the grid.
    sendPacket(socket, this.taskbarSerializer.build(outcome.player.m_idPlayer, outcome.player.m_aSlotItem));

    // NOTE: zone NPCs/monsters are NOT sent here. Their server-side spawn lives
    // in SpawnManager.bootstrap() (run once at world-server boot, compose.ts) --
    // the materialization is decoupled from any player. Client notification of
    // nearby movers belongs in a vicinity/zone-enter broadcast (CLinkLink
    // equivalent), triggered after the client has finished loading the world
    // from WORLD_READINFO. Bolting the ADD_OBJ snapshot onto JOIN races the
    // client's world load and desyncs the stream (neuz OnAddObj null-deref).
    // ponytail: implement ZoneManager.broadcastEnter(player) -> NpcSnapshotSerializer
    // once a vicinity subscribe/zone-enter hook lands, and send per-zone there.

    logger.info({ idPlayer: outcome.player.m_idPlayer }, 'Player entered world');
  }
}
