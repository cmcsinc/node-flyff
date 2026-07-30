/**
 * `character.inc` capability write.
 *
 * PUT replaces a block's `AddMenu( MMI_* )` list — the real source of NPC
 * capability (`CMover::m_abMoverMenu`). Nothing else about the block is touched.
 *
 * SECURITY: `auth()` first. The target file is read by the **game client** as
 * well as the server, so the body is validated hard before it reaches the writer:
 * every id must be a real `MMI_*` declared by `defineNeuz.h` (checked against the
 * inverted symbol map, not a range test), and the block key must already exist —
 * this route never creates blocks.
 *
 * The edit is block-global: several placements can share a `character_key`, and
 * the C++ model has no per-placement override. The panel warns; the audit record
 * captures how many were affected.
 *
 * @module app/api/character-inc/route
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { writeCharacterEdit, allocTextTokens, type CharacterEdit } from "@flyff/resources";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getResourceIndex, invalidateResourceCache } from "@/lib/resource-cache";
import { RAW_DIR, getIncSymbols, readIncBlock, sharersForKey } from "@/lib/character-inc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/, "Invalid block key");

/**
 * One PUT edits menus, shop stock, or both. Every field is optional and only the
 * ones present are written — `CharacterEdit` leaves unset fields untouched in
 * the file, so a menus-only save can never blank a shop.
 *
 * Bounds mirror the game's own limits: 4 tabs (`AddVendorSlot( 0..3 )`), 100
 * slots per tab (`MAX_VENDOR_INVENTORY`). Ids and IK3 symbols are additionally
 * verified against real resource data below — these bounds only cap payload size.
 */
const PutSchema = z.object({
  key: KeySchema,
  menus: z.array(z.number().int().min(0).max(4096)).max(512).optional(),
  /**
   * Shop tabs. `label` is the caption a player reads, NOT a token — the route
   * mints the `IDS_*` token and writes the caption into `character.txt.txt`, so
   * both halves of the client-visible pair always land together.
   */
  tabs: z
    .array(
      z.object({
        slot: z.number().int().min(0).max(3),
        label: z.string().min(1).max(64),
        /** Existing token to reuse; omitted for a newly added tab. */
        token: z
          .string()
          .max(64)
          .regex(/^IDS_[A-Za-z0-9_]+$/, "Invalid string-table token")
          .optional(),
      }),
    )
    .max(4)
    .optional(),
  rules: z
    .array(
      z.object({
        slot: z.number().int().min(0).max(3),
        kind3: z.string().min(1).max(64).regex(/^IK3_[A-Z0-9_]+$/, "Invalid IK3 symbol"),
        job: z.number().int().min(-1).max(64),
        uniqueMin: z.number().int().min(0).max(200),
        uniqueMax: z.number().int().min(0).max(200),
        totalNum: z.number().int().min(0).max(100),
      }),
    )
    .max(64)
    .optional(),
  explicit: z
    .array(
      z.object({
        slot: z.number().int().min(0).max(3),
        itemId: z.number().int().min(0).max(0xffffff),
      }),
    )
    .max(400)
    .optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ ok: false, error: "Missing key" }, { status: 400 });
  return NextResponse.json({ ok: true, block: await readIncBlock(key) });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = PutSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { key } = body.data;

  // Never create a block — the writer throws on a missing key, but failing here
  // gives a clearer message and avoids a pointless file read.
  const before = await readIncBlock(key);
  if (!before.exists) {
    return NextResponse.json(
      { ok: false, error: `character.inc has no block "${key}"` },
      { status: 404 },
    );
  }

  // Only the fields present in the body are written; `CharacterEdit` leaves
  // every unset field untouched in the file.
  const edit: CharacterEdit = {};
  const audit: Record<string, unknown> = { key };
  const idx = await getResourceIndex();

  if (body.data.tabs) {
    // A tab caption lives in `character.txt.txt`, which the CLIENT reads too, so
    // both halves must be written in the same edit: the `AddVendorSlot( n, IDS_* )`
    // line and the `IDS_* <tab> caption` row. A tab without a token gets a freshly
    // minted one, allocated against the real file so it can't collide.
    const needTokens = body.data.tabs.filter((t) => !t.token).length;
    const fresh = needTokens > 0 ? await allocTextTokens(RAW_DIR, needTokens) : [];
    let next = 0;

    const texts: Record<string, string> = {};
    edit.vendorTabs = body.data.tabs.map((t) => {
      const token = t.token ?? fresh[next++];
      if (!token) throw new Error("token allocation failed");
      texts[token] = t.label;
      return { slot: t.slot, label: token };
    });
    edit.texts = texts;
    audit.tabs = body.data.tabs.map((t) => ({ slot: t.slot, label: t.label }));
    audit.tokensMinted = fresh.length;
  }

  if (body.data.menus) {
    // Dedupe + sort so the written file is stable regardless of click order.
    const menus = [...new Set(body.data.menus)].sort((a, b) => a - b);

    // Every id must be a symbol the client's own enum declares. An unknown id
    // would be emitted as a bare number, which the client's parser rejects.
    const { mmiById } = await getIncSymbols();
    const unknown = menus.filter((id) => !mmiById.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Unknown MMI id(s): ${unknown.join(", ")}` },
        { status: 400 },
      );
    }
    edit.menus = menus;
    audit.menusBefore = before.menus;
    audit.menusAfter = menus;
  }

  if (body.data.rules) {
    // An IK3 symbol no item carries expands to an empty tab — a shop that looks
    // configured and sells nothing. Reject rather than write a dead rule.
    const emptyKinds = body.data.rules
      .filter((r) => !idx.items.byKind3.has(r.kind3))
      .map((r) => r.kind3);
    if (emptyKinds.length > 0) {
      return NextResponse.json(
        { ok: false, error: `No items carry kind: ${[...new Set(emptyKinds)].join(", ")}` },
        { status: 400 },
      );
    }
    const badRange = body.data.rules.find((r) => r.uniqueMin > r.uniqueMax);
    if (badRange) {
      return NextResponse.json(
        { ok: false, error: `${badRange.kind3}: min level exceeds max` },
        { status: 400 },
      );
    }
    edit.vendorItems = body.data.rules.map((r) => ({
      slot: r.slot,
      // The writer emits `itemKind3Symbol` when set; the numeric field is only a
      // fallback for a rule authored as a bare literal, which the UI never does.
      itemKind3: 0,
      itemKind3Symbol: r.kind3,
      itemJob: r.job,
      uniqueMin: r.uniqueMin,
      uniqueMax: r.uniqueMax,
      totalNum: r.totalNum,
    }));
    audit.rules = body.data.rules.length;
  }

  if (body.data.explicit) {
    // An id absent from `defineItem.h` is a null hole in the client's
    // `m_aPropItem[]` lookup → `SetTexture` null-deref crash on shop open.
    const undefinedIds = body.data.explicit
      .filter((e) => !idx.items.definedIds.has(e.itemId))
      .map((e) => e.itemId);
    if (undefinedIds.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Item id(s) not in defineItem.h: ${undefinedIds.join(", ")}` },
        { status: 400 },
      );
    }
    edit.vendorItemIds = body.data.explicit.map((e) => ({ slot: e.slot, itemId: e.itemId }));
    audit.explicit = body.data.explicit.length;
  }

  if (Object.keys(edit).length === 0) {
    return NextResponse.json({ ok: false, error: "Nothing to change" }, { status: 400 });
  }

  try {
    await writeCharacterEdit(RAW_DIR, key, edit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Write failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  invalidateResourceCache();

  const sharers = sharersForKey(key);
  await writeAudit(session, {
    action: "character_inc_edit",
    targetType: "character_inc_block",
    // The target is a string key, not a numeric row id.
    targetId: null,
    details: { ...audit, placements: sharers.length },
  });

  return NextResponse.json({ ok: true, key, placements: sharers.length });
}
