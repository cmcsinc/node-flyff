import { loadDialogues } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageSquareText } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function DialoguesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadDialogues();

  const rows: Array<{ prefix: string; states: number }> = [];
  data.forEach((file, i) => {
    if (typeof file !== "object" || file === null) return;
    const v = file as Record<string, unknown>;
    const prefix = String(v.prefix ?? "");
    if (!prefix) return; // skip files without a dialogue prefix
    const states = typeof v.states === "object" && v.states !== null ? Object.keys(v.states as object).length : 0;
    rows.push({ prefix: `${prefix}__${i}`, states });
  });

  const filtered = search
    ? rows.filter((r) => r.prefix.toLowerCase().includes(search.toLowerCase()))
    : rows;

  const MAX = 500;
  const capped = filtered.slice(0, MAX);

  return (
    <div className="space-y-6">
      <PageHeader title="Dialogues" description={`${filtered.length} dialogue files`} />

      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search by NPC / file..." defaultValue={search} className="w-full sm:w-72" />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>NPC / File</TableHead>
                  <TableHead className="text-right">States</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {capped.map((r) => (
                  <TableRow key={r.prefix}>
                    <TableCell className="font-mono text-xs">{r.prefix}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{r.states}</Badge></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={2}>
                    <div className="flex flex-col items-center gap-1">
                      <MessageSquareText className="h-5 w-5 opacity-40" />
                      {search ? "No dialogues match your search" : "No dialogue data"}
                    </div>
                  </EmptyRow>
                )}
                {filtered.length > MAX && (
                  <TableRow>
                    <TableCell colSpan={2} className="py-3 text-center text-xs text-muted-foreground">
                      Showing {MAX} of {filtered.length} dialogues — refine your search to see more
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
