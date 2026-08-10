import { notFound } from 'next/navigation';
import { ResourceFormEditor } from '@/components/resource-form-editor';
import { PageHeader } from '@/components/page-header';
import { loadEntryById } from '@/lib/resources';
import { itemOptions } from '@/lib/item-options';

export const dynamic = 'force-dynamic';

function getEntryDisplayName(type: string, entry: Record<string, unknown>): string {
  const name = entry.name ?? entry.symbol ?? entry.prefix ?? entry.key ?? entry.nameId;
  if (typeof name === 'string' && name.length > 0) return name;
  const id = entry.id ?? entry._id_numeric ?? '?';
  return `#${typeof id === 'string' || typeof id === 'number' ? String(id) : '?'}`;
}

export default async function ResourceEditPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { type, id } = await params;
  let result: { file: string; entry: Record<string, unknown> } | null = null;
  try {
    result = loadEntryById(type, id);
  } catch {
    notFound();
  }
  if (!result) notFound();
  const displayName = getEntryDisplayName(type, result.entry);
  // `itemId` fields (set pieces, drop entries) pick from item names, not ids.
  const items = await itemOptions();

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayName}
        description={`${type} #${id} · ${result.file.split(/[/\\]/).pop() ?? result.file}`}
        backHref={`/resources/${type}`}
      />
      <ResourceFormEditor type={type} id={id} entry={result.entry} fieldOptions={{ item: items }} />
    </div>
  );
}
