import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { SpawnEditor } from './spawn-editor';
import { blankSpawn, findSpawn, loadSpawns, nextSpawnId } from '@/lib/spawns';
import { parseZoneRef, zoneDocs } from '@/lib/zone-seq';
import { spawnMoverOptions } from '@/lib/npc-options';
import { getResourceIndex } from '@/lib/resource-cache';

export const dynamic = 'force-dynamic';

export default async function SpawnEditPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<React.JSX.Element> {
  const { ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const parsed = parseZoneRef(ref);
  if (!parsed) notFound();

  const zone = zoneDocs().find((z) => z.zoneId === parsed.zoneId);
  if (!zone) notFound();

  const [movers, idx] = await Promise.all([spawnMoverOptions(), getResourceIndex()]);

  // `:new` → a blank entry pre-filled with the id the write will actually use.
  if (parsed.entryId === null) {
    const used = loadSpawns(idx.movers.movers)
      .filter((s) => s.zoneId === parsed.zoneId)
      .map((s) => s.id);
    const entry = { ...blankSpawn(), id: nextSpawnId(used) };
    return (
      <div className="space-y-6">
        <PageHeader
          title="New spawn point"
          description={`${zone.zoneName} · next free id #${String(entry.id)}`}
          backHref="/resources/spawns"
        />
        <SpawnEditor ref_={ref} entry={entry} moverOptions={movers} isNew />
      </div>
    );
  }

  const found = findSpawn(parsed.zoneId, parsed.entryId);
  if (!found) notFound();

  const moverId = Number(found.spawn.mover_id ?? 0);
  const moverName = idx.movers.movers.get(moverId)?.name ?? `#${String(moverId)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moverName}
        description={`${zone.zoneName} · spawn #${String(parsed.entryId)} · ${found.file.split(/[/\\]/).pop() ?? ''}`}
        backHref="/resources/spawns"
      />
      <SpawnEditor ref_={ref} entry={found.spawn} moverOptions={movers} />
    </div>
  );
}
