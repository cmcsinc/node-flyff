"use client";

import * as React from "react";
import { SkillTile } from "./skill-tile";
import { SkillTooltip } from "./skill-tooltip";
import type { SkillSlotItem } from "./types";
import { jobName } from "@/lib/utils";

interface SkillExplorerProps {
  items: SkillSlotItem[];
}

/** Hovered tile + its viewport rect, or null when the tooltip is closed. */
interface ActiveTooltip {
  item: SkillSlotItem;
  rect: DOMRect;
}

/** Group skills by job, then sort by tier within each group. */
function groupByJob(items: SkillSlotItem[]): Array<{ job: number; label: string; skills: SkillSlotItem[] }> {
  const map = new Map<number, SkillSlotItem[]>();
  for (const item of items) {
    const key = item.job;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const groups = [...map.entries()].map(([job, skills]) => {
    // Sort: tier ascending, then slot ascending.
    skills.sort((a, b) => a.tier - b.tier || a.slot - b.slot);
    return { job, label: jobName(job), skills };
  });
  // Sort groups by job id (Vagrant first, then order of discovery).
  groups.sort((a, b) => a.job - b.job);
  return groups;
}

/**
 * Interactive skill grid grouped by job. Owns the shared hover/focus tooltip.
 * Renders like the in-game skill window: class tabs with skill tiles.
 */
export function SkillExplorer({ items }: SkillExplorerProps) {
  const [active, setActive] = React.useState<ActiveTooltip | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleOpen = React.useCallback((item: SkillSlotItem, rect: DOMRect) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setActive({ item, rect }), 90);
  }, []);

  const close = React.useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setActive(null);
  }, []);

  React.useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No skills learned</p>
    );
  }

  const groups = groupByJob(items);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.job}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {group.skills.map((item) => (
              <SkillTile
                key={item.id}
                item={item}
                onHover={scheduleOpen}
                onLeave={close}
              />
            ))}
          </div>
        </div>
      ))}

      {active && <SkillTooltip item={active.item} rect={active.rect} />}
    </div>
  );
}
