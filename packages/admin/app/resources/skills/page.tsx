import { loadSkills } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { EmptyRow } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
}

export default async function SkillsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const data = loadSkills();

  const skills: Array<{ id: number; name: string; job: string; tier: number; reqLevel: number; maxLevel: number; levels: number }> = [];
  for (const file of data) {
    if (typeof file !== "object" || file === null) continue;
    const job = String((file as Record<string, unknown>)._job ?? "unknown");
    const entries = (file as Record<string, unknown>).skills;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const lvlArr = Array.isArray(v.levels) ? v.levels : [];
      skills.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        job,
        tier: Number(v.tier ?? 0),
        reqLevel: Number(v.reqLevel ?? 0),
        maxLevel: Number(v.maxLevel ?? lvlArr.length),
        levels: lvlArr.length,
      });
    }
  }

  skills.sort((a, b) => a.id - b.id);

  const filtered = search
    ? skills.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || String(s.id).includes(search) || s.job.toLowerCase().includes(search.toLowerCase()))
    : skills;

  const MAX = 500;
  const capped = filtered.slice(0, MAX);

  return (
    <div className="space-y-6">
      <PageHeader title="Skills" description={`${filtered.length} of ${skills.length} skills from ${data.length} job files`} />

      <form className="flex flex-wrap gap-2" method="GET">
        <SearchInput name="search" placeholder="Search by name, job, or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Button type="submit">Search</Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-20">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead className="text-center">Tier</TableHead>
                  <TableHead className="text-right">Req Lv</TableHead>
                  <TableHead className="text-right">Max Lv</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {capped.map((s) => (
                  <TableRow key={`${s.job}-${s.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.id}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.job}</TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{s.tier}</Badge></TableCell>
                    <TableCell className="text-right">{s.reqLevel > 0 ? s.reqLevel : "—"}</TableCell>
                    <TableCell className="text-right">{s.maxLevel > 0 ? s.maxLevel : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/resources/skills/${s.id}/edit`} className="text-xs text-primary hover:underline">Edit</Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7}>
                    <div className="flex flex-col items-center gap-1">
                      <Sparkles className="h-5 w-5 opacity-40" />
                      {search ? "No skills match your search" : "No skill data"}
                    </div>
                  </EmptyRow>
                )}
                {filtered.length > MAX && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-3 text-center text-xs text-muted-foreground">
                      Showing {MAX} of {filtered.length} skills — refine your search to see more
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
