/**
 * Zone metadata write.
 *
 * Only the zone-level keys (identity, bounds, revival, portals, regions,
 * weather). Placements are not editable here — `/api/npcs` and `/api/spawns` own
 * those, one entry at a time.
 *
 * SECURITY: `auth()` first, then the canonical `ZoneDefinitionSchema` inside
 * `saveZoneMeta`, applied to the submitted keys merged over the on-disk document
 * so the whole zone is validated rather than the fragment.
 *
 * @module app/api/zones/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { findZone, saveZoneMeta, zoneMeta } from '@/lib/zones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PutSchema = z.object({
  zoneId: z.string().min(1).max(64),
  meta: z.record(z.unknown()),
});

export function GET(req: NextRequest): Response {
  const zoneId = req.nextUrl.searchParams.get('zoneId');
  if (!zoneId) return NextResponse.json({ ok: false, error: 'Missing zoneId' }, { status: 400 });

  const zone = findZone(zoneId);
  if (!zone) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, file: zone.file, meta: zoneMeta(zone.doc) });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const body = PutSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }

  try {
    saveZoneMeta(body.data.zoneId, body.data.meta);
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : e instanceof Error
          ? e.message
          : 'Save failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  await writeAudit(session, {
    action: 'zone_update',
    targetType: 'zone',
    // The target is a slug, not a numeric row id.
    targetId: null,
    details: { zoneId: body.data.zoneId, keys: Object.keys(body.data.meta) },
  });

  return NextResponse.json({ ok: true });
}
