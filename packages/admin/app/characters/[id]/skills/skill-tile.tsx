"use client";

import { useRef } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { SkillSlotItem } from "./types";

/** Tier → border color (matches Flyff's skill-window rarity rings). */
const TIER_RING: Record<number, string> = {
  0: "border-border",        // Base
  1: "border-success/60",    // Expert
  2: "border-primary/60",    // Pro
  4: "border-muted-foreground/40", // Common
  5: "border-gold/70",       // Master
  6: "border-destructive/60", // Hero
};

interface SkillTileProps {
  item?: SkillSlotItem;
  size?: number;
  onHover?: (item: SkillSlotItem, rect: DOMRect) => void;
  onLeave?: () => void;
}

/**
 * One skill cell. Renders the skill icon with level badge, tier-colored border.
 * Mirrors {@link ../inventory-explorer.tsx#ItemTile} pattern.
 */
export function SkillTile({ item, size = 56, onHover, onLeave }: SkillTileProps) {
  const ref = useRef<HTMLButtonElement>(null);

  function handleEnter() {
    if (!item || !onHover || !ref.current) return;
    onHover(item, ref.current.getBoundingClientRect());
  }

  if (!item) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border/60 bg-secondary/30 text-[9px] text-muted-foreground/50 text-center leading-tight px-1 select-none"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={0}
      aria-label={`${item.name} Lv.${item.level}`}
      onMouseEnter={handleEnter}
      onFocus={handleEnter}
      onMouseLeave={onLeave}
      onBlur={onLeave}
      className={cn(
        "group relative rounded-md border bg-secondary/80 transition-colors",
        "hover:border-primary hover:shadow-[0_0_8px_-1px_var(--color-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        TIER_RING[item.tier] ?? "border-border",
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={item.iconUrl}
        alt={item.name}
        width={size - 8}
        height={size - 8}
        className="pointer-events-none m-auto select-none"
        unoptimized
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = "/icons/_placeholder.svg";
        }}
      />

      {/* Level badge (bottom-right) */}
      <span className="absolute bottom-0 right-0.5 rounded bg-background/80 px-1 text-[10px] font-semibold leading-tight text-foreground">
        Lv.{item.level}
      </span>

      {/* Tier glow for Master/Hero */}
      {(item.tier === 5 || item.tier === 6) && (
        <span className="absolute inset-0 rounded-md ring-1 ring-inset ring-gold/30" aria-hidden />
      )}
    </button>
  );
}
