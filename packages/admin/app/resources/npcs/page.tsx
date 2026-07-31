import type * as React from "react";
import { loadNpcs, loadZoneRefs } from "@/lib/npcs";
import { moverNamesById } from "@/lib/resource-rows";
import { getResourceIndex } from "@/lib/resource-cache";
import { npcNameForKey } from "@flyff/resources";
import { Select } from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { FilterBar } from "@/components/filter-bar";
import { ResourceTable, type ResourceColumn } from "@/components/resource-table";
import { IdCell, NameWithSymbol, TagCell, PosCell, EditLink } from "@/components/resource-cells";
import { parsePage, parsePerPage, paginate } from "@/lib/paginate";
import { parseSort, sortRows, type QueryParams } from "@/lib/sort";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import type { NpcRow } from "@/lib/npcs";

export const dynamic = "force-dynamic";

interface SearchParams extends QueryParams {
  search?: string;
  zone?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}

/** A placement plus the two names resolved for display. */
interface Row extends NpcRow {
  /** character.inc `SetName` → `character.txt.txt`; the name a player sees. */
  npcName: string;
  /** propMover model name — the shared 3D model, NOT the NPC's own name. */
  moverName: string;
}

const SORT_KEYS = ["id", "zoneName", "npcName", "characterKey", "moverName", "x"] as const;

const COLUMNS: readonly ResourceColumn<Row>[] = [
  { key: "id", header: "ID", sortable: true, className: "w-16", cell: (r) => <IdCell value={r.id} /> },
  { key: "zoneName", header: "Zone", sortable: true, cell: (r) => <TagCell label={r.zoneName} /> },
  {
    key: "npcName",
    header: "NPC",
    sortable: true,
    // The character key is the NPC's real identity — vendor stock, dialog, and
    // outfit all hang off it, not off the placement. Shown under the name so a
    // GM can cross-reference character.inc without a second page.
    cell: (r) => <NameWithSymbol name={r.npcName} symbol={r.characterKey} />,
  },
  {
    key: "moverName",
    header: "Model",
    sortable: true,
    cell: (r) => <NameWithSymbol name={r.moverName} symbol={`#${String(r.moverId)}`} />,
  },
  {
    key: "x",
    header: "Position",
    sortable: true,
    cell: (r) => <PosCell x={r.x} y={r.y} z={r.z} />,
  },
  {
    key: "actions",
    header: "Actions",
    align: "right",
    cell: (r) => (
      <EditLink
        href={`/resources/npcs/${encodeURIComponent(r.ref)}/edit`}
        label={`NPC ${r.characterKey || String(r.id)} in ${r.zoneName}`}
      />
    ),
  },
];

export default async function NpcsPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const search = params.search ?? "";
  const zone = params.zone ?? "";
  const perPage = parsePerPage(params.perPage);

  const zones = loadZoneRefs();
  const models = moverNamesById();
  const { characterInc } = await getResourceIndex();

  // An NPC's display name comes from its character.inc block, never from the
  // propMover row: the mover name is the shared model ("Cute Girl") and is wrong
  // as an NPC label. Unresolved stays empty so the key shows instead.
  const npcs: Row[] = loadNpcs().map((n) => ({
    ...n,
    npcName: npcNameForKey(characterInc, n.characterKey) ?? "",
    moverName: models.get(n.moverId) ?? "",
  }));

  const needle = search.toLowerCase();
  const filtered = npcs.filter((n) => {
    if (zone && n.zoneId !== zone) return false;
    if (!needle) return true;
    return (
      n.npcName.toLowerCase().includes(needle) ||
      n.characterKey.toLowerCase().includes(needle) ||
      n.moverName.toLowerCase().includes(needle) ||
      String(n.moverId).includes(needle) ||
      String(n.id).includes(needle)
    );
  });

  filtered.sort((a, b) => a.zoneId.localeCompare(b.zoneId) || a.id - b.id);
  // Sorting runs before paging so a column sort spans the whole result set,
  // not just the rows already on the current page.
  const sort = parseSort(params.sort, params.dir, SORT_KEYS);
  const page = paginate(
    sortRows(filtered, sort, { npcName: (n) => n.npcName || n.characterKey }),
    parsePage(params.page),
    perPage,
  );
  const newZone = zone || zones[0]?.id;
  const active = Boolean(search || zone);

  return (
    <div className="space-y-6">
      <PageHeader
        title="NPCs"
        description={`${filtered.length.toLocaleString()} of ${npcs.length.toLocaleString()} placements across ${String(zones.length)} zones`}
        actions={
          newZone ? (
            <Link
              href={`/resources/npcs/${encodeURIComponent(`${newZone}:new`)}/edit`}
              className={buttonVariants({ size: "sm" })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add NPC
            </Link>
          ) : undefined
        }
      />

      <FilterBar perPage={perPage} sort={sort} active={active}>
        <SearchInput
          name="search"
          placeholder="Search by NPC name, character key, or ID..."
          defaultValue={search}
          className="w-full sm:w-80"
        />
        <Select name="zone" defaultValue={zone} className="w-44" aria-label="Filter by zone">
          <option value="">All zones</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      <ResourceTable
        columns={COLUMNS}
        page={page}
        rowKey={(r) => r.ref}
        sort={sort}
        params={params}
        unit="NPCs"
        empty={{ icon: Users, message: active ? "No NPCs match your filters" : "No NPC placements" }}
      />
    </div>
  );
}
