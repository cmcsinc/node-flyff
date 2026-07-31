import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { FieldOptionsProvider } from "@/components/form/field-options";
import { addableCommands, loadQuestForEdit } from "@/lib/quest-editor";
import { characterKeyOptions, npcMoverOptions } from "@/lib/npc-options";
import { getAllItems } from "@/lib/item-catalog";
import { getAllSkills } from "@/lib/skill-catalog";
import { getOptions } from "@/lib/field-schema";
import { QuestPanel } from "./quest-panel";

/**
 * Quest edit page.
 *
 * Option lists are resolved here (server side) and injected through
 * `FieldOptionsProvider`, because they live behind the resource index — a client
 * component importing it would pull `node:fs` into the browser bundle.
 *
 * @module app/resources/quests/[id]/edit/page
 */

export const dynamic = "force-dynamic";

export default async function QuestEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id: rawId } = await params;
  const questId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(questId) || questId < 0) notFound();

  const view = await loadQuestForEdit(questId);
  if (!view) notFound();

  const [charKeys, movers, items, skills] = await Promise.all([
    characterKeyOptions(),
    npcMoverOptions(),
    getAllItems(),
    getAllSkills(),
  ]);

  // Every picker shows the friendly name AND the raw id, so a GM can cross-check
  // the C++ define while picking (rule 12).
  const options = {
    characterKey: charKeys,
    mover: movers,
    item: items
      .map((d) => ({ value: String(d.id), label: `${d.name} (${String(d.id)})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    skill: skills
      .map((s) => ({ value: String(s.id), label: `${s.name} (${String(s.id)})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    // `-1` is the file's own "any job" sentinel and has no JOB_NAMES entry.
    job: [{ value: "-1", label: "Any (-1)" }, ...(getOptions("job") ?? [])],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={view.title || view.symbol}
        description={`Quest #${String(view.id)} · ${view.symbol} · ${String(view.commands.length)} commands`}
        backHref="/resources/quests"
      />
      <FieldOptionsProvider options={options}>
        <QuestPanel view={view} addable={addableCommands()} />
      </FieldOptionsProvider>
    </div>
  );
}
