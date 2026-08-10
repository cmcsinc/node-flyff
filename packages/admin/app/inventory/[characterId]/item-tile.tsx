'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { SlotItem } from './types';

/**
 * Rarity → outer glow ring colour. Empty/common slots get the plain recessed look.
 */
const RARITY_GLOW: Record<string, string> = {
  common: '',
  uncommon: 'shadow-[0_0_6px_0_var(--color-success)]',
  rare: 'shadow-[0_0_6px_0_var(--color-primary)]',
  legendary: 'shadow-[0_0_7px_0_var(--color-gold)]',
  ancient: 'shadow-[0_0_7px_0_var(--color-destructive)]',
};

interface ItemTileProps {
  item?: SlotItem;
  slot: number;
  emptyLabel?: string;
  size?: number;
  onHover?: (item: SlotItem, rect: DOMRect) => void;
  onLeave?: () => void;
}

/**
 * One inventory slot, styled like the Flyff client: a recessed dark cell with a
 * beveled inset border (highlight top-left, shadow bottom-right). Occupied cells
 * show the item icon filling the well; empty cells keep the plain inset. Focusable
 * so the tooltip opens on keyboard focus.
 */
export function ItemTile({
  item,
  slot,
  emptyLabel,
  size = 42,
  onHover,
  onLeave,
}: ItemTileProps): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);

  function handleEnter(): void {
    if (!item || !onHover || !ref.current) return;
    onHover(item, ref.current.getBoundingClientRect());
  }

  if (!item) {
    return (
      <div
        className="flyff-slot"
        style={{ width: size, height: size }}
        title={emptyLabel ?? `Slot ${String(slot)}`}
        aria-label={emptyLabel ? `Empty ${emptyLabel}` : `Empty slot ${String(slot)}`}
      />
    );
  }

  const rarity = item.rarity ?? 'common';

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={0}
      aria-label={`${item.name}, slot ${String(slot)}${item.quantity > 1 ? `, x${String(item.quantity)}` : ''}`}
      onMouseEnter={handleEnter}
      onFocus={handleEnter}
      onMouseLeave={onLeave}
      onBlur={onLeave}
      className={cn('flyff-slot group relative', RARITY_GLOW[rarity])}
      style={{ width: size, height: size }}
    >
      <Image
        src={item.iconUrl}
        alt={item.name}
        width={size - 6}
        height={size - 6}
        className="pointer-events-none absolute inset-0 m-auto h-[calc(100%-6px)] w-[calc(100%-6px)] select-none object-contain"
        unoptimized
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = '/icons/_placeholder.svg';
        }}
      />

      {item.refine > 0 && (
        <span
          className={cn(
            'absolute -left-0.5 -top-0.5 rounded px-0.5 text-[9px] font-bold leading-none',
            item.refine >= 7 ? 'text-gold' : 'text-primary',
          )}
          style={{ textShadow: '0 0 3px #000, 1px 1px 0 #000' }}
        >
          +{item.refine}
        </span>
      )}

      {item.quantity > 1 && (
        <span
          className="absolute bottom-0 right-0.5 text-[10px] font-semibold leading-none text-white"
          style={{ textShadow: '0 0 3px #000, 1px 1px 0 #000' }}
        >
          {item.quantity}
        </span>
      )}

      {item.element > 0 && (
        <span
          className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-gold/40"
          aria-hidden
        />
      )}
    </button>
  );
}
