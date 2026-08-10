'use client';

import * as React from 'react';
import Image from 'next/image';
import { worldName } from '@/lib/utils';
import type { QuestGoal } from './types';

interface GoalHoverProps {
  /** Icon to preview on hover (item or portrait). */
  iconUrl?: string;
  /** Label repeated in the hover card header. */
  label: string;
  /** Map goal position, when known. */
  goal?: QuestGoal;
  /** Trigger content. */
  children: React.ReactNode;
}

/** Formatted "Flaris (7179, 3217)" coordinate line. */
function coordLine(goal: QuestGoal): string {
  const place = goal.zone
    ? goal.zone.charAt(0).toUpperCase() + goal.zone.slice(1)
    : goal.worldId !== undefined
      ? worldName(goal.worldId)
      : '';
  const coords = `${String(Math.round(goal.x))}, ${String(Math.round(goal.z))}`;
  return place ? `${place} — ${coords}` : coords;
}

/**
 * Wraps a requirement/reward row and shows a floating card on hover with the
 * item icon and the map coordinates of the goal, when the quest data carries
 * either. Positioned against the trigger's viewport rect and clamped to the
 * window edges (same approach as the skill tooltip).
 */
export function GoalHover({ iconUrl, label, goal, children }: GoalHoverProps): React.JSX.Element {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  const hasCard = iconUrl != null || goal != null;

  function open(): void {
    if (!hasCard || !ref.current) return;
    setRect(ref.current.getBoundingClientRect());
  }

  function close(): void {
    setRect(null);
  }

  const CARD_W = 200;
  const GAP = 8;
  let style: React.CSSProperties | undefined;
  if (rect) {
    const flipLeft = rect.right + GAP + CARD_W > window.innerWidth;
    const above = rect.top > window.innerHeight / 2;
    style = {
      left: flipLeft ? Math.max(GAP, rect.left - GAP - CARD_W) : rect.right + GAP,
      top: rect.top,
      width: CARD_W,
      transform: above ? 'translateY(-100%)' : undefined,
    };
  }

  return (
    <>
      <span
        ref={ref}
        tabIndex={hasCard ? 0 : -1}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className={
          hasCard
            ? 'cursor-help rounded underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            : undefined
        }
      >
        {children}
      </span>

      {rect && style && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 block rounded-lg border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur"
          style={style}
        >
          <span className="flex items-center gap-2">
            {iconUrl && (
              <Image
                src={iconUrl}
                alt=""
                width={40}
                height={40}
                unoptimized
                className="shrink-0 rounded border border-border bg-secondary/60"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
              {goal && (
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                  {coordLine(goal)}
                </span>
              )}
            </span>
          </span>
        </span>
      )}
    </>
  );
}
