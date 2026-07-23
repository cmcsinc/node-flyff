/**
 * S->C teleport notify -- `SNAPSHOTTYPE_REPLACE` (0x00f2).
 *
 * Mirrors `CUser::AddReplace` (`WORLDSERVER/User.cpp:697`):
 *   m_Snapshot.ar << NULL_ID;
 *   m_Snapshot.ar << SNAPSHOTTYPE_REPLACE;
 *   m_Snapshot.ar << dwWorldID;          // DWORD
 *   m_Snapshot.ar << vPos;               // D3DXVECTOR3 = 3 floats
 *
 * The client loads `dwWorldID` (re-sending MAP_KEY if the world changed) and
 * relocates the player to `vPos`. Sent only to the teleported player.
 *
 * @module net/snapshot/replace.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_REPLACE } from '@flyff/world-core';
import type { Vec3 } from '@flyff/entities';

export class ReplaceSerializer {
  build(worldId: number, pos: Vec3): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(NULL_ID);
    w.writeWord(SNAPSHOTTYPE_REPLACE);
    w.writeDword(worldId);
    w.writeFloat(pos.x);
    w.writeFloat(pos.y);
    w.writeFloat(pos.z);
    return w.build();
  }
}
