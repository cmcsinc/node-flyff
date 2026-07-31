/**
 * S->C friend snapshots (`_Network/MsgHdr.h:1020-1027`) plus the three
 * non-snapshot friend replies that go out as their own PACKETTYPE.
 *
 * Every snapshot builder here uses `GetId()` (the RECIPIENT's own objid) as the
 * header objid, matching `CUser::Add*` -- these are self-directed UI updates,
 * not peer broadcasts, so the header carries no useful routing information and
 * the client ignores it.
 *
 * The `__RT_1025` shape matters most on ADDFRIEND: no job, no sex, just id and
 * name (`User.cpp:1614-1631`).
 *
 * @module social/net/snapshot/friend.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';
import { OFFLINE_ID_OF_MULTI } from '../../constants/friend';

/** Open a one-block SNAPSHOT frame. */
function open(objid: number, subtype: number): PacketWriter {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(subtype);
  return w;
}

/**
 * `CUser::AddAddFriend` (`User.cpp:1614`), `__RT_1025` branch -- roster insert:
 *   ar << GetId() << SNAPSHOTTYPE_ADDFRIEND;
 *   ar << idPlayer;                    // u_long
 *   ar.WriteString( lpszPlayer );      // client buf MAX_PLAYER (42)
 * The `nJob` / `(BYTE)dwSex` writes are inside `#ifndef __RT_1025`, so v19 does
 * NOT send them. Adding them shifts the client's string-length read.
 *
 * Sent to each party separately with the OTHER's id + name
 * (`WORLDSERVER/DPCoreClient.cpp:1422/1464`).
 */
export function buildAddFriend(selfObjid: number, friendId: number, friendName: string): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.ADDFRIEND);
  w.writeDword(friendId);
  w.writeString(friendName);
  return w.build();
}

/**
 * `CUser::AddFriendReqest` (`User.cpp:1500`) -- the incoming-invite dialog:
 *   ar << GetId() << SNAPSHOTTYPE_ADDFRIENDREQEST;
 *   ar << uLeader;                     // u_long
 *   ar << nSex;                        // BYTE   <- sex BEFORE job here
 *   ar << nJob;                        // LONG
 *   ar.WriteString( szName );
 *
 * Note the field order is sex-then-job, the inverse of the (dead) ADDFRIEND
 * branch. Invitee only.
 */
export function buildFriendRequest(
  selfObjid: number, leaderId: number, sex: number, job: number, leaderName: string,
): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.ADDFRIEND_SNAPSHOT_REQEST);
  w.writeDword(leaderId);
  w.writeByte(sex & 0xff);
  w.writeDword(job | 0);
  w.writeString(leaderName);
  return w.build();
}

/**
 * `CUser::AddFriendCancel` (`User.cpp:1514`) -- bodyless. The `uMemberid` the
 * client sent is deliberately dropped (see the `// uMemberid` comment at
 * `DPSrvr.cpp:1616`). Self only.
 */
export function buildFriendCancel(selfObjid: number): Buffer {
  return open(selfObjid, SNAPSHOTTYPE.ADDFRIEND_SNAPSHOT_CANCEL).build();
}

/**
 * `CUser::AddFriendError` (`User.cpp:1524`):
 *   ar << GetId() << SNAPSHOTTYPE_ADDFRIENDERROR;
 *   ar << nError;                      // BYTE (1 = already friend, 2 = no such name)
 *   ar.WriteString( szName );
 */
export function buildFriendError(selfObjid: number, code: number, name: string): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.ADDFRIENDERROR);
  w.writeByte(code & 0xff);
  w.writeString(name);
  return w.build();
}

/** `CUser::AddRemoveFriend` (`User.cpp:1633`) -- `GetId() | REMOVEFRIEND | u_long`. */
export function buildRemoveFriend(selfObjid: number, removedId: number): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.REMOVEFRIEND_SNAPSHOT);
  w.writeDword(removedId);
  return w.build();
}

/** `CUser::AddFriendChangeJob` (`User.cpp:1845`) -- `u_long uidPlayer | int nJob`. */
export function buildFriendChangeJob(selfObjid: number, friendId: number, job: number): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.ADDFRIENDCHANGEJOB);
  w.writeDword(friendId);
  w.writeDword(job | 0);
  return w.build();
}

/** One roster entry as `CRTMessenger::Serialize` writes it. */
export interface FriendEntry {
  readonly friendId: number;
  /** `Friend::bBlock` -- 4-byte BOOL on the wire. */
  readonly blocked: boolean;
  /** `Friend::dwState` -- an `FRS_*` value. */
  readonly state: number;
}

/**
 * `CUser::AddFriendGameJoin` (`User.cpp:1421`) -> `CRTMessenger::Serialize`
 * (`_Common/rtmessenger.cpp:36`):
 *   ar << m_dwState;                       // DWORD -- the OWNER's own status
 *   ar << static_cast<int>( size() );      // int
 *   per entry: ar << i->first;             // u_long friend id
 *              ar.Write( &i->second, sizeof(Friend) );   // raw 8 bytes
 *
 * That `ar.Write` is a raw memcpy of `Friend { BOOL bBlock; DWORD dwState; }`,
 * so the two fields go out in struct order as 4-byte LE values with no padding.
 * Writing them as anything narrower desyncs the whole roster.
 *
 * Map iteration order is ascending key, so entries must be sorted by friend id.
 *
 * Sent on JOIN only (`User.cpp:326`), self only.
 */
export function buildFriendGameJoin(
  selfObjid: number, ownState: number, entries: readonly FriendEntry[],
): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.ADDFRIENDGAMEJOIN);
  w.writeDword(ownState);
  w.writeDword(entries.length);
  for (const e of [...entries].sort((a, b) => a.friendId - b.friendId)) {
    w.writeDword(e.friendId);
    w.writeDword(e.blocked ? 1 : 0);   // BOOL bBlock
    w.writeDword(e.state);             // DWORD dwState
  }
  return w.build();
}

/**
 * `CDPCacheSrvr::SendFriendState` (`CORESERVER/DPCacheSrvr.cpp:294`) -- reply to
 * GETFRIENDSTATE, sent as its OWN packet (not a snapshot block):
 *   [PACKETTYPE_GETFRIENDSTATE]
 *   int nFriendCount | int nBlockCount
 *   nFriendCount x { u_long idFriend, DWORD dwState, u_long uIdofMulti }
 *   nBlockCount  x { same triple }
 *
 * `dwState` is `FRS_OFFLINE` when the friend is not online, or when the FRIEND
 * has blocked the requester (`:340`); otherwise it is the friend's own state.
 * `uIdofMulti` is `100` for an offline friend.
 */
export function buildGetFriendState(
  friends: readonly { id: number; state: number; idOfMulti?: number }[],
  blocked: readonly { id: number; state: number; idOfMulti?: number }[],
): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.GETFRIENDSTATE);
  w.writeDword(friends.length);
  w.writeDword(blocked.length);
  for (const list of [friends, blocked]) {
    for (const f of list) {
      w.writeDword(f.id);
      w.writeDword(f.state);
      w.writeDword(f.idOfMulti ?? OFFLINE_ID_OF_MULTI);
    }
  }
  return w.build();
}

/**
 * `CDPCacheSrvr::SendSetFriendState` (`DPCacheSrvr.cpp:450/468/479`) -- one
 * status change, echoed to self and relayed to each non-blocked friend:
 *   [PACKETTYPE_SETFRIENDSTATE] u_long idPlayer | DWORD dwState
 */
export function buildSetFriendState(playerId: number, state: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SETFRIENDSTATE);
  w.writeDword(playerId);
  w.writeDword(state);
  return w.build();
}

/**
 * `PACKETTYPE_ADDFRIENDJOIN` (`Neuz/DPClient.cpp:8015 OnFriendJoin`) -- a friend
 * came online: `u_long idFriend | DWORD dwState | u_long uLogin`.
 */
export function buildFriendJoin(friendId: number, state: number, loginId = 0): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.ADDFRIENDJOIN);
  w.writeDword(friendId);
  w.writeDword(state);
  w.writeDword(loginId);
  return w.build();
}

/**
 * `PACKETTYPE_ADDFRIENDLOGOUT` (`DPClient.cpp:8079 OnFriendLogOut`) -- a friend
 * went offline: `u_long idFriend`. The client forces FRS_OFFLINE itself.
 */
export function buildFriendLogout(friendId: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.ADDFRIENDLOGOUT);
  w.writeDword(friendId);
  return w.build();
}

/**
 * `PACKETTYPE_REMOVEFRIENDSTATE` (`DPCacheSrvr.cpp:2215`) -- tells the OTHER
 * side its roster lost an entry: `u_long uRemoveid` (the remover's id).
 */
export function buildRemoveFriendState(removerId: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.REMOVEFRIENDSTATE);
  w.writeDword(removerId);
  return w.build();
}
