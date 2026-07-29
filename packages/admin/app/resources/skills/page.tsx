import { loadSkills } from "@/lib/resources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { EmptyRow } from "@/components/empty-state";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = {
  search?: string;
  job?: string;
  tier?: string;
  maxReqLevel?: string;
  page?: string;
  perPage?: string;
}

export default async function SkillsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const search = params.search ?? "";
  const job = params.job ?? "";
  const tier = params.tier ?? "";
  const maxReqLevel = params.maxReqLevel ?? "";
  const perPage = parsePerPage(params.perPage);
  const data = loadSkills();

  const skills: Array<{ id: number; name: string; job: string; tier: number; reqLevel: number; maxLevel: number }> = [];
  for (const doc of data) {
    if (typeof doc !== "object" || doc === null) continue;
    const jobName = String((doc as Record<string, unknown>)._job ?? "unknown");
    const entries = (doc as Record<string, unknown>).skills;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = entry as Record<string, unknown>;
      const lvlArr = Array.isArray(v.levels) ? v.levels : [];
      skills.push({
        id: Number(v.id ?? 0),
        name: String(v.name ?? "?"),
        job: jobName,
        tier: Number(v.tier ?? 0),
        reqLevel: Number(v.reqLevel ?? 0),
        maxLevel: Number(v.maxLevel ?? lvlArr.length),
      });
    }
  }

  skills.sort((a, b) => a.id - b.id);

  const jobs = [...new Set(skills.map((s) => s.job))].sort();
  const tiers = [...new Set(skills.map((s) => s.tier))].sort((a, b) => a - b);
  const cap = Number(maxReqLevel);
  const needle = search.toLowerCase();

  const filtered = skills.filter((s) => {
    if (job && s.job !== job) return false;
    if (tier && s.tier !== Number(tier)) return false;
    if (maxReqLevel && Number.isFinite(cap) && s.reqLevel > cap) return false;
    if (needle && !s.name.toLowerCase().includes(needle) && !String(s.id).includes(needle)) return false;
    return true;
  });

  const page = paginate(filtered, parsePage(params.page), perPage);

  return (
    <div className="space-y-6">
      <PageHeader title="Skills" description={`${filtered.length} of ${skills.length} skills from ${data.length} job files`} />

      <FilterBar perPage={perPage} active={Boolean(search || job || tier || maxReqLevel)}>
        <SearchInput name="search" placeholder="Search by name or ID..." defaultValue={search} className="w-full sm:w-72" />
        <Select name="job" defaultValue={job} className="w-40" aria-label="Filter by job">
          <option value="">All jobs</option>
          {jobs.map((j) => (
            <option key={j} value={j}>{j}</option>
          ))}
        </Select>
        <Select name="tier" defaultValue={tier} className="w-28" aria-label="Filter by tier">
          <option value="">All tiers</option>
          {tiers.map((t) => (
            <option key={t} value={t}>Tier {t}</option>
          ))}
        </Select>
        <Input
          name="maxReqLevel"
          type="number"
          min={0}
          defaultValue={maxReqLevel}
          placeholder="Max req Lv"
          aria-label="Maximum required level"
          className="w-32"
        />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
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
                {page.rows.map((s) => (
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
                      {search || job || tier || maxReqLevel ? "No skills match your filters" : "No skill data"}
                    </div>
                  </EmptyRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...page} params={params} unit="skills" />
        </CardContent>
      </Card>
    </div>
  );
}
