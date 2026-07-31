/**
 * S->C campus snapshots (`_Network/MsgHdr.h:1324-1327`).
 *
 * All four use `GetId()` (the RECIPIENT's own objid) as the header objid --
 * `CUser::AddInviteCampusMember` / `AddUpdateCampus` / `AddRemoveCampus` /
 * `AddUpdateCampusPoint` (`WORLDSERVER/User.cpp:8810-8851`).
 *
 * @module social/net/snapshot/campus.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

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
 * `CUser::AddInviteCampusMember` (`User.cpp:8810`):
 *   ar << GetId() << SNAPSHOTTYPE_CAMPUS_INVITE;
 *   ar << pRequest->m_idPlayer;        // u_long
 *   ar.WriteString( pRequest->GetName() );
 *
 * **Client-side gate worth knowing:** `OnInviteCampusMember`
 * (`Neuz/DPClient.cpp:19190`) returns silently unless
 * `CPlayerDataCenter::GetPlayerData( idRequest )` is non-NULL -- the invite
 * dialog never appears if the requester is absent from the client's player-data
 * cache. Any port must be feeding that cache first (the vicinity/QUERY_PLAYERDATA
 * path does this for players you can see).
 */
export function buildCampusInvite(
  selfObjid: number, requesterId: number, requesterName: string,
): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.CAMPUS_INVITE);
  w.writeDword(requesterId);
  w.writeString(requesterName);
  return w.build();
}

/** One `CCampusMember` (`Campus.cpp:27`): `u_long m_idPlayer | int m_nMemberLv`. */
export interface CampusMemberFrame {
  readonly playerId: number;
  /** `CAMPUS_MASTER` (1) or `CAMPUS_PUPIL` (2). */
  readonly memberLevel: number;
}

/**
 * `CUser::AddUpdateCampus` (`User.cpp:8821`) -> `CCampus::Serialize`
 * (`_Common/Campus.cpp:58`):
 *   ar << m_idCampus << m_idMaster << m_mapCM.size();
 *   per member: ar << m_idPlayer << m_nMemberLv;
 *
 * `m_mapCM.size()` is written as a raw `size_t` -- 4 bytes on the Win32 build,
 * NOT cast to `int` the way `CRTMessenger` does. Same width today; keep them
 * distinct if this ever targets a 64-bit client.
 *
 * `m_mapCM` is a `map<u_long, ...>`, so wire order is ascending player id.
 *
 * Broadcast to every ONLINE member, one snapshot each
 * (`CCampusHelper::AddAllMemberUpdateCampus`).
 */
export function buildCampusUpdate(
  selfObjid: number, campusId: number, masterId: number,
  members: readonly CampusMemberFrame[],
): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.CAMPUS_UPDATE);
  w.writeDword(campusId);
  w.writeDword(masterId);
  w.writeDword(members.length);          // size_t (4 B on Win32)
  for (const m of [...members].sort((a, b) => a.playerId - b.playerId)) {
    w.writeDword(m.playerId);
    w.writeDword(m.memberLevel | 0);
  }
  return w.build();
}

/** `CUser::AddRemoveCampus` (`User.cpp:8832`) -- `u_long idCampus`. */
export function buildCampusRemove(selfObjid: number, campusId: number): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.CAMPUS_REMOVE);
  w.writeDword(campusId);
  return w.build();
}

/** `CUser::AddUpdateCampusPoint` (`User.cpp:8842`) -- `int nCampusPoint`. */
export function buildCampusUpdatePoint(selfObjid: number, campusPoint: number): Buffer {
  const w = open(selfObjid, SNAPSHOTTYPE.CAMPUS_UPDATE_POINT);
  w.writeDword(campusPoint | 0);
  return w.build();
}
