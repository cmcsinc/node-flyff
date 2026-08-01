/**
 * S->C forced-logout notice -- `SNAPSHOTTYPE_SEALCHARGET_REQ` (0x0145).
 *
 * ## Why this opcode
 *
 * The C++ server has NO kick packet. `/out` (`FuncTextCmd.cpp:2476`) routes
 * `PACKETTYPE_KILLPLAYER` (0x00ff00e6) world -> core -> cache, and the cache
 * terminates with a bare `shutdown(hSocket, SD_BOTH)`
 * (`_Network/Net2/include/serversock.h:440`). Not one byte reaches the client.
 *
 * The v19 client detects that close (IOCP `dwBytes == 0` ->
 * `CloseConnection` -> synthetic `DPMSG_DESTROYPLAYERORGROUP` ->
 * `CDPClient::SysMessageHandler`, `Neuz/DPClient.cpp:255`) but on the WORLD
 * connection does almost nothing with it: sets `m_fConn = FALSE`, and shows
 * `TID_DIAG_0017` only when the static `s_f` is TRUE -- which is set solely by
 * `OnError(ERROR_INVALID_CLOCK)` (`DPClient.cpp:1034`). Nothing anywhere reads
 * `g_DPlay.m_fConn`. No `OpenTitle`, no applet switch, no world teardown. The
 * player is left standing in a frozen world with no error. That is a client
 * bug, and it is why a faithful `socket.destroy()` "doesn't disconnect".
 *
 * `SNAPSHOTTYPE_SEALCHARGET_REQ` is the ONE in-world snapshot whose handler
 * returns the client to the title screen without patching Neuz:
 *
 *   CDPClient::OnSealCharGet (DPClient.cpp:17279)
 *     -> g_WndMng.OpenMessageBoxUpper( prj.GetText(TID_DIAG_0023), MB_OK, TRUE )
 *        // TID_DIAG_0023 == 2022 == "disconnected from the server"
 *   CWndMessageBoxUpper::OnChildNotify (WndMessageBox.cpp:389) -- on any button,
 *     because bPostLogoutMsg == TRUE:
 *     -> ::PostMessage( WM_LOGOUT )
 *   CNeuzApp::MsgProc WM_LOGOUT (Neuz.cpp:1508)
 *     -> g_WndMng.OpenTitle(); m_bConnect = FALSE
 *
 * Guarded by `#if __VER >= 11 // __MA_VER11_05` on both the dispatch
 * (`DPClient.cpp:713`) and the handler; `Neuz/VersionCommon.h:4` sets
 * `__VER 19` and `VersionCommon2.h:89` defines `__MA_VER11_05`, so it is live.
 * The handler also requires `g_pPlayer` -- in-world only, which is exactly the
 * kick case.
 *
 * Body, from `CUser::AddSealCharSet` (`WORLDSERVER/User.cpp:8040`):
 *   m_Snapshot.ar << GetId();
 *   m_Snapshot.ar << SNAPSHOTTYPE_SEALCHARGET_REQ;
 * No payload after the sub-type.
 *
 * ponytail: this is an emulator-only repurposing -- in C++ the opcode means
 * "your character was sealed and traded away, you must relog", and it is
 * always paired with `QueryDestroyPlayer` (`DPDatabaseClient.cpp:3289`), i.e.
 * notice-then-close, the same sequence used here. If a client patch ever lands,
 * replace this with a dedicated kick opcode (or make the world connection honor
 * `DPMSG_DESTROYPLAYERORGROUP` like `DPCertified.cpp:57` does) and delete this
 * file.
 *
 * @module net/snapshot/kick.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';

/** `SNAPSHOTTYPE_SEALCHARGET_REQ` -- `_Network/MsgHdr.h:1233`. */
export const SNAPSHOTTYPE_SEALCHARGET_REQ = 0x0145;

/**
 * Grace window between the notice and the socket close. The notice is a normal
 * snapshot needing one flush -- but destroying the socket in the same tick
 * discards whatever is still in the kernel buffer, and the client would be back
 * to the silent-freeze case.
 */
export const KICK_CLOSE_DELAY_MS = 500;

/**
 * Build the forced-logout notice for one player.
 *
 * @param objid  the player's stable `m_dwObjId` (C++ `AddSealCharSet` uses
 *               `GetId()` for both the frame objid and the entry objid)
 */
export function buildKickNotice(objid: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(objid);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_SEALCHARGET_REQ);
  return w.build();
}
