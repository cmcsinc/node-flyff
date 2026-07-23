/**
 * S->C mover mode update -- `SNAPSHOTTYPE_MODIFYMODE` (0x00d3).
 *
 * Mirrors `CUserMng::AddModifyMode` (`WORLDSERVER/User.cpp:5096`):
 *   ar << GETID(pUser) << SNAPSHOTTYPE_MODIFYMODE << pUser->m_dwMode;
 *
 * Emitted whenever a GM toggle (`/undying`, `/onekill`, `/invisible`...) flips a
 * bit in `CMover::m_dwMode`. Peers re-apply the full bitmask to their copy of
 * the mover. Broadcast to vicinity (CommandService fans it via
 * `playerManager.broadcastAll` -- far peers' `OnModifyMode` does
 * `g_NeuzMng.GetMover(objid)` -> null -> safe no-op, matching `/shout`).
 *
 * @module net/snapshot/modifyMode.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_MODIFYMODE } from '@flyff/world-core';

export class ModifyModeSerializer {
  build(objid: number, dwMode: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE_MODIFYMODE);
    w.writeDword(dwMode);
    return w.build();
  }
}
