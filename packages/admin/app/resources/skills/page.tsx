import type * as React from "react";
import { skillRows } from "@/lib/resource-rows";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { ResourceTable, type ResourceColumn } from "@/components/resource-table";
import { IdCell, NameCell, TagCell, NumCell, CountCell, EditLink } from "@/components/resource-cells";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { parseSort, sortRows, type QueryParams } from "@/lib/sort";
import { Sparkles } from "lucide-react";
import type { SkillRow } from "@/lib/resource-rows";

export const dynamic = "force-dynamic";

interface SearchParams extends QueryParams {
  search?: string;
  job?: string;
  tier?: string;
  maxReqLevel?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

const SORT_KEYS = ["id", "name", "job", "tier", "reqLevel", "maxLevel"] as const;

/** Job names come from the file's `_job` marker, which is already lowercase. */
function jobLabel(job: string): string {
  return job ? job.charAt(0).toUpperCase() + job.slice(1) : "";
}

const COLUMNS: readonly ResourceColumn<SkillRow>[] = [
  { key: "id", header: "ID", sortable: true, className: "w-20", cell: (r) => <IdCell value={r.id} /> },
  { key: "name", header: "Name", sortable: true, cell: (r) => <NameCell value={r.name} /> },
  { key: "job", header: "Job", sortable: true, cell: (r) => <TagCell label={jobLabel(r.job)} /> },
  { key: "tier", header: "Tier", sortable: true, align: "center", cell: (r) => <CountCell value={r.tier} /> },
  {
    key: "reqLevel",
    header: "Req Lv",
    sortable: true,
    align: "right",
    cell: (r) => <NumCell value={r.reqLevel} />,
  },
  {
    key: "maxLevel",
    header: "Max Lv",
    sortable: true,
    align: "right",
    cell: (r) => <NumCell value={r.maxLevel} />,
  },
  {
    key: "actions",
    header: "Actions",
    align: "right",
    cell: (r) => <EditLink href={`/resources/skills/${String(r.id)}/edit`} label={`skill ${String(r.id)}`} />,
  },
];

export default async function SkillsPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? "";
  const job = params.job ?? "";
  const tier = params.tier ?? "";
  const maxReqLevel = params.maxReqLevel ?? "";
  const perPage = parsePerPage(params.perPage);

  const skills = skillRows();
  const jobs = [...new Set(skills.map((s) => s.job).filter(Boolean))].sort();
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

  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(sortRows(filtered, sort), parsePage(params.page), perPage);
  const active = Boolean(search || job || tier || maxReqLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description={`${filtered.length.toLocaleString()} of ${skills.length.toLocaleString()} skills across ${String(jobs.length)} jobs`}
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by name or ID..."
          defaultValue={search}
          className="w-full sm:w-72"
        />
        <Select name="job" defaultValue={job} className="w-40" aria-label="Filter by job">
          <option value="">All jobs</option>
          {jobs.map((j) => (
            <option key={j} value={j}>
              {jobLabel(j)}
            </option>
          ))}
        </Select>
        <Select name="tier" defaultValue={tier} className="w-28" aria-label="Filter by tier">
          <option value="">All tiers</option>
          {tiers.map((t) => (
            <option key={t} value={t}>
              Tier {t}
            </option>
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

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => `${r.job}-${String(r.id)}`}
        sort={sort}
        params={params}
        unit="skills"
        empty={{ icon: Sparkles, message: active ? "No skills match your filters" : "No skill data" }}
      />
    </div>
  );
}
