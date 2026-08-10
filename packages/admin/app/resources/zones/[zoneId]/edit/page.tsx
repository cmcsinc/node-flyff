import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { ZoneEditor } from './zone-editor';
import { findZone, zoneMeta } from '@/lib/zones';
import { zoneSeq } from '@/lib/zone-seq';
import { Bug, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Zone metadata editor.
 *
 * The placement collections are not in the form — 948 spawns and 347 NPCs would
 * make one save an unreviewable 11 000-line diff. They get counted here and
 * linked to their own filtered browser pages instead.
 */
export default async function ZoneEditPage({
  params,
}: {
  params: Promise<{ zoneId: string }>;
}): Promise<React.JSX.Element> {
  const { zoneId: raw } = await params;
  const zoneId = decodeURIComponent(raw);

  const zone = findZone(zoneId);
  if (!zone) notFound();

  const spawns = zoneSeq(zone.doc, 'spawns').length;
  const npcs = zoneSeq(zone.doc, 'npcs').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={zone.zoneName}
        description={`${zoneId} · ${zone.file.split(/[/\\]/).pop() ?? ''}`}
        backHref="/resources/zones"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/resources/spawns?zone=${encodeURIComponent(zoneId)}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Bug className="h-3.5 w-3.5" aria-hidden="true" />
              {spawns.toLocaleString()} spawns
            </Link>
            <Link
              href={`/resources/npcs?zone=${encodeURIComponent(zoneId)}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {npcs.toLocaleString()} NPCs
            </Link>
          </div>
        }
      />
      <ZoneEditor zoneId={zoneId} meta={zoneMeta(zone.doc)} />
    </div>
  );
}
