/**
 * `Flyff.a` — the client's resource integrity manifest.
 *
 * `_Common/file.cpp:827 LoadAuthFile` reads this at boot (`ProjectCmn.cpp:1136`,
 * before `LoadDefines`) into `CResFile::m_mapAuth`. Then every time the client
 * reads a member out of a `.res`, `file.cpp:513-533` hashes the plaintext and
 * compares it to the manifest — on mismatch it calls `::Error()` then
 * `ExitProcess(-1)`.
 *
 * ## The check is inactive in the client we ship against
 *
 * `__SECURITY_0628` is uncommented in `Neuz/VersionCommon.h:371`, but the
 * shipped `Neuz.exe` was not built with it. The binary is unpacked — plaintext
 * `CResFile Open Error`, `kikugalanet`, `propQuest` are all present — yet every
 * string behind that flag is absent: no `Flyff.a`, no `killed by
 * CResFile::Read()`, no `resource not found`. Guarded strings missing while
 * unguarded strings from the same translation unit are present is only
 * consistent with the flag being off. Confirmed behaviourally too: the client
 * logged in normally with a deliberately mismatched manifest.
 *
 * So this module is **insurance, not a fix**. It keeps the manifest honest so a
 * client built with the flag on — or a future binary swap — does not start
 * dying on files this panel edited. Regenerating costs one pass over three
 * archives, which is cheap enough that guessing wrong in the safe direction is
 * the right trade.
 *
 * ## Format
 *
 * 134 fixed 64-byte records, sorted ascending by the first field:
 *
 * ```text
 * [32 B ASCII hex: md5(lowercased member name)][32 B ASCII hex: md5(plaintext)]
 * ```
 *
 * Names are lowercased before hashing — `file.cpp:759 strlwr`. Verified against
 * the shipped file rather than inferred: rebuilding from the pre-patch archive
 * set reproduces all 8,576 bytes of the original exactly (see the test).
 *
 * The client also sends `md5(whole Flyff.a)` as `resVer` in CERTIFY
 * (`Neuz/DPCertified.cpp:136`); `CERTIFIER/DPCertifier.cpp:243` compares it and
 * replies `ERROR_FLYFF_RESOURCE_MODIFIED` on mismatch. Our login server reads
 * the field and ignores it, so a regenerated manifest does not lock anyone out.
 *
 * ponytail: rebuilt from the three archives only. Loose files on disk are not
 * hashed, because every one of the shipped manifest's 134 entries resolves to an
 * archive member — if a future client ships loose tracked files, walk those too.
 *
 * @module lib/client-auth-file
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseResArchive, readResMember } from "@flyff/resources";
import { ARCHIVES } from "./client-archives";

/** File name in the client directory. */
export const AUTH_FILE = "Flyff.a";

/** Bytes per record: two 32-char ASCII hex digests. */
const RECORD_SIZE = 64;

/** Lowercase hex md5, the form the manifest stores. */
function md5(data: Buffer | string): string {
  return createHash("md5").update(data).digest("hex");
}

/** How the live `Flyff.a` compares to what the archives now contain. */
export interface AuthFileStatus {
  /** True when `Flyff.a` is present and readable. */
  present: boolean;
  /** Records in the live file. */
  entries: number;
  /** Members hashed out of the archives. */
  members: number;
  /**
   * Members whose content hash is absent from or differs from the manifest.
   * Non-empty means the client would `ExitProcess(-1)` reading one of these.
   */
  mismatched: string[];
  /** True when a `.bak` exists to restore from. */
  hasBackup: boolean;
  /** Set when the archives could not be read. */
  error?: string;
}

/**
 * Hash every member of every archive: `md5(lowercased name) -> md5(plaintext)`.
 *
 * @param dir - Client directory.
 * @param overrides - Archive name → file to read it from instead. Used to hash a
 *                    `.bak` in place of the live archive.
 */
async function hashAllMembers(
  dir: string,
  overrides: Readonly<Record<string, string>> = {},
): Promise<Map<string, { hash: string; name: string }>> {
  const out = new Map<string, { hash: string; name: string }>();
  for (const archiveName of ARCHIVES) {
    const path = join(dir, overrides[archiveName] ?? archiveName);
    const archive = parseResArchive(await readFile(path));
    for (const entry of archive.entries) {
      out.set(md5(entry.name.toLowerCase()), {
        hash: md5(readResMember(archive, entry.name)),
        name: entry.name,
      });
    }
  }
  return out;
}

/** Parse a manifest buffer into `md5(name) -> md5(contents)`. */
export function parseAuthFile(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i + RECORD_SIZE <= buf.length; i += RECORD_SIZE) {
    out.set(buf.toString("latin1", i, i + 32), buf.toString("latin1", i + 32, i + RECORD_SIZE));
  }
  return out;
}

/**
 * Serialize `md5(name) -> md5(contents)` into manifest bytes.
 *
 * Sorted ascending by name hash — the shipped file is, and reproducing its byte
 * layout exactly is what lets the test assert equality against it.
 */
export function buildAuthFile(hashes: ReadonlyMap<string, string>): Buffer {
  const rows = [...hashes.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Buffer.from(rows.map(([name, content]) => name + content).join(""), "latin1");
}

/** Compare the live `Flyff.a` against what the archives currently hold. */
export async function authFileStatus(dir: string): Promise<AuthFileStatus> {
  const path = join(dir, AUTH_FILE);
  const live = await readFile(path).catch(() => null);
  const hasBackup = (await readFile(path + ".bak").catch(() => null)) !== null;

  let members: Map<string, { hash: string; name: string }>;
  try {
    members = await hashAllMembers(dir);
  } catch (e) {
    return {
      present: live !== null,
      entries: live === null ? 0 : Math.floor(live.length / RECORD_SIZE),
      members: 0,
      mismatched: [],
      hasBackup,
      error: e instanceof Error ? e.message : "Could not read the archives",
    };
  }

  const manifest = live === null ? new Map<string, string>() : parseAuthFile(live);
  const mismatched: string[] = [];
  for (const [nameHash, { hash, name }] of members) {
    if (manifest.get(nameHash) !== hash) mismatched.push(name);
  }

  return {
    present: live !== null,
    entries: manifest.size,
    members: members.size,
    mismatched,
    hasBackup,
  };
}

/**
 * Rebuild `Flyff.a` from the archives as they are on disk right now.
 *
 * Same swap sequence as an archive patch: sibling temp, rename live to `.bak`,
 * rename temp into place. Both renames are same-directory so each is atomic — a
 * crash leaves either the original manifest or its backup, never a truncated
 * one, which would silently disable the integrity check on every file.
 *
 * No-op when the manifest already matches, so repeated calls cannot overwrite
 * the pre-patch backup with an already-current copy.
 *
 * @returns The number of records written, or null when nothing needed changing.
 */
export async function regenerateAuthFile(dir: string): Promise<number | null> {
  const path = join(dir, AUTH_FILE);
  const members = await hashAllMembers(dir);
  const next = buildAuthFile(new Map([...members].map(([k, v]) => [k, v.hash])));

  const live = await readFile(path).catch(() => null);
  if (live?.equals(next)) return null;

  const temp = path + ".building";
  await writeFile(temp, next);
  try {
    // First patch on a client that has no manifest yet: nothing to back up.
    if (live !== null) await rename(path, path + ".bak");
  } catch (e) {
    await unlink(temp).catch(() => undefined);
    throw e;
  }
  await rename(temp, path);
  return members.size;
}

/**
 * Restore `Flyff.a` from its `.bak`.
 *
 * Keeps the regenerated manifest as `.built` so an accidental restore is itself
 * reversible, mirroring how an archive restore keeps `.patched`.
 */
export async function restoreAuthFile(dir: string): Promise<void> {
  const path = join(dir, AUTH_FILE);
  const backup = path + ".bak";
  if ((await readFile(backup).catch(() => null)) === null) {
    throw new Error(`No backup exists for ${AUTH_FILE}`);
  }
  await rename(path, path + ".built").catch(() => undefined);
  await rename(backup, path);
}
