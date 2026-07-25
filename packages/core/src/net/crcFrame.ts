/**
 * v19 `__CRC` packet frame -- the 13-byte header every real Flyff v19 client uses.
 *
 * Layout (`_Network/Net/Include/buffer.h:13-23`, build `_Network/Net/Src/buffer.cpp:
 * 147-174`, verify `_Network/Net/Src/clientsock.cpp:378-393,450-457`):
 *
 * ```
 * [1B 0x5E][4B sizeCRC][4B size LE][4B dataCRC][payload...]
 *   sizeCRC = ~( crc32(size_LE_4bytes) ^ protocolId )
 *   dataCRC = ~( crc32(payload)        ^ protocolId )
 * ```
 *
 * The CRC is the C++ `CRC32` class (`_Network/Net/Src/crc.cpp:163-222`) -- **not**
 * plain CRC-32: a two-pass ELF-hash + CRC-32 mix keyed by `ELF_KEY`/`CRC32_KEY`.
 * The reader recomputes + compares; mismatch drops the socket. `protocolId` is
 * per-connection, established by an 8-byte hello (opcode DWORD 0 + id DWORD) the
 * client sends first with protocolId=0 (`clientsock.cpp:515-519`).
 *
 * @module net/crcFrame
 */

const ELF_KEY = 0x15779231;
const CRC32_KEY = 0x13393917;

/** Standard reflected CRC-32 table (poly 0xEDB88320) -- matches `crc.cpp:46-98`. */
const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** HEADERMARK = 0x5E (`buffer.h:21`). */
export const CRC_HEADERMARK = 0x5e;
/** `HEADERSIZE13` (`buffer.h:17`). */
export const CRC_HEADER_SIZE = 13;
/** `MAX_BUFFER = 8192` (`buffer.h:23`). */
export const CRC_MAX_BUFFER = 8192;

/**
 * The C++ `CRC32::Final` digest over `input` (two-pass ELF + CRC-32 mix).
 * On a LE host `*(DWORD*)digest ===` this value.
 */
export function crc32Flyff(input: Buffer): number {
  let m = 0xffffffff;
  // Pass A -- ELF hash.
  m = (m ^ ELF_KEY) >>> 0;
  for (let i = 0; i < input.length; i++) {
    m = (((m << 4) >>> 0) + input[i]!) >>> 0;
    const x = m & 0xf0000000;
    if (x !== 0) m = (m ^ (x >>> 24)) >>> 0;
    m = (m & (~x >>> 0)) >>> 0;
  }
  m = (m ^ ELF_KEY) >>> 0;
  // Pass B -- CRC-32 (keyed).
  m = (m ^ CRC32_KEY) >>> 0;
  let c = m >>> 0;
  for (let i = 0; i < input.length; i++) {
    c = ((c >>> 8) ^ (TABLE[(c ^ input[i]!) & 0xff] ?? 0)) >>> 0;
  }
  c = (c ^ CRC32_KEY) >>> 0;
  return c >>> 0;
}

/** Build a 13-byte-CRC-framed packet for `protocolId`. */
export function framePacketCrc(payload: Buffer, protocolId: number): Buffer {
  const sizeDword = payload.length;
  const sizeLE = Buffer.allocUnsafe(4);
  sizeLE.writeUInt32LE(sizeDword, 0);
  const sizeCRC = (~(crc32Flyff(sizeLE) ^ protocolId)) >>> 0;
  const dataCRC = (~(crc32Flyff(payload) ^ protocolId)) >>> 0;

  const frame = Buffer.allocUnsafe(CRC_HEADER_SIZE + payload.length);
  frame.writeUInt8(CRC_HEADERMARK, 0);
  frame.writeUInt32LE(sizeCRC, 1);
  frame.writeUInt32LE(sizeDword, 5);
  frame.writeUInt32LE(dataCRC, 9);
  payload.copy(frame, CRC_HEADER_SIZE);
  return frame;
}

/** Result of a successful CRC-frame decode. */
export interface CrcFrameDecode {
  payload: Buffer;
  /** Bytes consumed from the front of `chunk` (header + payload). */
  bytesConsumed: number;
}

/**
 * Verify + strip one CRC frame from the front of `chunk`.
 * Returns `null` on marker mismatch, CRC mismatch, or an incomplete frame (need
 * more bytes). Mirrors the C++ reader's recompute-and-compare (mismatch => the
 * caller drops the socket -- `clientsock.cpp:388-392`).
 */
export function tryDecodeCrcFrame(chunk: Buffer, protocolId: number): CrcFrameDecode | null {
  if (chunk.length < CRC_HEADER_SIZE) return null;
  if (chunk[0] !== CRC_HEADERMARK) return null;

  const sizeCRC = chunk.readUInt32LE(1);
  const sizeDword = chunk.readUInt32LE(5);
  const dataCRC = chunk.readUInt32LE(9);

  if (sizeDword > CRC_MAX_BUFFER) return null;
  if (chunk.length < CRC_HEADER_SIZE + sizeDword) return null; // incomplete

  const sizeLE = Buffer.allocUnsafe(4);
  sizeLE.writeUInt32LE(sizeDword, 0);
  if ((~(crc32Flyff(sizeLE) ^ protocolId) >>> 0) !== sizeCRC) return null;

  const payload = chunk.subarray(CRC_HEADER_SIZE, CRC_HEADER_SIZE + sizeDword);
  if ((~(crc32Flyff(payload) ^ protocolId) >>> 0) !== dataCRC) return null;

  return { payload: Buffer.from(payload), bytesConsumed: CRC_HEADER_SIZE + sizeDword };
}

/**
 * The v19 protocolId hello: an 8-byte payload `[DWORD 0][DWORD protocolId]`
 * (`clientsock.cpp:515-519`). If `payload` is a hello, returns the new id.
 */
export function extractProtocolIdHello(payload: Buffer): number | null {
  if (payload.length !== 8) return null;
  if (payload.readUInt32LE(0) !== 0) return null;
  return payload.readUInt32LE(4) >>> 0;
}
