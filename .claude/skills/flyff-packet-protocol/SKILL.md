---
name: flyff-packet-protocol
description: >
  Expert knowledge of the Flyff (Fly For Fun) MMORPG network packet protocol for building
  a Node.js server emulator. Use this skill whenever the user is working with Flyff packet
  parsing, binary packet structures, LSFR/RC4 encryption, packet headers, opcodes/SNSPs,
  packet building or reading, or any raw network communication between Flyff client and server.
  Trigger on keywords: "packet", "CPacket", "SetPacketHeader", "SNSP", "opcode", "LSFR",
  "encryption key", "packet buffer", "packet handler", "ReadXXX", "WriteXXX", "m_dwPacket",
  "FlyFF protocol", or any reference to client-server message formats.
---

# Flyff Packet Protocol — Node.js Emulator Reference

## Packet Wire Format

Every Flyff packet on the wire follows this layout:

```
[ 4 bytes: DWORD packet_size ]  ← size of everything AFTER these 4 bytes
[ 2 bytes: WORD  header      ]  ← always 0x5E80
[ 2 bytes: WORD  opcode/SNSP ]  ← the actual operation ID
[ N bytes: payload           ]  ← variable length data
```

> **Note on size field**: `packet_size = total_bytes - 4`. The 4-byte size header is NOT included in its own count.

---

## LSFR Encryption

Flyff uses a custom LSFR cipher per connection. Key state is per-socket.

### Node.js Implementation

```js
class LSFRCipher {
  constructor(key) {
    this.key = key >>> 0; // ensure uint32
  }

  nextKey() {
    this.key = ((Math.imul(this.key, 0x08088405) + 1) >>> 0);
    return this.key;
  }

  // Encrypt/decrypt buffer in-place (symmetric)
  transform(buf) {
    for (let i = 0; i < buf.length; i++) {
      const k = this.nextKey();
      buf[i] ^= (k >>> ((i % 4) * 8)) & 0xFF;
    }
    return buf;
  }
}
```

Key exchange flow:
1. Client sends `SNSP_LOGIN_CERTIFY` (plaintext)
2. Server sends initial key in handshake
3. Both sides initialize `new LSFRCipher(key)`
4. All subsequent packets have payload encrypted

---

## C++ → Node.js Type Mapping

| C++ Type | Size | Node.js Buffer Method |
|---|---|---|
| `BYTE` / `ReadByte()` | 1 | `buf.readUInt8(offset)` |
| `WORD` / `ReadWord()` | 2 | `buf.readUInt16LE(offset)` |
| `DWORD` / `ReadDword()` | 4 | `buf.readUInt32LE(offset)` |
| `float` / `ReadFloat()` | 4 | `buf.readFloatLE(offset)` |
| `int` / `ReadLong()` | 4 | `buf.readInt32LE(offset)` |
| String (len-prefixed) | 4+N | see readFlyffString() |

**All integers are Little-Endian.** Always use `LE` variants.

---

## PacketReader Class

```js
class PacketReader {
  constructor(buf) { this.buf = buf; this.offset = 0; }

  readByte()  { const v = this.buf.readUInt8(this.offset);      this.offset += 1; return v; }
  readWord()  { const v = this.buf.readUInt16LE(this.offset);   this.offset += 2; return v; }
  readDword() { const v = this.buf.readUInt32LE(this.offset);   this.offset += 4; return v; }
  readFloat() { const v = this.buf.readFloatLE(this.offset);    this.offset += 4; return v; }
  readInt()   { const v = this.buf.readInt32LE(this.offset);    this.offset += 4; return v; }

  readString() {
    const len = this.readDword();
    if (len === 0) return '';
    const s = this.buf.toString('ascii', this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  get remaining() { return this.buf.length - this.offset; }
}
```

---

## PacketWriter Class

```js
class PacketWriter {
  constructor(opcode) { this.chunks = []; this.opcode = opcode; }

  writeByte(v)  { const b = Buffer.alloc(1); b.writeUInt8(v);          this.chunks.push(b); return this; }
  writeWord(v)  { const b = Buffer.alloc(2); b.writeUInt16LE(v);       this.chunks.push(b); return this; }
  writeDword(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.chunks.push(b); return this; }
  writeFloat(v) { const b = Buffer.alloc(4); b.writeFloatLE(v);        this.chunks.push(b); return this; }
  writeInt(v)   { const b = Buffer.alloc(4); b.writeInt32LE(v);        this.chunks.push(b); return this; }

  writeString(s) {
    const strBuf = Buffer.from(s, 'ascii');
    this.writeDword(strBuf.length);
    this.chunks.push(strBuf);
    return this;
  }

  build(header = 0x5E80) {
    const payload = Buffer.concat(this.chunks);
    const frame = Buffer.alloc(4 + 2 + 2 + payload.length);
    frame.writeUInt32LE(2 + 2 + payload.length, 0);
    frame.writeUInt16LE(header, 4);
    frame.writeUInt16LE(this.opcode, 6);
    payload.copy(frame, 8);
    return frame;
  }
}
```

---

## TCP Stream Reassembly

TCP is stream-based — always buffer and reassemble:

```js
class PacketBuffer {
  constructor() { this.buf = Buffer.alloc(0); }

  push(chunk) { this.buf = Buffer.concat([this.buf, chunk]); }

  drain() {
    const packets = [];
    while (this.buf.length >= 4) {
      const size = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + size) break;
      packets.push(this.buf.slice(4, 4 + size));
      this.buf = this.buf.slice(4 + size);
    }
    return packets;
  }
}
```

---

## Packet Dispatcher Pattern

```js
const handlers = new Map();

function dispatch(socket, rawPacket) {
  const r = new PacketReader(rawPacket);
  const header = r.readWord(); // 0x5E80
  const opcode = r.readWord();
  const handler = handlers.get(opcode);
  if (handler) {
    handler(socket, r);
  } else {
    console.warn(`Unhandled opcode: 0x${opcode.toString(16).toUpperCase()}`);
  }
}
```

---

## Common SNSPs

| SNSP | Value | Description |
|---|---|---|
| `SNSP_LOGIN_CERTIFY` | `0xFC03` | Login credentials |
| `SNSP_LOGIN_WORLD` | `0xFC0B` | Select world |
| `SNSP_CHAR_CREATE` | `0xFB0C` | Create character |
| `SNSP_CHAR_SELECT` | `0xFB0B` | Select character |
| `SNSP_PLAYER_MOVE` | `0x00D9` | Movement update |
| `SNSP_PLAYER_CHAT` | `0x00C6` | Chat message |
| `SNSP_OBJECT_SHOW` | `0x0035` | Spawn entity |

See `references/opcodes.md` for full opcode table.

---

## Gotchas

- Strings are **DWORD-length-prefixed**, NOT null-terminated on the wire
- Float positions: **Y is vertical** (up), not Z
- Encryption key is **per TCP connection** — never share state between sockets
- When debugging, log raw hex **before** decryption for comparison with packet captures
