"use client";

import Image from "next/image";
import { getDstName } from "@/lib/game-constants";
import { cn, jobName } from "@/lib/utils";
import type { SkillSlotItem } from "./types";
import { TIER_LABELS, RESOURCE_TYPE_LABELS } from "./types";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", accent && "text-success")}>{value}</span>
    </div>
  );
}

const ELEMENT_NAMES: Record<number, string> = {
  1: "Fire",
  2: "Water",
  3: "Electric",
  4: "Wind",
  5: "Earth",
};

interface SkillTooltipProps {
  item: SkillSlotItem;
  rect: DOMRect;
}

/**
 * Hover/focus tooltip for a skill. Positioned fixed against the tile's
 * viewport rect, clamped to window edges.
 */
export function SkillTooltip({ item, rect }: SkillTooltipProps) {
  const TOOLTIP_W = 260;
  const GAP = 8;

  const leftSide = rect.right + GAP + TOOLTIP_W > window.innerWidth;
  const left = leftSide ? Math.max(GAP, rect.left - GAP - TOOLTIP_W) : rect.right + GAP;
  const above = rect.top > window.innerHeight / 2;
  const top = above
    ? Math.max(GAP, rect.top - 0)
    : rect.top;

  const lvl = item.currentLevel;
  const tierLabel = TIER_LABELS[item.tier] ?? "";
  const jobLabel = jobName(item.job);
  const costLabel = RESOURCE_TYPE_LABELS[item.resourceType];

  return (
    <div
      role="tooltip"
      className="fixed z-50 rounded-lg border border-border bg-popover/95 p-3 shadow-2xl backdrop-blur"
      style={{
        left,
        top,
        width: TOOLTIP_W,
        transform: above ? "translateY(-100%)" : undefined,
      }}
    >
      {/* Header: icon + name + tier/job */}
      <div className="flex items-start gap-2">
        <Image
          src={item.iconUrl}
          alt=""
          width={36}
          height={36}
          className="rounded border border-border bg-secondary/60"
          unoptimized
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold text-foreground">{item.name}</h4>
            <span className="text-[10px] text-muted-foreground">Lv.{item.level}/{item.maxLevel}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {[jobLabel, tierLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground italic">
          {item.description}
        </p>
      )}

      {/* Skill stats */}
      {lvl && (
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {lvl.abilityMin !== undefined && lvl.abilityMax !== undefined && (
            <Stat
              label="Damage"
              value={`${lvl.abilityMin} – ${lvl.abilityMax}`}
              accent
            />
          )}
          {item.element !== undefined && item.element > 0 && (
            <Stat label="Element" value={ELEMENT_NAMES[item.element] ?? `#${item.element}`} accent />
          )}
          {lvl.reqMp !== undefined && lvl.reqMp > 0 && (
            <Stat label="MP Cost" value={String(lvl.reqMp)} />
          )}
          {lvl.reqFp !== undefined && lvl.reqFp > 0 && (
            <Stat label="FP Cost" value={String(lvl.reqFp)} />
          )}
          {costLabel !== "None" && (
            <Stat label="Resource" value={costLabel} />
          )}
          {lvl.cooldown !== undefined && lvl.cooldown > 0 && (
            <Stat label="Cooldown" value={`${(lvl.cooldown / 1000).toFixed(1)}s`} />
          )}
          {lvl.castingTime !== undefined && lvl.castingTime > 0 && (
            <Stat label="Cast Time" value={`${(lvl.castingTime / 1000).toFixed(1)}s`} />
          )}
          {lvl.skillRange !== undefined && lvl.skillRange > 0 && (
            <Stat label="Range" value={String(lvl.skillRange)} />
          )}
          {lvl.skillTime !== undefined && lvl.skillTime > 0 && (
            <Stat label="Duration" value={`${(lvl.skillTime / 1000).toFixed(0)}s`} />
          )}
          {lvl.probability !== undefined && lvl.probability > 0 && (
            <Stat label="Chance" value={`${lvl.probability}%`} />
          )}
          {lvl.skillCount !== undefined && lvl.skillCount > 1 && (
            <Stat label="Hits" value={String(lvl.skillCount)} accent />
          )}
        </div>
      )}

      {/* Effects */}
      {lvl?.destParams && lvl.destParams.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {lvl.destParams.map((dst, i) => {
            const adj = lvl.adjParamVals?.[i] ?? 0;
            const dur = lvl.chgParamVals?.[i] ?? 0;
            return (
              <Stat
                key={`${dst}-${i}`}
                label={getDstName(dst)}
                value={`${adj > 0 ? "+" : ""}${adj}${dur > 0 ? ` (${dur} charges)` : ""}`}
                accent={adj > 0}
              />
            );
          })}
        </div>
      )}

      {/* Prerequisites + level req */}
      <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
        {item.reqLevel !== undefined && item.reqLevel > 0 && (
          <Stat label="Req. Level" value={String(item.reqLevel)} />
        )}
      </div>
    </div>
  );
}
