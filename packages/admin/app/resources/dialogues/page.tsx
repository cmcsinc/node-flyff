import { loadDialogues } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, SortableHead } from "@/components/ui/table";
import { parseSort, sortRows } from "@/lib/sort";
import { MessageSquareText } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  minStates?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["prefix", "states"] as const;

export default async function DialoguesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const minStates = params.minStates ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadDialogues();

  const rows: Array<{ key: string; prefix: string; states: number }> = [];
  data.forEach((file, i) => {
    if (typeof file !== "object" || file === null) return;
    const v = file as Record<string, unknown>;
    const prefix = String(v.prefix ?? "");
    if (!prefix) return; // skip index/string-table files without a dialogue prefix
    const states = typeof v.states === "object" && v.states !== null ? Object.keys(v.states as object).length : 0;
    rows.push({ key: `${prefix}__${i}`, prefix, states });
  });

  rows.sort((a, b) => a.prefix.localeCompare(b.prefix));

  const minS = Number(minStates);
  const needle = search.toLowerCase();

  const filtered = rows.filter((r) => {
    if (minStates && Number.isFinite(minS) && r.states < minS) return false;
    if (needle && !r.prefix.toLowerCase().includes(needle)) return false;
    return true;
  });

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Dialogues" description={`${filtered.length} of ${rows.length} dialogue files`} />

      <FilterBar perPage={perPage} sort={sort} active={Boolean(search || minStates)}>
        <SearchInput name="search" placeholder="Search by NPC / file..." defaultValue={search} className="w-full sm:w-72" />
        <Input name="minStates" type="number" min={0} defaultValue={minStates} placeholder="Min states" aria-label="Minimum state count" className="w-32" />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)]">
                <TableRow className="hover:bg-transparent">
                  <SortableHead sortKey="prefix" sort={sort} params={params}>NPC / File</SortableHead>
                  <SortableHead sortKey="states" sort={sort} params={params} align="right">States</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{r.prefix}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{r.states}</Badge></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={2}>
                    <div className="flex flex-col items-center gap-1">
                      <MessageSquareText className="h-5 w-5 opacity-40" />
                      {search || minStates ? "No dialogues match your filters" : "No dialogue data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="dialogues" />
        </CardContent>
      </Card>
    </div>
  );
}
