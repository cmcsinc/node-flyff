/**
 * SNAPSHOT handler -- client->world `PACKETTYPE_SNAPSHOT` (0xffffff00) multiplexer.
 *
 * `DPSrvr::OnSnapshot` (DPSrvr.cpp:4338) reads `c:BYTE` entries, then per entry
 * a `wHdr:WORD` switch. v19 sends ONLY `SNAPSHOTTYPE_DESTPOS` (click-to-move):
 *   c:BYTE  [ [wHdr:WORD(=0x00c1)] [vPos:Vec3][fForward:BYTE] ]
 *
 * The trailing `objidIAObj:DWORD` is only read `#ifdef __IAOBJ0622`
 * (DPSrvr.cpp:4377). That macro is NOT defined in this v19 build, so the
 * wire body is Vec3(12)+fForward(1) = 13 bytes -- no ship-objid field.
 *
 * Other sub-types hit the C++ `default: ASSERT(0)` -- treated as a protocol error
 * here (log + drop the whole frame). `c` is capped at 16 (a legitimate client
 * never batches more than a handful per packet).
 *
 * Handler reads + validates -> one `SnapshotService.destPos` call per DESTPOS
 * entry. No reply on any path (rule 02 -- service broadcasts to peers).
 *
 * @module handlers/snapshot.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import { type ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { SnapshotService } from '../services/snapshot.service';

const logger = createLogger({ module: 'snapshot-handler' });

/** Upper bound on entries per SNAPSHOT packet (anti-amplification). */
const MAX_SNAPSHOT_ENTRIES = 16;

/** `SNAPSHOTTYPE_DESTPOS` (MsgHdr.h:1086) -- the only sub-type v19 sends here. */
const SNAPSHOTTYPE_DESTPOS_IN = 0x00c1;

export class SnapshotHandler {
  constructor(
    private playerManager: PlayerManager,
    private snapshotService: SnapshotService,
  ) {}

  handleSnapshot(socket: ClientSocket, reader: PacketReader): void {
    if (socket.session.state !== SessionState.IN_WORLD) {
      socket.destroy();
      return;
    }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) {
      socket.destroy();
      return;
    }

    let count: number;
    try {
      count = reader.readByte();
      if (count === 0 || count > MAX_SNAPSHOT_ENTRIES) {
        logger.warn({ count, charId: player.m_idPlayer }, 'SNAPSHOT bad entry count -- dropping');
        return;
      }
      for (let i = 0; i < count; i++) {
        const wHdr = reader.readWord();
        if (wHdr !== SNAPSHOTTYPE_DESTPOS_IN) {
          logger.warn({ wHdr: `0x${wHdr.toString(16)}` }, 'SNAPSHOT unknown sub-type -- dropping frame');
          return;
        }
        const vPos = readVec3(reader);
        const fForward = reader.readByte();
        Validate.pos(vPos.x, vPos.y, vPos.z);

        const outcome = this.snapshotService.destPos(player, { vPos, fForward });
        if (!outcome.ok) {
          // Anti-teleport drop -- silent in C++; log at debug for diagnostics.
          logger.debug({ charId: player.m_idPlayer }, 'DESTPOS dropped (anti-teleport)');
        }
      }
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'SNAPSHOT parse failed');
        return;
      }
      throw error;
    }
  }
}

/** Read a Vec3 (3 LE floats) -- matches C++ `ar >> D3DXVECTOR3`. */
function readVec3(reader: PacketReader) {
  const x = reader.readFloat();
  const y = reader.readFloat();
  const z = reader.readFloat();
  return { x, y, z };
}
