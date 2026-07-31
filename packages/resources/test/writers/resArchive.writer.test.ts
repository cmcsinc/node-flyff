/**
 * Tests for the `.res` archive reader/writer.
 *
 * The invariant that matters is byte-level: a repack that changes one member must
 * leave every other member's *decrypted* bytes identical, and a repack that
 * changes nothing must reproduce the source file byte for byte. Anything less and
 * the client either rejects the archive or reads garbage for an unrelated
 * resource.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseResArchive,
  readResMember,
  repackResArchive,
  writePatchedResArchive,
  type ResEntry,
} from '../../src/writers/resArchive.writer';

// ── Fixture builder ───────────────────────────────────────────────────────────
//
// Built with the cipher written out longhand rather than imported, so a sign or
// shift error in the module cannot cancel itself out against the fixture.

function encByte(key: number, b: number): number {
  const swapped = ((b << 4) | (b >>> 4)) & 0xff;
  return (~swapped ^ key) & 0xff;
}

function encBuf(key: number, buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = encByte(key, buf[i] ?? 0);
  return out;
}

const KEY = 0x57;

/** Build a valid archive from name → plaintext contents. */
function makeArchive(members: ReadonlyArray<[string, string]>, key = KEY): Buffer {
  const names = members.map(([n]) => Buffer.from(n, 'latin1'));
  const datas = members.map(([, d]) => Buffer.from(d, 'latin1'));
  const dirSize = 7 + 2 + names.reduce((n, b) => n + 2 + b.length + 12, 0);

  const dir = Buffer.alloc(dirSize);
  Buffer.from('V0.01\0\0', 'latin1').copy(dir, 0);
  let p = 7;
  dir.writeInt16LE(members.length, p);
  p += 2;
  let at = 6 + dirSize;
  for (let i = 0; i < members.length; i++) {
    const nb = names[i] as Buffer;
    const db = datas[i] as Buffer;
    dir.writeInt16LE(nb.length, p); p += 2;
    nb.copy(dir, p); p += nb.length;
    dir.writeInt32LE(db.length, p); p += 4;
    dir.writeInt32LE(1_700_000_000 + i, p); p += 4;
    dir.writeInt32LE(at, p); p += 4;
    at += db.length;
  }

  const head = Buffer.alloc(6);
  head.writeUInt8(key, 0);
  head.writeUInt8(1, 1);
  head.writeInt32LE(dirSize, 2);
  return Buffer.concat([head, encBuf(key, dir), ...datas.map((d) => encBuf(key, d))]);
}

const MEMBERS: ReadonlyArray<[string, string]> = [
  ['accessory.inc', 'accessory contents'],
  ['propQuest.inc', 'original quest text'],
  ['propQuest.txt.txt', 'IDS_X\ttext'],
];

void describe('parseResArchive', () => {
  void it('reads the header, version, and every directory entry', () => {
    const a = parseResArchive(makeArchive(MEMBERS));
    assert.equal(a.key, KEY);
    assert.equal(a.encrypted, true);
    assert.equal(a.version.toString('latin1').replace(/\0+$/, ''), 'V0.01');
    assert.deepEqual(a.entries.map((e) => e.name), MEMBERS.map(([n]) => n));
    assert.deepEqual(
      a.entries.map((e) => e.size),
      MEMBERS.map(([, d]) => d.length),
    );
  });

  void it('rejects a buffer too short for a header', () => {
    assert.throws(() => parseResArchive(Buffer.alloc(3)), /too short/);
  });

  void it('rejects a directory size past the end of the file', () => {
    const buf = makeArchive(MEMBERS);
    buf.writeInt32LE(buf.length * 2, 2);
    assert.throws(() => parseResArchive(buf), /out of range/);
  });

  void it('rejects a member whose extent runs past the file', () => {
    const a = parseResArchive(makeArchive(MEMBERS));
    // Re-encrypt a directory that claims a huge size for entry 0.
    const buf = makeArchive(MEMBERS);
    const dirSize = buf.readInt32LE(2);
    const dir = Buffer.alloc(dirSize);
    for (let i = 0; i < dirSize; i++) {
      const x = (~(buf[6 + i] ?? 0) ^ KEY) & 0xff;
      dir[i] = ((x << 4) | (x >>> 4)) & 0xff;
    }
    const sizeAt = 7 + 2 + 2 + (a.entries[0]?.name.length ?? 0);
    dir.writeInt32LE(0x7fffff, sizeAt);
    encBuf(KEY, dir).copy(buf, 6);
    assert.throws(() => parseResArchive(buf), /past the end/);
  });
});

void describe('readResMember', () => {
  void it('decrypts a member back to its plaintext', () => {
    const a = parseResArchive(makeArchive(MEMBERS));
    assert.equal(readResMember(a, 'propQuest.inc').toString('latin1'), 'original quest text');
  });

  void it('matches a member name case-insensitively, as the client does', () => {
    const a = parseResArchive(makeArchive(MEMBERS));
    assert.equal(readResMember(a, 'PROPQUEST.INC').toString('latin1'), 'original quest text');
  });

  void it('throws for an unknown member rather than returning empty bytes', () => {
    const a = parseResArchive(makeArchive(MEMBERS));
    assert.throws(() => readResMember(a, 'nope.inc'), /no member named/);
  });
});

void describe('repackResArchive', () => {
  void it('reproduces the source byte-for-byte when nothing is replaced', () => {
    const src = makeArchive(MEMBERS);
    assert.ok(repackResArchive(parseResArchive(src), {}).equals(src), 'no-op repack changed bytes');
  });

  void it('replaces one member and leaves the others decrypting identically', () => {
    const src = makeArchive(MEMBERS);
    const out = repackResArchive(parseResArchive(src), {
      'propQuest.inc': Buffer.from('a much longer replacement body', 'latin1'),
    });
    const a = parseResArchive(out);
    assert.equal(readResMember(a, 'propQuest.inc').toString('latin1'), 'a much longer replacement body');
    assert.equal(readResMember(a, 'accessory.inc').toString('latin1'), 'accessory contents');
    assert.equal(readResMember(a, 'propQuest.txt.txt').toString('latin1'), 'IDS_X\ttext');
  });

  void it('keeps names, order, and timestamps; moves only sizes and offsets', () => {
    const before = parseResArchive(makeArchive(MEMBERS));
    const after = parseResArchive(
      repackResArchive(before, { 'propQuest.inc': Buffer.from('short', 'latin1') }),
    );
    const strip = (e: ResEntry): [string, number] => [e.name, e.time];
    assert.deepEqual(after.entries.map(strip), before.entries.map(strip));
    assert.equal(after.entries[1]?.size, 5);
    // Every offset still lands inside the file and after the directory.
    for (const e of after.entries) {
      assert.ok(e.offset >= 6, 'offset overlaps the header');
      assert.ok(e.offset + e.size <= after.buffer.length, 'member runs past the file');
    }
  });

  void it('shrinks the file when the replacement is smaller — no stale tail', () => {
    const src = makeArchive(MEMBERS);
    const out = repackResArchive(parseResArchive(src), {
      'propQuest.inc': Buffer.from('x', 'latin1'),
    });
    assert.equal(out.length, src.length - ('original quest text'.length - 1));
  });

  void it('refuses to add a member — Merge.exe decides which archive one lands in', () => {
    const a = parseResArchive(makeArchive(MEMBERS));
    assert.throws(
      () => repackResArchive(a, { 'brandNew.inc': Buffer.from('x') }),
      /never adds a member/,
    );
  });
});

// ── I/O ───────────────────────────────────────────────────────────────────────

void describe('writePatchedResArchive', () => {
  void it('writes a patched copy and reports what it replaced', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'res-'));
    try {
      const src = join(dir, 'dataSub1.res');
      const out = join(dir, 'dataSub1.patched.res');
      const inc = join(dir, 'propQuest.inc');
      await writeFile(src, makeArchive(MEMBERS));
      await writeFile(inc, 'patched quest body', 'latin1');

      const report = await writePatchedResArchive(src, out, { 'propQuest.inc': inc });
      assert.deepEqual(report, [{ name: 'propQuest.inc', size: 'patched quest body'.length }]);

      const a = parseResArchive(await readFile(out));
      assert.equal(readResMember(a, 'propQuest.inc').toString('latin1'), 'patched quest body');
      // The source is untouched — it is the only copy of the members not edited.
      const srcArchive = parseResArchive(await readFile(src));
      assert.equal(readResMember(srcArchive, 'propQuest.inc').toString('latin1'), 'original quest text');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  void it('refuses to write over the source archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'res-'));
    try {
      const src = join(dir, 'a.res');
      await writeFile(src, makeArchive(MEMBERS));
      await assert.rejects(
        () => writePatchedResArchive(src, src, {}),
        /overwrite the source archive/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── The real shipped archive ──────────────────────────────────────────────────
//
// The fixture only covers hazards I thought to write down. This runs against the
// real 9,133,318-byte v19 `dataSub1.res` (29 members) so an unanticipated shape
// still fails. Read-only: the repack is held in memory, never written back.
// Skipped when the client tree is absent, so CI on a bare checkout still passes.

const REAL_RES = 'H:/flyff/v19/Client/dataSub1.res';

void describe('resArchive — real v19 dataSub1.res', () => {
  void it('parses the real archive and round-trips a no-op repack byte-identically', async () => {
    let buf: Buffer;
    try {
      buf = await readFile(REAL_RES);
    } catch {
      return; // client tree absent in this checkout
    }
    const a = parseResArchive(buf);
    assert.ok(a.entries.length > 20, `expected the full directory, found ${String(a.entries.length)}`);
    assert.ok(
      a.entries.some((e) => e.name === 'propQuest.inc'),
      'propQuest.inc is not a member of dataSub1.res',
    );
    assert.ok(repackResArchive(a, {}).equals(buf), 'no-op repack of the real archive changed bytes');
  });

  void it('decrypts the packed propQuest.inc to the same bytes as raw/', async () => {
    let buf: Buffer;
    try {
      buf = await readFile(REAL_RES);
    } catch {
      return;
    }
    const raw = await readFile(new URL('../../raw/propQuest.inc', import.meta.url)).catch(
      () => null,
    );
    if (!raw) return; // raw/ absent
    const packed = readResMember(parseResArchive(buf), 'propQuest.inc');
    assert.ok(
      packed.equals(raw),
      'the packed copy and raw/propQuest.inc differ — the client is already out of sync',
    );
  });

  void it('replaces the real propQuest.inc without disturbing the other 28 members', async () => {
    let buf: Buffer;
    try {
      buf = await readFile(REAL_RES);
    } catch {
      return;
    }
    const before = parseResArchive(buf);
    const body = Buffer.from('\uFEFFpatched\r\n', 'utf16le');
    const after = parseResArchive(repackResArchive(before, { 'propQuest.inc': body }));

    assert.equal(after.entries.length, before.entries.length);
    for (const e of before.entries) {
      if (e.name === 'propQuest.inc') continue;
      assert.ok(
        readResMember(after, e.name).equals(readResMember(before, e.name)),
        `member "${e.name}" changed`,
      );
    }
    assert.ok(readResMember(after, 'propQuest.inc').equals(body));
  });
});
