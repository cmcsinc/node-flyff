/**
 * Client `.res` patching — merge edited `raw/` files into the game client.
 *
 * A resource edit made in this panel is only half done when `raw/<file>` is
 * written. The client parses its **own** packed copy out of `data.res` /
 * `dataSub1.res` / `dataSub2.res` (`_Common/file.cpp`), and several loaders have
 * no `__WORLDSERVER` guard — `Project.cpp:495 LoadPropQuest` is the one that
 * bites: `WndQuest.cpp` renders the objective list, and `Mover.cpp:9540-10290`
 * re-evaluates begin/end conditions, both from the client's archive. Until the
 * archive is rebuilt the client shows stale goals against a server that already
 * moved — the exact shape of the "quest asks for the wrong item" class of bug.
 *
 * This module is the wiring around the tested archive writer
 * (`@flyff/resources` `resArchive.writer`): work out which `raw/` files are
 * members of which archive, compare bytes, and swap in a patched copy behind a
 * backup.
 *
 * ## Safety model
 *
 * - The writer never overwrites its source, so a patch is: write a sibling temp
 *   file, `rename` the live archive to `<name>.bak`, `rename` temp into place.
 *   Both renames are same-directory, so each is atomic; a crash mid-sequence
 *   leaves either the original or the backup, never a half-written archive.
 * - Members are never added or removed. `- Merge.exe` decides which archive a
 *   brand-new file belongs to, and guessing wrong makes it unreachable.
 * - `CLIENT_DIR` is read once from env, not from request input. A caller-supplied
 *   path here would be an arbitrary-filesystem-write primitive behind an admin
 *   session.
 *
 * ponytail: one backup generation per archive (`.bak`), not a rotating history.
 * Add rotation when someone needs to walk back more than one patch — the swap
 * sequence is unchanged, only the backup name has to become indexed.
 *
 * @module lib/client-patch
 */

import { readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseResArchive, readResMember, repackResArchive } from "@flyff/resources";
import { RAW_DIR } from "./resource-cache";
import { ARCHIVES, isArchive } from "./client-archives";
import { authFileStatus, regenerateAuthFile, type AuthFileStatus } from "./client-auth-file";

export { ARCHIVES } from "./client-archives";

/** Suffix for the pre-patch copy kept beside each archive. */
const BACKUP_SUFFIX = ".bak";

/** One `raw/` file measured against its packed copy in an archive. */
export interface MemberStatus {
  /** Member name as stored in the archive, e.g. `propQuest.inc`. */
  name: string;
  /** Archive holding it. */
  archive: string;
  /** Bytes of the `raw/` file, or null when it is absent from `raw/`. */
  rawSize: number | null;
  /** Bytes of the packed copy. */
  packedSize: number;
  /** True when `raw/` differs from the packed copy and would be written. */
  stale: boolean;
}

/** One archive's patch state. */
export interface ArchiveStatus {
  name: string;
  /** Total members in the archive's directory. */
  memberCount: number;
  /** Members that also exist in `raw/` — the patchable surface. */
  tracked: MemberStatus[];
  /** Subset of `tracked` that differs. */
  staleCount: number;
  /** True when a `.bak` exists to restore from. */
  hasBackup: boolean;
  /** Set when the archive could not be read; the other fields are then empty. */
  error?: string;
}

/** Whole-client patch state, plus how the client directory was resolved. */
export interface ClientPatchStatus {
  /** Absolute client directory, or null when `CLIENT_DIR` is unset. */
  clientDir: string | null;
  archives: ArchiveStatus[];
  /**
   * `Flyff.a` integrity-manifest state. Absent when there is no client dir.
   *
   * A patched archive whose manifest was not rebuilt makes the client
   * `ExitProcess(-1)` on the first read of the changed file, so this is reported
   * alongside the archives rather than hidden behind the patch action.
   */
  authFile?: AuthFileStatus;
}

/**
 * The configured client directory, or null when unset.
 *
 * Read from env only — see the security note in the module doc.
 */
export function clientDir(): string | null {
  const dir = process.env.CLIENT_DIR?.trim();
  return dir ? dir : null;
}

/** True when `path` exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read one archive and diff every member that also exists in `raw/`.
 *
 * A member absent from `raw/` is not reported: the panel only edits files that
 * live in `raw/`, and listing the other ~120 as "unpatchable" is noise.
 */
async function readArchiveStatus(dir: string, name: string): Promise<ArchiveStatus> {
  const path = join(dir, name);
  const base: ArchiveStatus = {
    name,
    memberCount: 0,
    tracked: [],
    staleCount: 0,
    hasBackup: await exists(path + BACKUP_SUFFIX),
  };

  let archive;
  try {
    archive = parseResArchive(await readFile(path));
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "Unreadable" };
  }

  const tracked: MemberStatus[] = [];
  for (const entry of archive.entries) {
    // Members are flat names; `basename` keeps a crafted directory entry from
    // reaching outside `raw/` when this reads from disk.
    const rawPath = join(RAW_DIR, basename(entry.name));
    const raw = await readFile(rawPath).catch(() => null);
    if (!raw) continue;

    const packed = readResMember(archive, entry.name);
    tracked.push({
      name: entry.name,
      archive: name,
      rawSize: raw.length,
      packedSize: packed.length,
      stale: !packed.equals(raw),
    });
  }

  return {
    ...base,
    memberCount: archive.entries.length,
    tracked,
    staleCount: tracked.filter((t) => t.stale).length,
  };
}

/** Patch state for every archive, plus the manifest. Read-only — writes nothing. */
export async function clientPatchStatus(): Promise<ClientPatchStatus> {
  const dir = clientDir();
  if (!dir) return { clientDir: null, archives: [] };
  const archives = await Promise.all(ARCHIVES.map((a) => readArchiveStatus(dir, a)));
  return { clientDir: dir, archives, authFile: await authFileStatus(dir) };
}

/** What one `patchArchive` call did. */
export interface PatchResult {
  archive: string;
  /** Members whose bytes were replaced. */
  replaced: { name: string; size: number }[];
  /** Path of the backup written, when anything was replaced. */
  backup: string | null;
  /**
   * Records written to `Flyff.a`, or null when it already matched.
   *
   * Rebuilding is not optional: `file.cpp:513-533` kills the client on the first
   * read of a member whose hash is not in the manifest.
   */
  authFileRecords: number | null;
}

/**
 * Merge every stale `raw/` file into one archive, then rebuild `Flyff.a`.
 *
 * No-op (and no backup) when nothing is stale, so repeated clicks don't churn
 * the backup into a copy of the already-patched archive — which would destroy
 * the only pre-patch copy.
 *
 * The manifest rebuild is part of this function, not a separate step a caller
 * could forget: an archive patched without it kills the client at
 * `file.cpp:513-533` on the first read of the changed member.
 *
 * @param dir  - Client directory.
 * @param name - Archive file name, which must be one of {@link ARCHIVES}.
 * @param only - When given, restrict the patch to these member names.
 */
export async function patchArchive(
  dir: string,
  name: string,
  only?: readonly string[],
): Promise<PatchResult> {
  if (!isArchive(name)) {
    throw new Error(`Unknown archive "${name}"`);
  }
  const path = join(dir, name);
  const archive = parseResArchive(await readFile(path));

  const wanted = only ? new Set(only.map((n) => n.toLowerCase())) : null;
  const replacements: Record<string, Buffer> = {};
  const replaced: { name: string; size: number }[] = [];

  for (const entry of archive.entries) {
    if (wanted && !wanted.has(entry.name.toLowerCase())) continue;
    const raw = await readFile(join(RAW_DIR, basename(entry.name))).catch(() => null);
    if (!raw) continue;
    if (readResMember(archive, entry.name).equals(raw)) continue;
    replacements[entry.name] = raw;
    replaced.push({ name: entry.name, size: raw.length });
  }

  // Still reconcile the manifest when no archive changed: a previous patch may
  // have left it stale, and that state is what kills the client.
  if (replaced.length === 0) {
    return {
      archive: name,
      replaced: [],
      backup: null,
      authFileRecords: await regenerateAuthFile(dir),
    };
  }

  // Temp beside the target so both renames stay same-filesystem and atomic.
  const temp = path + ".patching";
  const backup = path + BACKUP_SUFFIX;
  await writeFile(temp, repackResArchive(archive, replacements));
  try {
    await rename(path, backup);
  } catch (e) {
    await unlink(temp).catch(() => undefined);
    throw e;
  }
  await rename(temp, path);

  // After the swap, so the manifest describes the archive now on disk.
  return { archive: name, replaced, backup, authFileRecords: await regenerateAuthFile(dir) };
}

/**
 * Restore one archive from its `.bak`, then rebuild `Flyff.a` to match.
 *
 * The patched archive is moved aside to `.patched` rather than deleted, so a
 * restore triggered by mistake is itself reversible.
 *
 * The manifest is regenerated rather than restored from `Flyff.a.bak`: that
 * backup describes one particular past state, and restoring a single archive
 * while leaving the others patched has no past state to go back to. Rebuilding
 * always yields a manifest consistent with whatever is on disk.
 */
export async function restoreArchive(dir: string, name: string): Promise<void> {
  if (!isArchive(name)) {
    throw new Error(`Unknown archive "${name}"`);
  }
  const path = join(dir, name);
  const backup = path + BACKUP_SUFFIX;
  if (!(await exists(backup))) throw new Error(`No backup exists for ${name}`);

  await rename(path, path + ".patched").catch(() => undefined);
  await rename(backup, path);
  await regenerateAuthFile(dir);
}
