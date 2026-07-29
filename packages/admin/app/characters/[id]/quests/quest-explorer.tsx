"use client";

import * as React from "react";
import { QuestCard } from "./quest-card";
import type { QuestSlotItem } from "./types";

interface QuestExplorerProps {
  activeItems: QuestSlotItem[];
  completedItems: QuestSlotItem[];
}

type TabKey = "active" | "completed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
];

/**
 * Interactive quest explorer with tab switching (active/completed) and
 * expandable quest cards. Mirrors the SkillExplorer pattern but uses
 * a card layout since quests don't have icons/tiles.
 */
export function QuestExplorer({ activeItems, completedItems }: QuestExplorerProps) {
  const [tab, setTab] = React.useState<TabKey>("active");
  const [expanded, setExpanded] = React.useState<Set<number>>(() => new Set());
  const [filter, setFilter] = React.useState("");

  const items = tab === "active" ? activeItems : completedItems;

  const filtered = React.useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.symbol.toLowerCase().includes(q) ||
        String(item.questId).includes(q),
    );
  }, [items, filter]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isEmpty = activeItems.length === 0 && completedItems.length === 0;

  if (isEmpty) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No quests found</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab bar + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border">
          {TABS.map((t) => {
            const count = t.key === "active" ? activeItems.length : completedItems.length;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                } ${t.key === "active" ? "rounded-l-[5px]" : "rounded-r-[5px]"}`}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>
        <input
          type="text"
          placeholder="Filter quests..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Quest list */}
      <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
        {filtered.map((item) => (
          <QuestCard
            key={item.id}
            item={item}
            isExpanded={expanded.has(item.id)}
            onToggle={() => toggle(item.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filter ? "No quests match your filter" : `No ${tab} quests`}
          </p>
        )}
      </div>
    </div>
  );
}
