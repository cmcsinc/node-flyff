import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { DialogPanel } from '@/components/dialog/dialog-panel';
import { readDialogForPrefix } from '@/lib/dialog-inc';
import { getResourceIndex } from '@/lib/resource-cache';
import { npcNameForKey } from '@flyff/resources';

export const dynamic = 'force-dynamic';

/**
 * Dialogue editor, entered from the dialogues browser.
 *
 * Same panel the NPC editor mounts — a dialogue is one script group either way.
 * The difference is the entry point: this page has a prefix (the file stem), the
 * NPC page has a `character_key` it must map through `_npc-map.yml` first.
 */
export default async function DialogueEditPage({
  params,
}: {
  params: Promise<{ prefix: string }>;
}): Promise<React.JSX.Element> {
  const { prefix: raw } = await params;
  const prefix = decodeURIComponent(raw);

  const [view, idx] = await Promise.all([readDialogForPrefix(prefix), getResourceIndex()]);
  if (!view.exists) notFound();

  // Dialogue files are keyed by the lowercased character.inc block stem, so the
  // display name follows the same chain the browser page uses.
  const npcName = npcNameForKey(idx.characterInc, prefix) ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        title={npcName || prefix}
        description={`${prefix}.yml · ${String(view.states.length)} state${view.states.length === 1 ? '' : 's'}`}
        backHref="/resources/dialogues"
      />
      <DialogPanel view={view} />
    </div>
  );
}
