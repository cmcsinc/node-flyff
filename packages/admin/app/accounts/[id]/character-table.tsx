"use client";

import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { jobName, worldName } from "@/lib/utils";

export interface CharacterRow {
  id: number;
  name: string;
  slot: number;
  class: number;
  level: number;
  worldId: string;
  x: number;
  z: number;
}

/**
 * Sortable character list for the account detail page.
 *
 * A client component on purpose: the column definitions contain render and
 * sort *functions*, which cannot cross the server/client boundary. Keeping
 * them in this module means the page only ships plain row data.
 */
export function CharacterTable({ rows }: { rows: readonly CharacterRow[] }): React.JSX.Element {
  return (
    <DataTable
      rows={rows}
      rowKey={(c) => c.id}
      initialSort={{ key: "slot" }}
      empty="No characters"
      columns={[
        { key: "slot", header: "Slot", align: "right" },
        {
          key: "name",
          header: "Name",
          cell: (c) => (
            <Link href={`/characters/${String(c.id)}`} className="font-medium text-primary hover:underline">
              {c.name}
            </Link>
          ),
        },
        { key: "class", header: "Class", value: (c) => jobName(c.class), cell: (c) => jobName(c.class) },
        { key: "level", header: "Level", align: "right" },
        {
          key: "worldId",
          header: "World",
          value: (c) => worldName(c.worldId),
          cell: (c) => worldName(c.worldId),
        },
        {
          key: "x",
          header: "Position",
          className: "text-xs text-muted-foreground",
          cell: (c) => `${c.x.toFixed(1)}, ${c.z.toFixed(1)}`,
        },
      ]}
    />
  );
}
