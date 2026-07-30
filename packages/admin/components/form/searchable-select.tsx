"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EnumOption } from "@/lib/field-schema";

/**
 * Searchable single-select for long enum lists (DST has ~180 entries).
 *
 * Renders the friendly name in the trigger and both name and raw value in the
 * list, so a GM can cross-reference the C++ define while picking.
 */
export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Select…",
  className,
}: {
  id?: string;
  value: string;
  options: readonly EnumOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, search]);

  const current = options.find((o) => o.value === value);
  const unknown = value !== "" && current === undefined;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen(!open);
          setSearch("");
        }}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors",
          "hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        )}
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>
          {current?.label ?? (unknown ? `Unmapped (${value})` : placeholder)}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full min-w-[16rem] overflow-auto rounded-md border border-border bg-popover shadow-lg">
          <div className="sticky top-0 border-b border-border bg-popover p-1.5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              aria-label="Filter options"
              className="h-8 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered.length > 0) {
                  e.preventDefault();
                  onChange(filtered[0].value);
                  setOpen(false);
                }
              }}
            />
          </div>
          <ul role="listbox" className="p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</li>
            )}
            {filtered.slice(0, 200).map((o) => {
              const selected = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                      selected && "bg-accent font-medium",
                    )}
                  >
                    <Check className={cn("h-3 w-3 shrink-0", !selected && "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
            {filtered.length > 200 && (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                +{filtered.length - 200} more — refine the search
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
