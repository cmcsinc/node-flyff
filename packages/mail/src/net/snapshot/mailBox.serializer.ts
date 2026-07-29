/**
 * S->C mailbox snapshot -- `SNAPSHOTTYPE_QUERYMAILBOX` (0x00e9).
 *
 * Mirrors `CUser::AddMailBox` (`WORLDSERVER/User.cpp:6734`), whose body is one
 * `CMailBox::Serialize` (`_Common/post.cpp:335`) containing `count` x
 * `CMail::Serialize` (`post.cpp:93`, `bData` defaults TRUE so the long form is
 * the only one ever on the wire).
 *
 * Layout:
 * ```
 * [idReceiver:DWORD][count:int32]
 * per mail:
 *   [nMail:DWORD][idSender:DWORD][hasItem:BYTE]
 *   [CItemElem body, 78B]              <- only when hasItem
 *   [gold:DWORD][ageSecs:DWORD][byRead:BYTE]
 *   [title: DWORD len + chars][text: DWORD len + chars]
 * ```
 *
 * Four traps, each of which silently corrupts every following field:
 *
 * 1. **No per-mail nMail duplication.** The DB<->world form
 *    (`CMailBox::Write`, post.cpp:231) writes `ar << pMail->m_nMail` and THEN
 *    `pMail->Serialize(ar)` -- so nMail appears twice. The client form
 *    (`CMailBox::Serialize`) does not. Copying the DB form shifts everything
 *    4 bytes.
 * 2. **The time field is an AGE, not a timestamp.** C++ writes
 *    `time_null() - m_tmCreate` (post.cpp:107) and the client reconstructs
 *    `m_tmCreate = now - tm` (post.cpp:131). Send seconds-since-created.
 * 3. **`count` is `int` (4B)**, from `(int)size()` (post.cpp:340) -- not a WORD.
 * 4. **String caps.** `CAr::ReadString(lpsz, nBufSize)` (ar.cpp:109) kills the
 *    whole archive when `nLen > nBufSize-1`, discarding every remaining mail
 *    silently. Title bufsize is `MAX_MAILTITLE` 32, text is `MAX_MAILTEXT` 256,
 *    so the payloads must be <=31 / <=255 chars. Truncated here as a belt-and-
 *    braces guard on top of the repo-level truncation.
 *
 * The mailbox is a FULL REPLACE: the client's load branch calls `Clear()` first
 * (post.cpp:349). Never send a partial list.
 *
 * @module net/snapshot/mailBox.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_QUERYMAILBOX, writeCItemElemBody } from '@flyff/world-core';

/** `MAX_MAILTITLE` 32 (post.h:10) minus the NUL the client reserves. */
export const MAX_MAIL_TITLE_CHARS = 31;
/** `MAX_MAILTEXT` 256 (post.h:12) minus the NUL. */
export const MAX_MAIL_TEXT_CHARS = 255;
/** `MAX_MAIL` (post.h:124) -- server-enforced mailbox cap (DPSrvr.cpp:7276). */
export const MAX_MAIL = 50;

/** One mail as the serializer needs it -- storage-shape agnostic. */
export interface MailWireEntry {
  /** `CMail::m_nMail` -- the mail's stable id. MUST be non-zero: the client
   *  assigns its own id when it reads 0 (`CMailBox::AddMail`, post.cpp:201),
   *  which then never matches the id we expect back in QUERYGETMAILITEM. */
  nMail: number;
  /** `CMail::m_idSender`. 0 renders as the literal name "FLYFF" client-side
   *  (`WndField.cpp:16700`) -- that is exactly system/admin mail. */
  idSender: number;
  /** Attached penya (`m_nGold`). 0 = none. */
  gold: number;
  /** Seconds since the mail was created (`time_null() - m_tmCreate`). */
  ageSecs: number;
  /** `m_byRead` -- non-zero once the player has opened it. */
  read: boolean;
  title: string;
  text: string;
  /** Attachment. `null` writes the has-item BYTE as 0 and no body. */
  item: MailWireItem | null;
}

/** Attachment fields -- the subset of `CItemElem` a mail carries. */
export interface MailWireItem {
  itemId: number;
  count: number;
  flags?: number;
  refine?: number;
  durability?: number;
  element?: number;
  element_level?: number;
}

export class MailBoxSerializer {
  /**
   * Build the full-mailbox snapshot for one player.
   *
   * @param objid - the receiving player's `m_idPlayer` (snapshot target)
   * @param idReceiver - `CMailBox::m_idReceiver`; same char id
   * @param mails - oldest-first, already capped at {@link MAX_MAIL}
   */
  build(objid: number, idReceiver: number, mails: readonly MailWireEntry[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE_QUERYMAILBOX);

    const capped = mails.slice(0, MAX_MAIL);
    w.writeDword(idReceiver);        // CMailBox::m_idReceiver
    w.writeDword(capped.length);     // (int)size() -- 4 bytes, NOT a WORD
    for (const m of capped) writeMail(w, m);
    return w.build();
  }
}

/** One `CMail::Serialize(ar, TRUE)` body (post.cpp:93-111). */
function writeMail(w: PacketWriter, m: MailWireEntry): void {
  w.writeDword(m.nMail);                          // m_nMail
  w.writeDword(m.idSender);                       // m_idSender
  if (m.item) {
    w.writeByte(1);                               // item-present flag
    // The attachment reuses the shared 78-byte CItemElem chain. objId is the
    // mail's own id: the client only needs it distinct while the item lives in
    // the mail (it is re-created with a real inventory objid on take-item).
    writeCItemElemBody(w, m.nMail, {
      itemId: m.item.itemId,
      count: m.item.count,
      flags: m.item.flags ?? 0,
      refine: m.item.refine ?? 0,
      durability: m.item.durability ?? -1,
      element: m.item.element ?? 0,
      element_level: m.item.element_level ?? 0,
    });
  } else {
    w.writeByte(0);                               // no attachment
  }
  w.writeDword(m.gold);                           // m_nGold
  w.writeDword(Math.max(0, Math.floor(m.ageSecs))); // time_null() - m_tmCreate (AGE)
  w.writeByte(m.read ? 1 : 0);                    // m_byRead
  w.writeString(m.title.slice(0, MAX_MAIL_TITLE_CHARS));
  w.writeString(m.text.slice(0, MAX_MAIL_TEXT_CHARS));
}
