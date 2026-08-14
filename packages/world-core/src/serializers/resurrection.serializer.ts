/**
 * Other-player Resurrection S->C snapshots. Both are bodyless (`AddHdr` only:
 * `OBJID objid + WORD wHdr` after the SNAPSHOT prefix).
 *
 * `CUserMng::AddResurrectionMessage` -- sent **self-only** to the DEAD player
 * when an Assist lands skill 45 on their corpse (`_Common/Ctrl.cpp:817`, inside
 * `ApplySkillHardCoding`). Opens the modal `CWndResurrectionConfirm`
 * (`_Interface/WndField.cpp:14840`); its buttons reply `RESURRECTION_OK` /
 * `RESURRECTION_CANCEL`. The window carries no timer -- the offer stands until
 * answered.
 *
 * `g_UserMng.AddHdr( pUser, SNAPSHOTTYPE_RESURRECTION )` -- sent to the
 * **vicinity** on accept (`WORLDSERVER/DPSrvr.cpp:6903`) so peers drop the corpse
 * pose. It carries no HP; the client learns the restored HP from the follow-up
 * SETPOINTPARAM.
 *
 * @module serializers/resurrection.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  NULL_ID, SNAPSHOTTYPE_RESURRECTION, SNAPSHOTTYPE_RESURRECTION_MESSAGE,
} from '../snapshot-constants';

function buildHdr(objid: number, snapshotType: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(snapshotType);
  return w.build();
}

/** Self-only prompt: "another player wants to resurrect you" (0x0027). */
export function buildResurrectionMessage(objid: number): Buffer {
  return buildHdr(objid, SNAPSHOTTYPE_RESURRECTION_MESSAGE);
}

/** Vicinity confirm: the player is being resurrected in place (0x00eb). */
export function buildResurrection(objid: number): Buffer {
  return buildHdr(objid, SNAPSHOTTYPE_RESURRECTION);
}
