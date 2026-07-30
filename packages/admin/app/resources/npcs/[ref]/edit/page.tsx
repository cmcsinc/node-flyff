import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { NpcEditor } from "./npc-editor";
import { CapabilityPanel } from "./capability-panel";
import { DialogPanel } from "./dialog-panel";
import { blankNpc, findNpc, loadNpcs, nextNpcId, parseNpcRef, loadZoneRefs } from "@/lib/npcs";
import { kind3Options, mmiOptions, readIncBlock } from "@/lib/character-inc";
import { readDialogForKey } from "@/lib/dialog-inc";
import { getAllItems } from "@/lib/item-catalog";
import { getOptions } from "@/lib/field-schema";

export const dynamic = "force-dynamic";

export default async function NpcEditPage({ params }: { params: Promise<{ ref: string }> }): Promise<React.JSX.Element> {
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
        <PageHeader title="New NPC" description={`${zone.name} · next free id #${String(entry.id)}`} backHref="/resources/npcs" />
        <NpcEditor ref_={ref} entry={entry} isNew />
      </div>
    );
  }

  const found = findNpc(parsed.zoneId, parsed.npcId);
  if (!found) notFound();

  // Capability lives in `character.inc`, keyed by `character_key` — not in the
  // zone file. An empty key still renders the panel, which explains why.
  const charKey = typeof found.npc.character_key === "string" ? found.npc.character_key : "";
  const key = charKey || `#${String(parsed.npcId)}`;

  const [block, options, kind3Opts, itemDefs, dialog] = await Promise.all([
    readIncBlock(charKey),
    mmiOptions(),
    kind3Options(),
    getAllItems(),
    readDialogForKey(charKey),
  ]);

  // Explicit-item picker. Sorted by name so it is searchable, and labelled with
  // the raw propItem id so a GM can cross-reference `defineItem.h` (rule 12).
  const itemOptions = itemDefs
    .map((d) => ({ value: String(d.id), label: `${d.name} (${String(d.id)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // `-1` is the file's own "any job" sentinel and has no JOB_NAMES entry.
  const jobOptions = [{ value: "-1", label: "Any (-1)" }, ...(getOptions("job") ?? [])];

  return (
    <div className="space-y-6">
      <PageHeader
        title={key}
        description={`${zone.name} · NPC #${String(parsed.npcId)} · ${found.file.split(/[/\\]/).pop() ?? ""}`}
        backHref="/resources/npcs"
      />
      <NpcEditor ref_={ref} entry={found.npc} />
      <CapabilityPanel
        block={block}
        options={options}
        kind3Options={kind3Opts}
        jobOptions={jobOptions}
        itemOptions={itemOptions}
      />
      <DialogPanel view={dialog} />
    </div>
  );
}
