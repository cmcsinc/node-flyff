/**
 * MAP_KEY handler -- `PACKETTYPE_MAP_KEY` (0xfffff000).
 *
 * Read order is fixed by `WORLDSERVER/DPSrvr.cpp:12022` `OnMapKey`:
 *
 *   szFileName:String   szMapKey:String
 *
 * Both DWORD-length-prefixed. The client fires one per `.wld` as it loads the
 * world. On a `mismatch` verdict from the service the connection is dropped,
 * mirroring C++ `g_DPSrvr.QueryDestroyPlayer` (`CheckMapKey` mismatch path).
 * No reply packet exists for MAP_KEY on any path.
 *
 * @module handlers/mapKey.handler
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { createLogger } from '@flyff/core/logger';
import type { VisibilityService } from '@flyff/world-core';
import type { MapKeyService } from '../services/mapKey.service';

const logger = createLogger({ module: 'mapKey-handler' });

/** Max length of a map file name / key (paths like `W1_VD_WorldServer.wld`). */
const MAP_KEY_MAX_LEN = 64;

export class MapKeyHandler {
  constructor(
    private mapKeyService: MapKeyService,
    private visibilityService: Pick<VisibilityService, 'enterWorld'>,
  ) {}

  handleMapKey(socket: ClientSocket, reader: PacketReader): void {
    let fileName: string;
    let mapKey: string;
    let charId: number;
    try {
      if (socket.session.state !== SessionState.IN_WORLD) {
        logger.warn({ state: socket.session.state }, 'MAP_KEY before IN_WORLD -- dropping');
        socket.destroy();
        return;
      }
      charId = socket.session.charId ?? -1;
      fileName = reader.readString();
      mapKey = reader.readString();
      Validate.string(fileName, 1, MAP_KEY_MAX_LEN);
      Validate.string(mapKey, 1, MAP_KEY_MAX_LEN);
    } catch (error) {
      logger.error({ error }, 'MAP_KEY parse failed');
      socket.destroy();
      return;
    }

    const outcome = this.mapKeyService.check(charId, fileName, mapKey);
    if (!outcome.ok && outcome.reason === 'mismatch') {
      logger.warn({ charId, fileName }, 'MAP_KEY mismatch -- disconnecting');
      socket.destroy();
      return;
    }
    if (!outcome.ok) {
      // not_in_world -- session desync; drop.
      socket.destroy();
      return;
    }

    logger.debug({ charId, fileName, remaining: reader.remaining }, 'MAP_KEY accepted');

    // First MAP_KEY = client finished loading the world (g_pWorld + g_pPlayer
    // set). This is the earliest safe point to stream ADD_OBJ -- JOIN was too
    // early (raced the world load, desync, OnAddObj null-deref). VisibilityService
    // owns the one-shot gate; MAP_KEY repeats per .wld are no-ops.
    if (!this.visibilityService.enterWorld(charId)) {
      logger.warn({ charId }, 'visibility enterWorld failed -- dropping');
      socket.destroy();
    }
  }
}
