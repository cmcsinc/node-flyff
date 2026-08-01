/**
 * Party S->C snapshots -- `SNAPSHOTTYPE_PARTYMEMBER/PARTYREQEST/PARTYREQESTCANCEL
 * /ADDPARTYCHANGELEADER/PARTYCHAT/PARTYEXP/ERRORPARTY`
 * (`_Network/MsgHdr.h:1028-1070`).
 *
 * Mirrors the per-user `CUser::AddParty*` builders (`WORLDSERVER/User.cpp:1250-
 * 1444, 1599-1620, 1222-1234`): each is a single-record PACKETTYPE_SNAPSHOT
 * frame `OBJID | WORD subtype | body`. `OBJID` is the RECIPIENT's own player
 * id (the per-user snapshot owner -- never the leader/peer). Sent via
 * `playerManager.sendTo`; never broadcast to the vicinity.
 *
 * Body widths ported from `CParty::Serialize` (`_Common/party.cpp:173-227`).
 * Every explicit `CAr` operator in `_Network/Misc/Include/ar.h:57-238` is
 * commented out; the live path is the template at `ar.h:253`, which writes
 * exactly `sizeof(T)` of the argument's STATIC type. So
 * `int`/`LONG`/`u_long`/`DWORD`/`BOOL` -> 4 bytes, but `BYTE` -> **1 byte**
 * (no widening -- see `leaderSex`/`memberSex` in {@link buildPartyRequest}).
 * v19 (`__VER >= 11 // __SYS_PLAYER_DATA`) drops the per-member
 * level/job/sex/name fields, so the per-member trailer is
 * `m_uPlayerId:u_long | m_bRemove:BOOL` (8 bytes).
 *
 * @module serializers/party
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../snapshot-constants';

/** Solo-party kind. Guild-party (`=1`) deferred -- ponytail in the plan. */
export const PARTY_KIND_TROUP_SOLO = 0;

/** `MAX_PARTYMODE` (`_Common/party.h:30`) under v19 (`__PARSKILL1001`). */
export const MAX_PARTYMODE = 5;

/** Maximum members in a solo party (`MAX_PARYMEMBER` default). */
export const MAX_PARTY_MEMBERS = 8;

/** `PARTYCHANGEEXPMODE`/`PARTYCHANGEITEMMODE` mode constants. */
export const PARTY_EXP_SHARE = 0;     // level-based split (solo default)
export const PARTY_ITEM_FFA = 0;      // free-for-all (default)
export const PARTY_ITEM_ROUND_ROBIN = 1;

/**
 * `m_idDuelParty` "not duelling" sentinel. C++ `CParty::CParty` sets 0
 * (`party.cpp:65`) and `party.h:87` says "opponent party ID, otherwise 0".
 * Never `NULL_ID` here.
 */
export const PARTY_NO_DUEL = 0;

/** `m_nLevel` seeded to 1 by `CParty::CParty` (`party.cpp:55`), not 0. */
export const PARTY_LEVEL_DEFAULT = 1;

/** One party roster entry. */
export interface PartySnapshotMember {
  /** `m_uPlayerId` (CPlayer.m_idPlayer). */
  id: number;
  /** `m_bRemove` -- TRUE flags this member as departing (roster-delta use). */
  remove: boolean;
}

/**
 * `CParty::Serialize` body state. Defaults match a fresh solo party of size 2:
 * no duel, no level/exp/point, default exp/item share, zero mode timers.
 */
export interface PartySnapshotState {
  /** `m_uPartyId`. */
  partyId: number;
  /** `m_nKindTroup` -- 0 solo (we only ship solo). */
  kindTroup?: number;
  /** `m_nSizeofMember`. */
  size: number;
  /** `m_nLevel` -- party-level (guild-party only; C++ ctor seeds 1). */
  level?: number;
  /** `m_nExp` -- party-level exp (guild-party only; 0 solo). */
  exp?: number;
  /** `m_nPoint` -- contribution points (guild-party only; 0 solo). */
  point?: number;
  /** `m_nTroupsShareExp` -- exp share mode (0 = level split). */
  expMode?: number;
  /** `m_nTroupeShareItem` -- item share mode (0 FFA, 1 round-robin). */
  itemMode?: number;
  /**
   * `m_idDuelParty` -- party-duel peer party id. **0 when not duelling**, NOT
   * `NULL_ID`: `party.h:87` documents the sentinel as 0 and every reader is a
   * truthiness/`> 0` test. `DPClient.cpp:4562` runs on every roster change and
   * does `if (g_Party.m_idDuelParty) { m_nDuel = 2; }`, so sending 0xffffffff
   * drops the whole party into party-duel PVP mode.
   */
  duelPartyId?: number;
  /** `m_nModeTime[MAX_PARTYMODE]` -- 5 fixed ints. */
  modeTime?: number[];
  members: PartySnapshotMember[];
}

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

/** Write the CParty::Serialize body (party.cpp:169-223) into `w`. */
function writeCParty(w: PacketWriter, p: PartySnapshotState): void {
  w.writeDword(p.partyId);
  w.writeDword(p.kindTroup ?? PARTY_KIND_TROUP_SOLO);
  w.writeDword(p.size);
  w.writeDword(p.level ?? PARTY_LEVEL_DEFAULT);
  w.writeDword(p.exp ?? 0);
  w.writeDword(p.point ?? 0);
  w.writeDword(p.expMode ?? PARTY_EXP_SHARE);
  w.writeDword(p.itemMode ?? PARTY_ITEM_FFA);
  w.writeDword(p.duelPartyId ?? PARTY_NO_DUEL);
  const mt = p.modeTime ?? [];
  for (let i = 0; i < MAX_PARTYMODE; i++) w.writeDword(mt[i] ?? 0);
  // m_nKindTroup != 0 -> WriteString(m_sParty). Solo skips it.
  for (const m of p.members) {
    w.writeDword(m.id);
    w.writeDword(m.remove ? 1 : 0); // BOOL -> 4 bytes
  }
}

/**
 * `SNAPSHOTTYPE_PARTYMEMBER` (0x0082) -- `AddPartyMember` (User.cpp:1250).
 * Body: `idPlayer:DWORD | String leader | String member | int nSizeofMember |
 * CParty::Serialize`. When `party` is null the C++ path writes `nSizeofMember
 * = 0` and skips `Serialize` -- used for the disband self-notice.
 */
export function buildPartyMember(
  recipientObjid: number,
  leaderName: string,
  memberName: string,
  party: PartySnapshotState | null,
): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYMEMBER, recipientObjid);
  w.writeDword(recipientObjid); // idPlayer -- C++ writes GetId() (the recipient)
  w.writeString(leaderName);
  w.writeString(memberName);
  if (party === null) {
    w.writeDword(0);
    return w.build();
  }
  w.writeDword(party.size);
  writeCParty(w, party);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_PARTYREQEST` (0x0083) -- `AddPartyRequest` (User.cpp:1357).
 * Invite popup body. `leaderSex`/`memberSex` are **1 byte** each:
 * `CMover::GetSex()` returns `BYTE` (`Mover.h:1118`) and the live `CAr`
 * template writes `sizeof(T)`, so no widening happens. Neuz reads them back
 * into `BYTE byLeaderSex/byMemberSex` (`DPClient.cpp:4596-4597`). Writing
 * DWORDs here pushes the leader-name string 6 bytes out of place, the client
 * reads a garbage length, and the confirm dialog never opens.
 * `bTroup` is `BOOL` -> 4 bytes (0 = solo).
 */
export function buildPartyRequest(
  recipientObjid: number,
  leaderId: number, leaderLevel: number, leaderJob: number, leaderSex: number,
  memberId: number, memberLevel: number, memberJob: number, memberSex: number,
  leaderName: string,
  bTroup: number,
): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYREQEST, recipientObjid);
  w.writeDword(leaderId);
  w.writeDword(leaderLevel);
  w.writeDword(leaderJob);
  w.writeByte(leaderSex & 0xff); // GetSex() is BYTE -- 1 byte on the wire
  w.writeDword(memberId);
  w.writeDword(memberLevel);
  w.writeDword(memberJob);
  w.writeByte(memberSex & 0xff);
  w.writeString(leaderName);
  w.writeDword(bTroup);
  return w.build();
}

/** `SNAPSHOTTYPE_PARTYREQESTCANCEL` (0x0084) -- `AddPartyRequestCancel` (User.cpp:1371). */
export function buildPartyRequestCancel(
  recipientObjid: number,
  uLeader: number,
  uMember: number,
  nMode: number,
): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYREQESTCANCEL, recipientObjid);
  w.writeDword(uLeader);
  w.writeDword(uMember);
  w.writeDword(nMode);
  return w.build();
}

/** `SNAPSHOTTYPE_ADDPARTYCHANGELEADER` (0x0079) -- `AddPartyChangeLeader` (User.cpp:1435). */
export function buildPartyChangeLeader(recipientObjid: number, idChangeLeader: number): Buffer {
  const w = snap(SNAPSHOTTYPE.ADDPARTYCHANGELEADER, recipientObjid);
  w.writeDword(idChangeLeader);
  return w.build();
}

/** `SNAPSHOTTYPE_PARTYCHAT` (0x0069) -- `AddPartyChat` (User.cpp:1599). */
export function buildPartyChat(recipientObjid: number, name: string, msg: string, objid: number): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYCHAT, recipientObjid);
  w.writeDword(objid);
  w.writeString(name);
  w.writeString(msg);
  return w.build();
}

/** `SNAPSHOTTYPE_PARTYEXP` (0x0085) -- `AddPartyExpLevel` (User.cpp:1277). */
export function buildPartyExp(recipientObjid: number, exp: number, level: number, point: number): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYEXP, recipientObjid);
  w.writeDword(exp);
  w.writeDword(level);
  w.writeDword(point);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_PARTYCHANGEITEMMODE` (0x008f) -- `AddPartyChangeItemMode`
 * (`User.cpp:1312`). Body: `int nItemMode`. The client's `OnPartyChangeItemMode`
 * (`DPClient.cpp:5286`) assigns it straight into `g_Party.m_nTroupeShareItem`,
 * so this is what actually updates the party window's radio buttons -- a
 * PARTYMEMBER roster resend does NOT (it rebuilds the roster, and the mode
 * fields inside `CParty::Serialize` are only read on a full party read).
 */
export function buildPartyChangeItemMode(recipientObjid: number, itemMode: number): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYCHANGEITEMMODE, recipientObjid);
  w.writeDword(itemMode);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_PARTYCHANGEEXPMODE` (0x0090) -- `AddPartyChangeExpMode`
 * (`User.cpp:1323`). Body: `int nExpMode`. See
 * {@link buildPartyChangeItemMode} for why the roster resend is not enough.
 */
export function buildPartyChangeExpMode(recipientObjid: number, expMode: number): Buffer {
  const w = snap(SNAPSHOTTYPE.PARTYCHANGEEXPMODE, recipientObjid);
  w.writeDword(expMode);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_ERRORPARTY` (0x0081) -- `AddSendErrorParty` (User.cpp:1222).
 * Body: `DWORD dw`. Only when `dw == ERROR_NOTARGET` does C++ append a second
 * `dwSkill` DWORD -- we surface that via the optional second arg.
 */
export function buildErrorParty(recipientObjid: number, dwError: number, dwSkill?: number): Buffer {
  const w = snap(SNAPSHOTTYPE.ERRORPARTY, recipientObjid);
  w.writeDword(dwError);
  if (dwSkill !== undefined) w.writeDword(dwSkill);
  return w.build();
}
