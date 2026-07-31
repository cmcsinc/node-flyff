/**
 * Reader/writer for the Flyff `.res` archive — the client patch export.
 *
 * A quest edit is only half done when `raw/propQuest.inc` is written. That file
 * is packed into the client's `dataSub1.res` (`game/resource/resource.txt:132`),
 * and `Project.cpp:495 LoadPropQuest` has no `__WORLDSERVER` guard, so the
 * client parses its own copy. Until the archive is rebuilt, the client renders
 * rewards, conditions, and the NPC head icon from stale data.
 *
 * ## Why this replaces members instead of building from resource.txt
 *
 * `resource.txt` names 134 files across three archives. Rebuilding from it needs
 * every one of them present and correct, and gets the *whole* client's data wrong
 * if one is stale. Replacing named members inside an existing archive touches
 * only what changed: every other member's bytes, name, and timestamp are carried
 * across verbatim, so a diff against the shipped archive is exactly the edit.
 *
 * ponytail: no full build from `resource.txt`, and no member add/remove. Add
 * those when a brand-new resource file has to ship (a new quest *file*, not a new
 * quest inside an existing one) — that needs the loose-file tree plus
 * `- Merge.exe`'s own semantics for which archive a name lands in.
 *
 * ## Format (`_Common/file.cpp:104-160` AddResource, `:400-430` Open)
 *
 * ```text
 * [1 B key][1 B bEncryption][4 B dirSize][dirSize B directory, encrypted]
 * directory: [7 B version][2 B int16 count]
 *            count × [2 B int16 nameLen][nameLen B name][4 B size][4 B time][4 B offset]
 * data:      each member's bytes at its offset, every byte encrypted
 * ```
 *
 * Sizes and offsets in the directory are plaintext *within* the encrypted
 * directory blob — the whole blob is encrypted byte-wise after being built.
 *
 * @module writers/resArchive
 */

import { readFile, writeFile } from 'node:fs/promises';

/** One member of an archive, as the directory describes it. */
export interface ResEntry {
  /** Name as stored, e.g. `propQuest.inc`. Case is preserved verbatim. */
  readonly name: string;
  readonly size: number;
  /** `time_t` as a 32-bit value; carried across untouched. */
  readonly time: number;
  readonly offset: number;
}

/** A parsed archive: its header, directory, and the backing buffer. */
export interface ResArchive {
  readonly key: number;
  readonly encrypted: boolean;
  /** 7-byte version field, e.g. `V0.01` (quoted, NUL-padded in the file). */
  readonly version: Buffer;
  readonly entries: readonly ResEntry[];
  readonly buffer: Buffer;
}

/** Byte cipher — `CResFile::Encryption` (`_Common/file.h:78-82`). */
function encryptByte(key: number, b: number): number {
  const swapped = ((b << 4) | (b >>> 4)) & 0xff;
  return (~swapped ^ key) & 0xff;
}

/** Byte cipher inverse — `CResFile::Decryption` (`_Common/file.h:83-87`). */
function decryptByte(key: number, b: number): number {
  const x = (~b ^ key) & 0xff;
  return ((x << 4) | (x >>> 4)) & 0xff;
}

function cipher(key: number, buf: Buffer, fn: (k: number, b: number) => number): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = fn(key, buf[i] ?? 0);
  return out;
}

/** Header size: key + bEncryption + dirSize. */
const HEADER_SIZE = 6;
/** Fixed width of the directory's version field. */
const VERSION_SIZE = 7;

/**
 * Pure: parse an archive's header and directory.
 *
 * @throws When the buffer is too short or the directory does not consume exactly
 *         `dirSize` bytes — a truncated archive read as valid would silently drop
 *         members on the next repack.
 */
export function parseResArchive(buffer: Buffer): ResArchive {
  if (buffer.length < HEADER_SIZE) {
    throw new Error(`.res: file is ${String(buffer.length)} bytes, too short for a header`);
  }
  const key = buffer.readUInt8(0);
  const encrypted = buffer.readUInt8(1) !== 0;
  const dirSize = buffer.readInt32LE(2);
  if (dirSize < VERSION_SIZE + 2 || HEADER_SIZE + dirSize > buffer.length) {
    throw new Error(`.res: directory size ${String(dirSize)} is out of range`);
  }

  const dir = cipher(key, buffer.subarray(HEADER_SIZE, HEADER_SIZE + dirSize), decryptByte);
  const version = dir.subarray(0, VERSION_SIZE);
  let p = VERSION_SIZE;
  const count = dir.readInt16LE(p);
  p += 2;

  const entries: ResEntry[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = dir.readInt16LE(p);
    p += 2;
    const name = dir.toString('latin1', p, p + nameLen);
    p += nameLen;
    const size = dir.readInt32LE(p);
    p += 4;
    const time = dir.readInt32LE(p);
    p += 4;
    const offset = dir.readInt32LE(p);
    p += 4;
    if (offset + size > buffer.length) {
      throw new Error(
        `.res: member "${name}" claims ${String(size)} bytes at ${String(offset)}, ` +
        `past the end of a ${String(buffer.length)}-byte file`,
      );
    }
    entries.push({ name, size, time, offset });
  }
  if (p !== dirSize) {
    throw new Error(
      `.res: directory declared ${String(dirSize)} bytes but ${String(count)} entries ` +
      `consumed ${String(p)} — the file is truncated or the format differs`,
    );
  }
  return { key, encrypted, version, entries, buffer };
}

/** Pure: decrypt one member's bytes out of a parsed archive. */
export function readResMember(archive: ResArchive, name: string): Buffer {
  const entry = archive.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    throw new Error(`.res: no member named "${name}"`);
  }
  const raw = archive.buffer.subarray(entry.offset, entry.offset + entry.size);
  return archive.encrypted ? cipher(archive.key, raw, decryptByte) : Buffer.from(raw);
}

/** Encoded directory blob plus the offsets it commits to. */
function buildDirectory(
  archive: ResArchive,
  sizes: readonly number[],
): { dir: Buffer; offsets: number[] } {
  // The directory's own length is fixed by the names, which never change here,
  // so it can be measured before the offsets it contains are known.
  const nameBufs = archive.entries.map((e) => Buffer.from(e.name, 'latin1'));
  const dirSize =
    VERSION_SIZE + 2 + nameBufs.reduce((n, b) => n + 2 + b.length + 4 + 4 + 4, 0);

  const offsets: number[] = [];
  let at = HEADER_SIZE + dirSize;
  for (const size of sizes) {
    offsets.push(at);
    at += size;
  }

  const dir = Buffer.alloc(dirSize);
  archive.version.copy(dir, 0);
  let p = VERSION_SIZE;
  dir.writeInt16LE(archive.entries.length, p);
  p += 2;
  for (let i = 0; i < archive.entries.length; i++) {
    const nameBuf = nameBufs[i] ?? Buffer.alloc(0);
    dir.writeInt16LE(nameBuf.length, p);
    p += 2;
    nameBuf.copy(dir, p);
    p += nameBuf.length;
    dir.writeInt32LE(sizes[i] ?? 0, p);
    p += 4;
    dir.writeInt32LE(archive.entries[i]?.time ?? 0, p);
    p += 4;
    dir.writeInt32LE(offsets[i] ?? 0, p);
    p += 4;
  }
  return { dir, offsets };
}

/**
 * Pure: rebuild an archive with some members' contents replaced.
 *
 * Every member not named in `replacements` is copied through as the exact bytes
 * already in the archive — not decrypted and re-encrypted — so an unchanged
 * member cannot drift even if this module's cipher were wrong.
 *
 * Member order, names, and timestamps are preserved; only sizes and offsets move.
 *
 * @param archive      - Parsed source archive.
 * @param replacements - Plaintext contents keyed by member name (case-insensitive).
 * @throws When a name has no matching member. This function never adds a member:
 *         `- Merge.exe` decides which of the three archives a new name belongs to,
 *         and guessing wrong makes the file unreachable to the client.
 */
export function repackResArchive(
  archive: ResArchive,
  replacements: Readonly<Record<string, Buffer>>,
): Buffer {
  const byLower = new Map<string, Buffer>();
  for (const [name, data] of Object.entries(replacements)) {
    byLower.set(name.toLowerCase(), data);
  }
  for (const name of byLower.keys()) {
    if (!archive.entries.some((e) => e.name.toLowerCase() === name)) {
      throw new Error(
        `.res: no member named "${name}" to replace. This writer never adds a member — ` +
        `a new resource file has to be placed by - Merge.exe.`,
      );
    }
  }

  // Payload per member: the replacement encrypted now, or the original slice
  // carried across byte for byte.
  const payloads = archive.entries.map((e) => {
    const next = byLower.get(e.name.toLowerCase());
    if (next === undefined) return archive.buffer.subarray(e.offset, e.offset + e.size);
    return archive.encrypted ? cipher(archive.key, next, encryptByte) : next;
  });

  const { dir } = buildDirectory(archive, payloads.map((b) => b.length));
  const head = Buffer.alloc(HEADER_SIZE);
  head.writeUInt8(archive.key, 0);
  head.writeUInt8(archive.encrypted ? 1 : 0, 1);
  head.writeInt32LE(dir.length, 2);

  return Buffer.concat([head, cipher(archive.key, dir, encryptByte), ...payloads]);
}

/**
 * I/O wrapper: read an archive, replace members from files on disk, write the
 * result to a new path.
 *
 * Writes to `outPath`, never over `resPath`. A client whose archive was
 * overwritten in place by a failed write cannot start, and the shipped archive is
 * the only copy of the 100+ members this tool does not touch.
 *
 * @param resPath - Source archive (e.g. the shipped `dataSub1.res`).
 * @param outPath - Destination for the patched archive. Must differ from `resPath`.
 * @param members - Member name → path of the plaintext file to pack into it.
 * @returns The name/size of each replaced member, for the caller to report.
 */
export async function writePatchedResArchive(
  resPath: string,
  outPath: string,
  members: Readonly<Record<string, string>>,
): Promise<Array<{ name: string; size: number }>> {
  if (resPath === outPath) {
    throw new Error('.res: refusing to overwrite the source archive in place');
  }
  const archive = parseResArchive(await readFile(resPath));
  const entries = Object.entries(members);
  const contents = await Promise.all(entries.map(([, path]) => readFile(path)));

  const replacements: Record<string, Buffer> = {};
  entries.forEach(([name], i) => {
    replacements[name] = contents[i] ?? Buffer.alloc(0);
  });

  await writeFile(outPath, repackResArchive(archive, replacements));
  return entries.map(([name], i) => ({ name, size: contents[i]?.length ?? 0 }));
}
