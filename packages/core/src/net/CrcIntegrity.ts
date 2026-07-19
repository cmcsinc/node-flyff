/**
 * CRC32+ELF integrity check for Flyff packet validation.
 *
 * The C++ source uses a modified CRC32 concatenated with an ELF hash,
 * both keyed with magic constants, then XOR'd with a per-connection
 * protocol ID and bitwise-NOT'd. This is NOT encryption — payload
 * bytes travel plaintext. Only two DWORDs in the header are obfuscated.
 *
 * Algorithm (per header DWORD):
 *   obfuscated = ~(CRC32(input) ^ protocolId)
 *
 * @module net/CrcIntegrity
 */

// Magic constants from C++ crc.cpp
const ELF_KEY = 0x15779231;
const CRC32_KEY = 0x13393917;

// CRC32 lookup table (standard polynomial, little-endian)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  CRC32_TABLE[i] = crc;
}

/**
 * Computes the modified CRC32+ELF hash used by Flyff.
 *
 * @param data - Buffer to hash
 * @returns 32-bit unsigned hash
 */
function computeHash(data: Buffer): number {
  let crc = 0xffffffff;

  // ELF HASH
  crc ^= ELF_KEY;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;
    crc = ((crc << 4) + byte) >>> 0;
    x = crc & 0xf0000000;
    if (x !== 0) {
      crc ^= x >>> 24;
    }
    crc &= ~x;
    crc = crc >>> 0;
  }
  crc ^= ELF_KEY;
  crc = crc >>> 0;

  // CRC32 HASH
  crc ^= CRC32_KEY;
  crc = crc >>> 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    crc = crc >>> 0;
  }
  crc ^= CRC32_KEY;
  crc = crc >>> 0;

  return crc;
}

/**
 * Obfuscates a DWORD using the Flyff integrity formula.
 *
 * @param value - DWORD to obfuscate (e.g., size or payload hash)
 * @param protocolId - Per-connection protocol ID (from GetTickCount)
 * @returns Obfuscated DWORD: ~(hash ^ protocolId)
 */
export function obfuscate(value: number, protocolId: number): number {
  return (~((value ^ protocolId) >>> 0)) >>> 0;
}

/**
 * Deobfuscates a DWORD using the Flyff integrity formula.
 *
 * @param obfuscated - Obfuscated DWORD from wire
 * @param protocolId - Per-connection protocol ID
 * @returns Original DWORD: ~(obfuscated) ^ protocolId
 */
export function deobfuscate(obfuscated: number, protocolId: number): number {
  return ((~obfuscated) >>> 0 ^ protocolId) >>> 0;
}

/**
 * Computes the obfuscated size CRC for a packet header.
 *
 * @param sizeBytes - 4-byte buffer containing the size DWORD (LE)
 * @param protocolId - Per-connection protocol ID
 * @returns Obfuscated CRC DWORD
 */
export function computeSizeCrc(sizeBytes: Buffer, protocolId: number): number {
  const hash = computeHash(sizeBytes);
  return obfuscate(hash, protocolId);
}

/**
 * Computes the obfuscated payload CRC for a packet header.
 *
 * @param payload - Payload bytes (opcode + fields)
 * @param protocolId - Per-connection protocol ID
 * @returns Obfuscated CRC DWORD
 */
export function computePayloadCrc(payload: Buffer, protocolId: number): number {
  const hash = computeHash(payload);
  return obfuscate(hash, protocolId);
}

/**
 * Validates a packet's size CRC.
 *
 * @param sizeBytes - 4-byte buffer containing the size DWORD (LE)
 * @param sizeCrc - Obfuscated CRC from wire
 * @param protocolId - Per-connection protocol ID
 * @returns true if CRC matches
 */
export function validateSizeCrc(
  sizeBytes: Buffer,
  sizeCrc: number,
  protocolId: number
): boolean {
  const expected = computeSizeCrc(sizeBytes, protocolId);
  return expected === sizeCrc;
}

/**
 * Validates a packet's payload CRC.
 *
 * @param payload - Payload bytes (opcode + fields)
 * @param payloadCrc - Obfuscated CRC from wire
 * @param protocolId - Per-connection protocol ID
 * @returns true if CRC matches
 */
export function validatePayloadCrc(
  payload: Buffer,
  payloadCrc: number,
  protocolId: number
): boolean {
  const expected = computePayloadCrc(payload, protocolId);
  return expected === payloadCrc;
}
