/**
 * Duel S->C snapshots -- `SNAPSHOTTYPE_DUELREQUEST/START/NO/CANCEL/SETDUEL`
 * (`_Network/MsgHdr.h:946-954, 1010-1011`).
 *
 * Mirrors the per-user `CUser::AddDuel*` builders (`WORLDSERVER/User.cpp:1644-
 * 1698, 2571-2580`). Each is a single-record PACKETTYPE_SNAPSHOT frame:
 *   `[SNAPSHOT:DWORD][NULL_ID:DWORD][count=1:WORD][objid:DWORD][subtype:WORD][body]`
 * where `objid` is the recipient's own player objid (the per-user snapshot
 * owner -- NOT the duel peer). Self-only -- sent via `playerManager.sendTo`,
 * never broadcast to the vicinity.
 *
 * Field widths confirmed against `CDPClient::OnDuel*` (DPClient.cpp:15463) +
 * `OnSetDuel` body `dwObjid | nDuel | nDuelState | idDuelOther | idDuelParty`.
 *
 * @module serializers/duel
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../snapshot-constants';

/** Build the common 14-byte snapshot prefix (subtype + caller-written body). */
function snap(subtype: number, recipientObjid: number): PacketWriter {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(recipientObjid);
  w.writeWord(subtype);
  return w;
}

/**
 * `SNAPSHOTTYPE_DUELREQUEST` (0x0030) -- `AddDuelRequest` (User.cpp:1644).
 * Notifies the recipient that `uidSrc` has challenged `uidDst` (them). Client
 * opens the duel-confirm dialog. Body: `u_long uidSrc | u_long uidDst`.
 */
export function buildDuelRequest(recipientObjid: number, uidSrc: number, uidDst: number): Buffer {
  const w = snap(SNAPSHOTTYPE.DUELREQUEST, recipientObjid);
  w.writeDword(uidSrc);
  w.writeDword(uidDst);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_DUELSTART` (0x0031) -- `AddDuelStart` (User.cpp:1655). Body:
 * `u_long uidTarget | int bStart`. `bStart`: 0 = begin (sets m_nDuel=1 +
 * m_idDuelOther + m_nDuelState=104), 1 = fight-begin notice text,
 * 2 = clear (`ClearDuel`). We use 0 on accept, 2 on cancel-by-leave.
 */
export function buildDuelStart(recipientObjid: number, uidTarget: number, bStart: number): Buffer {
  const w = snap(SNAPSHOTTYPE.DUELSTART, recipientObjid);
  w.writeDword(uidTarget);
  w.writeDword(bStart);
  return w.build();
}

/** `SNAPSHOTTYPE_DUELNO` (0x0032) -- `AddDuelNo` (User.cpp:1678). Body: `OBJID idTarget`. */
export function buildDuelNo(recipientObjid: number, idTarget: number): Buffer {
  const w = snap(SNAPSHOTTYPE.DUELNO, recipientObjid);
  w.writeDword(idTarget);
  return w.build();
}

/** `SNAPSHOTTYPE_DUELCANCEL` (0x0033) -- `AddDuelCancel` (User.cpp:1689). Body: `OBJID idTarget`. */
export function buildDuelCancel(recipientObjid: number, idTarget: number): Buffer {
  const w = snap(SNAPSHOTTYPE.DUELCANCEL, recipientObjid);
  w.writeDword(idTarget);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_SETDUEL` (0x0066) -- `AddSetDuel` (User.cpp:2571). Body:
 * `OBJID dwObjid | int nDuel | int nDuelState | OBJID idDuelOther | u_long idDuelParty`.
 * `dwObjid` repeats the recipient objid in the body (the mover whose state is
 * described -- in v1 always the recipient itself). `nDuel`: 1 active, 0 clear.
 * `nDuelState`: 104 = accepted, 1 = fight-begin, 300 = leave-notice, 0 = clear.
 * `idDuelParty`: 0 for 1v1 (party-duel deferred -- ponytail).
 */
export function buildSetDuel(
  recipientObjid: number,
  targetObjid: number,
  nDuel: number,
  nDuelState: number,
  idDuelOther: number,
  idDuelParty: number = NULL_ID,
): Buffer {
  const w = snap(SNAPSHOTTYPE.SETDUEL, recipientObjid);
  w.writeDword(targetObjid);
  w.writeDword(nDuel);
  w.writeDword(nDuelState);
  w.writeDword(idDuelOther);
  w.writeDword(idDuelParty);
  return w.build();
}
