"use client";

import Image from "next/image";
import { getDstName } from "@/lib/game-constants";
import { cn } from "@/lib/utils";
import type { SlotItem } from "./types";

const ELEMENT_NAMES: Record<number, string> = {
  1: "Fire",
  2: "Water",
  3: "Electric",
  4: "Wind",
  5: "Earth",
};

const GENDER_LABEL: Record<string, string> = {
  male: "Male only",
  female: "Female only",
};

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", accent && "text-success")}>{value}</span>
    </div>
  );
}

interface ItemTooltipProps {
  item: SlotItem;
  /** Viewport rect of the hovered tile, for positioning. */
  rect: DOMRect;
}

/**
 * Hover/focus tooltip showing the full item stat sheet. Rendered once by the
 * owning grid/paper-doll, positioned `fixed` against the tile's viewport rect
 * and clamped so it never overflows the window.
 */
export function ItemTooltip({ item, rect }: ItemTooltipProps) {
  const TOOLTIP_W = 240;
  const GAP = 8;

  // Prefer placing to the right of the tile; flip left if it would overflow.
  const leftSide = rect.right + GAP + TOOLTIP_W > window.innerWidth;
  const left = leftSide ? Math.max(GAP, rect.left - GAP - TOOLTIP_W) : rect.right + GAP;
  // Prefer above; flip below if it would overflow the top.
  const above = rect.top > window.innerHeight / 2;
  const top = above
    ? Math.max(GAP, rect.top - 0) // anchored to tile top, grows upward via bottom anchor
    : rect.top;

  const hasStats =
    item.attackMin !== undefined ||
    item.defense !== undefined ||
    (item.effects && item.effects.length > 0) ||
    item.magicDefense !== undefined ||
    item.hitRate !== undefined ||
    item.parry !== undefined;

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
      {/* Header */}
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
            {item.refine > 0 && (
              <span className="text-xs font-bold text-gold">+{item.refine}</span>
            )}
            <h4 className="truncate text-sm font-semibold text-foreground">{item.name}</h4>
          </div>
          <p className="text-[11px] text-muted-foreground">{item.category}</p>
        </div>
      </div>

      {/* Element */}
      {item.element > 0 && (
        <div className="mt-2">
          <Stat
            label="Element"
            value={`${ELEMENT_NAMES[item.element] ?? `#${item.element}`} +${item.elementLevel}`}
            accent
          />
        </div>
      )}

      {/* Stats */}
      {hasStats && (
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {item.attackMin !== undefined && (
            <Stat
              label="Attack"
              value={
                item.attackMax !== undefined && item.attackMax > item.attackMin
                  ? `${item.attackMin} – ${item.attackMax}`
                  : String(item.attackMin)
              }
              accent
            />
          )}
          {item.defense !== undefined && (
            <Stat
              label="Defense"
              value={
                item.defenseMax !== undefined && item.defenseMax > item.defense
                  ? `${item.defense} – ${item.defenseMax}`
                  : String(item.defense)
              }
              accent
            />
          )}
          {item.magicDefense !== undefined && item.magicDefense > 0 && (
            <Stat label="Magic Def" value={String(item.magicDefense)} />
          )}
          {item.hitRate !== undefined && item.hitRate !== 0 && (
            <Stat label="Hit Rate" value={`${item.hitRate > 0 ? "+" : ""}${item.hitRate}`} />
          )}
          {item.parry !== undefined && item.parry !== 0 && (
            <Stat label="Parry" value={`${item.parry > 0 ? "+" : ""}${item.parry}`} />
          )}
          {item.effects?.map((e, i) => (
            <Stat
              key={`${e.dst}-${i}`}
              label={getDstName(e.dst)}
              value={`${e.adj > 0 ? "+" : ""}${e.adj}`}
              accent={e.adj > 0}
            />
          ))}
        </div>
      )}

      {/* Requirements + durability */}
      <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
        {item.levelReq !== undefined && item.levelReq > 1 && (
          <Stat label="Req. Level" value={String(item.levelReq)} />
        )}
        {item.jobReq && item.jobReq.length > 0 && (
          <Stat label="Class" value={item.jobReq.map(capitalize).join(", ")} />
        )}
        {item.genderReq && GENDER_LABEL[item.genderReq] && (
          <Stat label="Gender" value={GENDER_LABEL[item.genderReq]} />
        )}
        <Stat
          label="Durability"
          value={item.durability === -1 ? "∞" : String(item.durability)}
        />
        {item.quantity > 1 && <Stat label="Quantity" value={String(item.quantity)} />}
        {item.price !== undefined && item.price > 0 && (
          <Stat label="Value" value={`${item.price.toLocaleString()} penya`} />
        )}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
