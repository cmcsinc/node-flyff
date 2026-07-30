import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NpcEditor } from "./npc-editor";
import { blankNpc, findNpc, loadNpcs, nextNpcId, parseNpcRef, loadZoneRefs } from "@/lib/npcs";

export const dynamic = "force-dynamic";

export default async function NpcEditPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const parsed = parseNpcRef(ref);
  if (!parsed) notFound();

  const zone = loadZoneRefs().find((z) => z.id === parsed.zoneId);
  if (!zone) notFound();

  // `:new` → a blank entry pre-filled with the id the write will actually use.
  if (parsed.npcId === null) {
    const used = loadNpcs().filter((n) => n.zoneId === parsed.zoneId).map((n) => n.id);
    const entry = { ...blankNpc(), id: nextNpcId(used) };
    return (
      <div className="space-y-6">
        <PageHeader title="New NPC" description={`${zone.name} · next free id #${entry.id}`} backHref="/resources/npcs" />
        <NpcEditor ref_={ref} entry={entry} isNew />
      </div>
    );
  }

  const found = findNpc(parsed.zoneId, parsed.npcId);
  if (!found) notFound();

  const key = String(found.npc.character_key ?? "") || `#${parsed.npcId}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={key}
        description={`${zone.name} · NPC #${parsed.npcId} · ${found.file.split(/[/\\]/).pop()}`}
        backHref="/resources/npcs"
      />
      <NpcEditor ref_={ref} entry={found.npc} />
    </div>
  );
}
