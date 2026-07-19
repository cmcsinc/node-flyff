# v15 CRC Frame + Password Rijndael — Reimplementation Spec

Extracted verbatim from `game/source/` (`__VER 15`, `__CRC`, `__ENCRYPT_PASSWORD`).
All items LOCKED. Companion to `v15-login-wire-format.md`.

## 1. The 13-byte CRC frame (`__CRC` default)

```
offset  size  field
0       1     HEADERMARK = 0x5E
1       4     sizeCRC  = ~( crc32(size_LE_4bytes) ^ protocolId )   LE
5       4     size     = payload byte count                         LE
9       4     dataCRC  = ~( crc32(payload)        ^ protocolId )   LE
13      N     payload (leads with opcode DWORD)
```
Cites: `_Network/Net/Include/buffer.h:13,17,21`; build `_Network/Net/Src/buffer.cpp:147-174`; verify `_Network/Net/Src/clientsock.cpp:378-393,450-457`. Reader **recomputes + compares**; mismatch → socket dropped (`ERROR_BAD_NET_NAME`). `MAX_BUFFER = 8192` (`buffer.h:23`).

### The CRC is NOT plain CRC-32 — two-pass mix (`_Network/Net/Src/crc.cpp:163-222`)

Constants: `ELF_KEY = 0x15779231`, `CRC32_KEY = 0x13393917`, init `m_crc = 0xFFFFFFFF`. Table = standard reflected poly `0xEDB88320` (256 entries, `crc.cpp:46-98`; first `0x00000000, 0x77073096, 0xee0e612c…`, last `0x2d02ef8d`).

```
crc32_flyff(input):
  m = 0xFFFFFFFF
  # Pass A — ELF hash
  m ^= ELF_KEY
  for b in input:
    m = ((m << 4) + b) >>> 0
    x = m & 0xF0000000
    if x != 0: m = (m ^ (x >>> 24)) >>> 0
    m = (m & (~x >>> 0)) >>> 0
  m ^= ELF_KEY
  # Pass B — CRC-32
  m ^= CRC32_KEY
  c = m
  for b in input: c = ((c >>> 8) ^ TABLE[(c ^ b) & 0xFF]) >>> 0
  c ^= CRC32_KEY
  return c >>> 0
```
`Final` writes the 4 LE bytes of `m_crc`; on LE host `*(DWORD*)digest === m_crc`.

### protocolId — per-connection handshake (SERVER sends first, NOT a constant)

**The SERVER sends the 8-byte hello, not the client.** Corrected against
`serversock.cpp:631`, `dpsock.cpp:669`, `clientsock.cpp:506-520`, `dpmng.h:105`
(earlier note here had the direction reversed).

On TCP accept the server (`crcRead` side) immediately calls `SendProtocolId()`,
writing `[DWORD 0x00000000][DWORD protocolId]` where `protocolId = GetTickCount()`.
This hello is **plain-framed** (5-byte `0x5E` header, size=8) because the
certifier/login server is `crcRead`-only — its send buffer has no crc
(`m_lspSendBuffer.m_pcrc == NULL`). Framing is asymmetric:

| Direction | Framing | protocolId source |
| --- | --- | --- |
| server → client | plain 5-byte `0x5E` header, **no CRC** | server generates |
| client → server | 13-byte `__CRC` header | client adopts server's id |

The client blocks in `WaitForSingleObject(m_hProtocolId, uWaitingTime)` with
`uWaitingTime` defaulting to **10000ms**; on timeout it closes the socket. So a
server that fails to send the hello produces exactly: connect → 10s → disconnect,
zero frames decoded.

Emulator (`packages/core/src/net/dispatcher.ts`): on CRC-mode accept, generate a
non-zero protocolId, store it on the session, and immediately `framePacket` the
8-byte hello. Validate all inbound CRC frames against that id. Reply frames go out
**plain** (`sendPacket` = `framePacket`, never `framePacketCrc`).

## 2. Password — AES-128-CBC (`__ENCRYPT_PASSWORD` default)

- Blob = `16 * MAX_PASSWORD` = **672 bytes** (`MAX_PASSWORD=42`, `_Network/CmnHdr.h:485`).
- **Key** = `"dldhsvmflvm"` zero-padded to 16: `64 6C 64 68 73 76 6D 66 6C 76 6D 00 00 00 00 00` (`_Common/Rijndael.cpp:939`).
- **AES-128** (key=16, block=16, Nr=10; `Rijndael.cpp:968-980`).
- **IV = 16 zero bytes** (`sm_chain0`, `Rijndael.cpp:926`); `ResetChain()` before each call.
- **CBC** standard (`Rijndael.cpp:1316-1326` enc, `1359-1368` dec).
- Client: `memcpy` 42-byte password into zero-init 672 buffer → encrypt → `ar.Write(672 raw bytes)` (`Neuz/DPCertified.cpp:139-148`).
- Server: `ar.Read(672)` → decrypt → take first 42 bytes as C-string (`CERTIFIER/DPCertifier.cpp:255-268`).
- On top of CBC, client first does `md5("kikugalanet"+pwd)` lowercase hex (when `m_bEncryptPWD`) — so the 42-byte plaintext IS the 32-char md5 hex (plus NULs).

### Node `crypto` equivalent

```ts
import { createDecipheriv } from 'node:crypto';
const KEY = Buffer.from('dldhsvmflvm\0\0\0\0\0', 'ascii'); // 16 bytes
const IV  = Buffer.alloc(16, 0);
const d = createDecipheriv('aes-128-cbc', KEY, IV);
d.setAutoPadding(false);
const plain = Buffer.concat([d.update(encBlob672), d.final()]); // 672 bytes
const password = plain.subarray(0, 42).toString('utf8').split('\0')[0];
```

OpenSSL `aes-128-cbc` matches byte-for-byte (AES-128, 10 rounds, zero IV, standard CBC).
