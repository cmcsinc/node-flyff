/**
 * S->C mail state change -- `SNAPSHOTTYPE_REMOVEMAIL` (0x00e7).
 *
 * Mirrors `CUser::AddRemoveMail` (`WORLDSERVER/User.cpp:6723`):
 * ```
 * ar << GetId() << SNAPSHOTTYPE_REMOVEMAIL << nMail << nType;
 * ```
 * `nType` is `int` -- 4 bytes on the wire, NOT a BYTE. It selects which part of
 * the mail the client should drop, per the `CMail::{mail,item,gold,read}` enum
 * (post.h:35) and `OnRemoveMail`'s switch (`DPClient.cpp:15955-15995`).
 *
 * Take-item and take-gold do NOT delete the mail: C++ acks them with
 * `MAIL_TYPE.ITEM` / `MAIL_TYPE.GOLD` (`DPDatabaseClient.cpp:2707/2745`), which
 * only clears the attachment; the mail survives until the player explicitly
 * deletes it (`MAIL_TYPE.MAIL`, :2677).
 *
 * @module net/snapshot/removeMail.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_REMOVEMAIL } from '@flyff/world-core';

/** `CMail::{ mail, item, gold, read }` (post.h:35) -- the REMOVEMAIL `nType`. */
export const MAIL_TYPE = Object.freeze({
  /** Delete the whole mail from the client's box. */
  MAIL: 0,
  /** Clear the attached item (player took it). */
  ITEM: 1,
  /** Clear the attached penya (player took it). */
  GOLD: 2,
  /** Flip `m_byRead` so the row renders as opened. */
  READ: 3,
} as const);

export type MailType = (typeof MAIL_TYPE)[keyof typeof MAIL_TYPE];

export class RemoveMailSerializer {
  build(objid: number, nMail: number, nType: MailType): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE_REMOVEMAIL);
    w.writeDword(nMail);
    w.writeDword(nType);   // C++ `int nType` -- 4 bytes
    return w.build();
  }
}
