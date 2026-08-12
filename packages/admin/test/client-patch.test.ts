/**
 * Tests for the client `.res` patch flow.
 *
 * The dangerous cases are the ones that touch the shipped archive: a patch that
 * loses untouched members, a repeated patch that overwrites the only pre-patch
 * backup with an already-patched copy, and a restore that can't be undone.
 *
 * `raw/` is real and shared, so these build a synthetic archive whose member
 * names are actual `raw/` files — that exercises the same read path without
 * writing anything into `raw/`.
 *
 * @module test/client-patch
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseResArchive, readResMember } from '@flyff/resources';
import { authFileStatus, buildAuthFile, parseAuthFile } from '../lib/client-auth-file';
import type {
  patchArchive as PatchArchive,
  restoreArchive as RestoreArchive,
} from '../lib/client-patch';

const RAW_DIR = new URL('../../resources/raw/', import.meta.url);

/** Build a `.res` archive from `name -> plaintext`, matching `_Common/file.cpp`. */
function makeArchive(members: Record<string, Buffer>, key = 0x57): Buffer {
  const names = Object.keys(members);
  const encrypt = (b: Buffer): Buffer => {
    const out = Buffer.alloc(b.length);
    for (let i = 0; i < b.length; i++) {
      const swapped = (((b[i] ?? 0) << 4) | ((b[i] ?? 0) >>> 4)) & 0xff;
      out[i] = (~swapped ^ key) & 0xff;
    }
    return out;
  };

  const version = Buffer.alloc(7);
  version.write('"V0.01"', 0, 'latin1');

  // Directory width is fixed by the names, so offsets can be computed up front.
  let dirLen = 7 + 2;
  for (const n of names) dirLen += 2 + Buffer.byteLength(n, 'latin1') + 4 + 4 + 4;

  const parts: Buffer[] = [version];
  const count = Buffer.alloc(2);
  count.writeInt16LE(names.length, 0);
  parts.push(count);

  let offset = 6 + dirLen;
  const payloads: Buffer[] = [];
  for (const n of names) {
    const data = encrypt(members[n] ?? Buffer.alloc(0));
    const nb = Buffer.from(n, 'latin1');
    const head = Buffer.alloc(2);
    head.writeInt16LE(nb.length, 0);
    const tail = Buffer.alloc(12);
    tail.writeInt32LE(data.length, 0);
    tail.writeInt32LE(0, 4);
    tail.writeInt32LE(offset, 8);
    parts.push(head, nb, tail);
    payloads.push(data);
    offset += data.length;
  }

  const dir = Buffer.concat(parts);
  assert.equal(dir.length, dirLen, 'directory width miscomputed');
  const header = Buffer.alloc(6);
  header.writeUInt8(key, 0);
  header.writeUInt8(1, 1);
  header.writeInt32LE(dir.length, 2);
  return Buffer.concat([header, encrypt(dir), ...payloads]);
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

void describe('client-patch', () => {
  let dir: string;
  let patchArchive: typeof PatchArchive;
  let restoreArchive: typeof RestoreArchive;
  /** A real `raw/` file, used as the tracked member. */
  const TRACKED = 'propQuest.inc';
  /** A name that is not in `raw/`, so it must be carried across untouched. */
  const UNTRACKED = 'not-a-raw-file.bin';
  const UNTRACKED_BYTES = Buffer.from('carried across verbatim');
  let rawBytes: Buffer;

  before(async () => {
    rawBytes = await readFile(new URL(TRACKED, RAW_DIR));
    dir = await mkdtemp(join(tmpdir(), 'client-patch-'));
    process.env.CLIENT_DIR = dir;
    const mod = await import('../lib/client-patch');
    patchArchive = mod.patchArchive;
    restoreArchive = mod.restoreArchive;
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Fresh client dir whose `dataSub1.res` tracked member is deliberately stale.
   *
   * All three archives are created, not just the patched one: `patchArchive`
   * rebuilds `Flyff.a` from the whole set, so a missing sibling would fail the
   * patch rather than the assertion under test.
   */
  async function seed(): Promise<string> {
    const path = join(dir, 'dataSub1.res');
    for (const f of [
      path + '.bak',
      path + '.patched',
      join(dir, 'Flyff.a'),
      join(dir, 'Flyff.a.bak'),
      join(dir, 'Flyff.a.built'),
    ]) {
      await rm(f, { force: true });
    }
    await writeFile(join(dir, 'data.res'), makeArchive({ 'define.h': Buffer.from('#define A 1') }));
    await writeFile(join(dir, 'dataSub2.res'), makeArchive({ 'spec_item.txt': Buffer.from('x') }));
    await writeFile(
      path,
      makeArchive({
        [TRACKED]: Buffer.from('stale client copy'),
        [UNTRACKED]: UNTRACKED_BYTES,
      }),
    );
    return path;
  }

  void it('merges the stale raw/ file and leaves untracked members byte-identical', async () => {
    const path = await seed();
    const result = await patchArchive(dir, 'dataSub1.res');

    assert.deepEqual(
      result.replaced.map((r) => r.name),
      [TRACKED],
    );

    const after = parseResArchive(await readFile(path));
    assert.ok(readResMember(after, TRACKED).equals(rawBytes), 'raw/ bytes did not land');
    assert.ok(
      readResMember(after, UNTRACKED).equals(UNTRACKED_BYTES),
      'an untouched member was corrupted',
    );
  });

  void it('keeps the pre-patch archive as .bak', async () => {
    const path = await seed();
    await patchArchive(dir, 'dataSub1.res');

    const backup = parseResArchive(await readFile(path + '.bak'));
    assert.equal(readResMember(backup, TRACKED).toString(), 'stale client copy');
  });

  void it('is a no-op on the second run, so the backup is never overwritten', async () => {
    const path = await seed();
    await patchArchive(dir, 'dataSub1.res');
    const backupBefore = await readFile(path + '.bak');

    const second = await patchArchive(dir, 'dataSub1.res');
    assert.deepEqual(second.replaced, [], 're-patched an already-current archive');
    assert.equal(second.backup, null);
    assert.ok(
      (await readFile(path + '.bak')).equals(backupBefore),
      'the second run clobbered the only pre-patch copy',
    );
  });

  void it('restores the backup and keeps the patched copy for undo', async () => {
    const path = await seed();
    await patchArchive(dir, 'dataSub1.res');
    await restoreArchive(dir, 'dataSub1.res');

    const live = parseResArchive(await readFile(path));
    assert.equal(readResMember(live, TRACKED).toString(), 'stale client copy');
    assert.ok(await exists(path + '.patched'), 'the patched archive was discarded');
  });

  void it('refuses to restore when no backup exists', async () => {
    await seed();
    await assert.rejects(() => restoreArchive(dir, 'dataSub1.res'), /No backup/);
  });

  void it('rejects an archive name outside the known set', async () => {
    await assert.rejects(() => patchArchive(dir, '../../etc/passwd'), /Unknown archive/);
    await assert.rejects(() => restoreArchive(dir, 'evil.res'), /Unknown archive/);
  });

  // ── Flyff.a integrity manifest ────────────────────────────────────────────
  //
  // A patched archive whose manifest was not rebuilt is what makes a client
  // built with __SECURITY_0628 ExitProcess(-1) at file.cpp:513-533. These pin
  // the rebuild to the patch so it cannot be forgotten.

  void it('rebuilds Flyff.a so every patched member is covered', async () => {
    await seed();
    const result = await patchArchive(dir, 'dataSub1.res');

    assert.equal(result.authFileRecords, 4, 'manifest should cover all 4 members');
    const status = await authFileStatus(dir);
    assert.deepEqual(status.mismatched, [], 'a patched member is not covered by the manifest');
    assert.equal(status.entries, status.members);
  });

  void it('writes the manifest in the shipped record format', async () => {
    await seed();
    await patchArchive(dir, 'dataSub1.res');

    const buf = await readFile(join(dir, 'Flyff.a'));
    assert.equal(buf.length % 64, 0, 'records must be a whole number of 64-byte rows');

    const rows = parseAuthFile(buf);
    assert.equal(rows.size, 4);
    // The patched member's own row must be md5(lowercased name) -> md5(raw bytes).
    const nameHash = createHash('md5').update(TRACKED.toLowerCase()).digest('hex');
    assert.equal(rows.get(nameHash), createHash('md5').update(rawBytes).digest('hex'));
    // Sorted ascending by name hash, as the shipped file is.
    const keys = [...rows.keys()];
    assert.deepEqual(keys, [...keys].sort());
  });

  void it('keeps the pre-patch manifest as .bak and does not churn it', async () => {
    await seed();
    await writeFile(join(dir, 'Flyff.a'), Buffer.alloc(64, 0x30));
    await patchArchive(dir, 'dataSub1.res');

    const backup = await readFile(join(dir, 'Flyff.a.bak'));
    assert.ok(backup.equals(Buffer.alloc(64, 0x30)), 'the pre-patch manifest was not preserved');

    // Second patch changes nothing, so the backup must survive intact.
    const second = await patchArchive(dir, 'dataSub1.res');
    assert.equal(second.authFileRecords, null, 'rewrote an already-current manifest');
    assert.ok((await readFile(join(dir, 'Flyff.a.bak'))).equals(backup));
  });

  void it('rebuilds the manifest after a restore, not just a patch', async () => {
    await seed();
    await patchArchive(dir, 'dataSub1.res');
    await restoreArchive(dir, 'dataSub1.res');

    const status = await authFileStatus(dir);
    assert.deepEqual(
      status.mismatched,
      [],
      'the manifest still describes the patched archive after restoring',
    );
  });

  void it('reports a stale manifest without writing anything', async () => {
    await seed();
    await patchArchive(dir, 'dataSub1.res');
    const good = await readFile(join(dir, 'Flyff.a'));

    // Corrupt one row's content hash — the shape a half-finished patch leaves.
    const bad = Buffer.from(good);
    bad.write('0'.repeat(32), 32, 'latin1');
    await writeFile(join(dir, 'Flyff.a'), bad);

    const status = await authFileStatus(dir);
    assert.equal(status.mismatched.length, 1, 'a corrupted row was not reported');
    assert.ok((await readFile(join(dir, 'Flyff.a'))).equals(bad), 'status wrote to disk');
  });
});

// ── The real shipped manifest ────────────────────────────────────────────────
//
// The synthetic archives above only prove self-consistency: this code's own
// hashes round-trip through this code's own writer. That would pass even if the
// record layout were wrong. This asserts the format against the file Gala
// shipped, and is the reason the writer can be trusted at all.
//
// Skipped when the client tree is absent so a bare checkout still passes.

const CLIENT = 'H:/flyff/v19/Client';

void describe('client-auth-file — real v19 Flyff.a', () => {
  void it('regenerates the shipped manifest byte-for-byte from the pre-patch archives', async () => {
    // `Flyff.a.bak` — not the live `Flyff.a`. Both are Gala-shipped bytes, but
    // the live one is rewritten by every patch, so it describes whatever is on
    // disk now; the backup still describes the pre-patch archive set hashed
    // below. Comparing against the live file measures the wrong pair.
    const original = await readFile(join(CLIENT, 'Flyff.a.bak')).catch(() => null);
    if (!original) return; // client tree absent, or never patched
    const shipped = parseAuthFile(original);

    // Which of `<archive>` / `<archive>.bak` the shipped manifest describes is
    // per-archive: each patch rotates only the archives it touched plus
    // `Flyff.a`, so on a tree patched more than once the backup manifest matches
    // a MIX of live and backup archives. Hash both candidates per archive and
    // keep, per member, whichever digest the manifest actually names.
    // ponytail: a member whose digest matches neither candidate is reported as
    // the live one, which is what makes the assertion below fail loudly.
    const hashes = new Map<string, string>();
    for (const name of ['data.res', 'dataSub1.res', 'dataSub2.res']) {
      const live = await readFile(join(CLIENT, name)).catch(() => null);
      if (!live) return; // client tree absent
      const bak = await readFile(join(CLIENT, `${name}.bak`)).catch(() => null);
      for (const buf of bak ? [bak, live] : [live]) {
        const archive = parseResArchive(buf);
        for (const entry of archive.entries) {
          const key = createHash('md5').update(entry.name.toLowerCase()).digest('hex');
          const digest = createHash('md5').update(readResMember(archive, entry.name)).digest('hex');
          // First candidate wins unless the manifest names the other one.
          if (!hashes.has(key) || shipped.get(key) === digest) hashes.set(key, digest);
        }
      }
    }

    assert.ok(
      buildAuthFile(hashes).equals(original),
      'rebuilt manifest differs from the shipped Flyff.a — the record format is wrong',
    );
  });
});
