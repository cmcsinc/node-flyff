import { notFound } from "next/navigation";
import { ResourceFormEditor } from "@/components/resource-form-editor";
import { PageHeader } from "@/components/page-header";
import { loadEntryById } from "@/lib/resources";

export const dynamic = "force-dynamic";

function getEntryDisplayName(type: string, entry: Record<string, unknown>): string {
  const name = entry.name ?? entry.symbol ?? entry.prefix ?? entry.key ?? entry.nameId;
  if (name && typeof name === "string" && name.length > 0) return name;
  return `#${entry.id ?? entry._id_numeric ?? "?"}`;
}

export default async function ResourceEditPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  let result: { file: string; entry: Record<string, unknown> } | null = null;
  try {
    result = loadEntryById(type, id);
  } catch {
    notFound();
  }
  if (!result) notFound();
  const displayName = getEntryDisplayName(type, result.entry);

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayName}
        description={`${type} #${id} · ${result.file.split(/[/\\]/).pop()}`}
        backHref={`/resources/${type}`}
      />
      <ResourceFormEditor type={type} id={id} entry={result.entry} />
    </div>
  );
}
