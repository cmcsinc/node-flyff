# Flyff v15 Client → Login(Certifier) Wire Format

Source of truth: `game/source/` (`__VER 15`). All citations verbatim from the C++.
This is the reference for making the TS emulator byte-compatible with the **real
v15 client binary**. Researched 2026-07-19.

## Topology (two-step)

| Port | C++ role | Packet | Our server |
| --- | --- | --- | --- |
| **23000** (`PN_CERTIFIER`) | **Certifier** | `CERTIFY` → `SRVR_LIST` | `@flyff/login-server` (certifier role) |
| **28000** (`PN_LOGINSRVR`) | LoginServer | `GETPLAYERLIST` → `PLAYER_LIST`+`CACHE_ADDR` | `@flyff/cluster-server` path |

`_Network/MsgHdr.h:1414,1421`. No packet is sent before `CERTIFY` — `ConnectToSystem` →
`SendCertify()` immediately (`_Interface/WndTitle.cpp:516-564`).

## Frame — 13-byte CRC header (v15 default `__CRC`)

`CLAUDE.md`'s 5-byte `[0x5E][size][payload]` is the **non-`__CRC`** variant. The v15
default build defines `__CRC` (`CERTIFIER/VersionCommon.h:12`) and uses **13 bytes**:

```
[1B 0x5E mark][4B size-CRC][4B payload-size LE][4B data-CRC][payload]
```

Each CRC DWORD is stored as `~(digest ^ *m_pdwProtocolId)` (`_Network/Net/Src/buffer.cpp:161`).
CRC variant + `protocolId` value extracted in `v15-crc-rijndael.md` (companion note).

## `PACKETTYPE_CERTIFY` (0xfc) — client→certifier

Opcode `_Network/MsgHdr.h:61`. Client send path `Neuz/DPCertified.cpp:122-165`
(`CDPCertified::SendCertify`). Payload **after** the opcode DWORD:

| # | Field | Type | Notes |
| --- | --- | --- | --- |
| 1 | protocolVersion | DWORD-len + chars | `"20100412"` (`NEUZ_MSGVR`, `_Common/LodeConfig.h:9`). Server compares to its `Certifier.ini` `m_szVer`; mismatch → `ERROR_ILLEGAL_VER` |
| 2 | resourceVersion | DWORD-len + chars | **only** `__SECURITY_0628` (internal builds); default mainservers skip |
| 3 | account | DWORD-len + chars | max 42 (`MAX_ACCOUNT`). Server **lowercases** before DB lookup (`DPCertifier.cpp:293`) |
| 4 | password | see below | |
| 5 | sessionPwd | DWORD-len + chars | **only** `__TWN_LOGIN0816` + `LANG_TWN` |

**Password** (`Neuz/Neuz.cpp:1147`, `_Common/LodeConfig.h:8`):
- If `m_bEncryptPWD==TRUE` (default): `md5("kikugalanet" + pwd)` → 32-char **lowercase** hex (`_Network/tools.cpp:5-37`).
- If `__ENCRYPT_PASSWORD` (v15 certifier default): that 32-char string is padded into a 672-byte (16 × `MAX_PASSWORD`=16 × 42) buffer and **Rijndael-CBC encrypted** — a fixed 672-byte blob with **no length prefix** (`Neuz/DPCertified.cpp:142-149`). Server decrypts, reads first 42 bytes (`CERTIFIER/DPCertifier.cpp:255-268`).
- Else: DWORD-len string.

`ar.WriteString` = `[int32 len][chars]`, no null terminator (`_Network/Misc/Src/ar.cpp:81-86`).

### ⚠ Current TS CERTIFY is WRONG

We read `[DWORD key][str username][str password][DWORD version]`. Real order is
`[str version][str account][password]`. No leading "key" DWORD; version is a STRING
FIRST. Must rework.

## `PACKETTYPE_SRVR_LIST` (0xfd) — certifier→client

Opcode `_Network/MsgHdr.h:62`. Client parse path `Neuz/DPCertified.cpp:204-270`
(`OnSvrList`). Server send path `CERTIFIER/DPCertifier.cpp:154-196`. Payload:

| # | Field | Type | Gating |
| --- | --- | --- | --- |
| 1 | dwAuthKey | DWORD | server-issued session key, reused on `:28000` |
| 2 | cbAccountFlag | BYTE | |
| 3 | lTimeSpan | long | only `__BILLING0712` |
| 4 | szGPotatoNo / szCheck / szBak | strings | only `__GPAUTH_01/02` / `__EUROPE_0514` (GER/FRE) |
| 5 | lTimeLeft | long | only `LANG_THA` |
| 6 | dwSizeofServerset | DWORD | server count |
| 7 | (per server) dwParent, dwID, lpName(str≤35), lpAddr(str≤15), b18(DWORD), lCount, lEnable, lMax | repeat ×count | `SERVER_DESC` `_Network/Misc/Include/Misc.h:8-30`; `BOOL b18` is **4 bytes** on Win32 |

Minimum v15 mainserver payload (no billing/GP/THA):
`[dwAuthKey][cbAccountFlag][count]` then per server `[parent][id][name:str][addr:str][b18][count][enable][max]`.

## `PACKETTYPE_GETPLAYERLIST` (0xf6) — client→login(:28000)

`Neuz/DPLoginClient.cpp:118-127`. **`BEFORESENDSOLE` prepends a `DPID_UNKNOWN`
(0xFFFFFFFF) DWORD before the opcode** (`_Network/Net/Include/dpmng.h:32-35`). Then:
`[str protocolVersion][DWORD dwAuthKey][str account][str password][DWORD dwID]`
(`dwAuthKey` issued by the certifier in step 1; `dwID` = server picked from the list).
Server: `LOGINSERVER/DPLoginSrvr.cpp:134-183` → replies `PLAYER_LIST` + `CACHE_ADDR`.

### ⚠ Cluster path must match this layout

Our `@flyff/cluster-server` `CharHandler.handleGetPlayerList` currently reads
`[str version][DWORD authKey][str account][str password][DWORD dwId]` — **field order
matches**, but it does **not** expect the leading `DPID_UNKNOWN` DWORD that
`BEFORESENDSOLE` adds. Must account for that prefix (or confirm our dispatcher strips it).

## Opcodes (all `PACKETTYPE_*`, never `SNSP_*`)

`_Network/MsgHdr.h`:
```
PING 0x14 | CLOSE_EXISTING_CONNECTION 0x16 | KEEP_ALIVE 0x18
NEW_ACCOUNT 0xf0 | PLAYER_LIST 0xf3 | CREATE_PLAYER 0xf4 | DELETE_PLAYER 0xf5
GETPLAYERLIST 0xf6 | CERTIFY 0xfc | SRVR_LIST 0xfd | ERROR 0xfe
JOIN 0xff00 | PRE_JOIN 0xff05
```

## Compatibility gap checklist (vs current TS emulator)

- [x] **CERTIFY field order** — reworked to `[str ver][str acct][672B rijndael blob]` (`auth.handler.ts`).
- [x] **13-byte `__CRC` frame** — `packages/core/src/net/crcFrame.ts` codec (13/0) + wired into the dispatcher (CRC mode, per-connection `protocolId`). **Server sends the 8-byte protocolId hello on accept** (plain-framed, server→client — the certifier is `crcRead`, so it reads CRC frames but writes plain), then validates inbound CRC frames against that id; CRC-fail → socket drop. Reply path (`sendPacket`) is always plain-framed. Login `clientServer` runs in CRC mode. See `v15-crc-rijndael.md` §protocolId for the corrected handshake direction.
- [x] **Rijndael-CBC password decrypt** — `packages/login-server/src/utils/v15Password.ts` (AES-128-CBC key `dldhsvmflvm`, 6/0); CERTIFY decrypts the blob → md5hex → argon2-verifies.
- [x] **SRVR_LIST reply** — rewritten to the client parse order (`serverList.handler.ts`, 2/0).
- [x] **GETPLAYERLIST / cluster + world DPID prefix** — `BEFORESENDSOLE` prepends a `DPID_UNKNOWN` (0xFFFFFFFF) DWORD before the opcode (`dpmng.h:32-40`; server skips it at `DPLoginSrvr.cpp:65-87` + `DPSrvr.cpp:578-584`). Dispatcher gains a `leadsWithDpid` flag; cluster + world `clientServer` set it (login/certifier does not). Cluster TCP smoke proves GETPLAYERLIST → PLAYER_LIST over CRC + DPID.
- [x] **Cluster/world frame mode** — both now run CRC (real client uses `__CRC` on every connection).
- [x] Opcode `0xfc` correct.
- [x] Handler framing — replies centralised on `sendPacket()` (plain-framed, matching the `crcRead` server's outbound); was raw payload (found via TCP smoke).
- [x] **v15 login TCP smoke** (3/0): read server hello → adopt protocolId → CRC-framed CERTIFY → rijndael decrypt → argon2 verify; bad password ⇒ plain-framed ERROR; wrong protocolId ⇒ connection dropped.
