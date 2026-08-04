/**
 * Client `.res` patch — status, patch, restore.
 *
 * `GET`  reports which `raw/` files differ from their packed copy in the client.
 * `POST` merges the stale ones into the archive behind a backup, or restores
 *        that backup.
 *
 * SECURITY: `auth()` first, then Zod. The client directory comes from
 * `CLIENT_DIR` in env and is never taken from the request — a caller-supplied
 * path would turn this into an arbitrary-file-write behind an admin session.
 * `archive` is validated against a fixed enum for the same reason, and the
 * writer itself refuses to add or remove members.
 *
 * @module app/api/client-patch/route
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import {
  ARCHIVES,
  clientDir,
  clientPatchStatus,
  patchArchive,
  restoreArchive,
} from "@/lib/client-patch";
import { regenerateAuthFile } from "@/lib/client-auth-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, ...(await clientPatchStatus()) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to read client archives";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

const PostSchema = z.object({
  action: z.enum(["patch", "restore", "rebuild-manifest"]),
  /** Required for patch/restore; ignored by rebuild-manifest. */
  archive: z.enum(ARCHIVES).optional(),
  /** Restrict a patch to these member names. Omit to patch every stale member. */
  members: z.array(z.string().min(1).max(128)).max(256).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = PostSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { action, archive, members } = body.data;

  const dir = clientDir();
  if (!dir) {
    return NextResponse.json(
      { ok: false, error: "CLIENT_DIR is not set, so there is no client to patch." },
      { status: 400 },
    );
  }

  try {
    if (action === "rebuild-manifest") {
      const records = await regenerateAuthFile(dir);
      await writeAudit(session, {
        action: "client_manifest_rebuild",
        targetType: "client_archive",
        targetId: null,
        details: { records },
      });
      return NextResponse.json({ ok: true, records });
    }

    if (archive === undefined) {
      return NextResponse.json(
        { ok: false, error: "An archive is required for this action." },
        { status: 400 },
      );
    }

    if (action === "restore") {
      await restoreArchive(dir, archive);
      await writeAudit(session, {
        action: "client_restore",
        targetType: "client_archive",
        targetId: null,
        details: { archive },
      });
      return NextResponse.json({ ok: true, archive, restored: true });
    }

    const result = await patchArchive(dir, archive, members);
    await writeAudit(session, {
      action: "client_patch",
      targetType: "client_archive",
      targetId: null,
      details: {
        archive,
        members: result.replaced.map((r) => r.name),
        backup: result.backup !== null,
        authFileRecords: result.authFileRecords,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Patch failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
