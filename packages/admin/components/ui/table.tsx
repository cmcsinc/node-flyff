import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortHref, type Sort } from "@/lib/sort";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    // tabindex makes the scroll region keyboard-scrollable; role+label announce it.
    <div
      className="relative w-full overflow-x-auto overscroll-x-contain"
      tabIndex={0}
      role="region"
      aria-label="Scrollable table"
    >
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border transition-colors hover:bg-accent/40 data-[state=selected]:bg-accent/60",
        className,
      )}

      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-wider text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("px-3 py-2.5 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  SortableHead,
};

interface SortableHeadProps extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "children"> {
  /** Sort key this column writes to `?sort=`. */
  sortKey: string;
  /** Currently active sort, from `parseSort`. */
  sort: Sort<string>;
  /** Current query params, preserved in the link (minus `sort`/`dir`/`page`). */
  params: Record<string, string | undefined>;
  /** Right-align the label for numeric columns. */
  align?: "left" | "right" | "center";
  /** Plain text — it doubles as the `aria-label` of the sort control. */
  children: string;
}

/**
 * Header cell that sorts by query string. The whole cell is one link — so the
 * hit area is the full header, not just the text — and carries `aria-sort` so
 * screen readers announce the direction, plus a text-visible arrow so the state
 * never depends on colour alone.
 */
function SortableHead({
  sortKey,
  sort,
  params,
  align = "left",
  className,
  children,
  ...props
}: SortableHeadProps): React.JSX.Element {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  const next = active && sort.dir === "asc" ? "descending" : "ascending";

  return (
    <TableHead aria-sort={ariaSort} className={cn("p-0", className)} {...props}>
      <Link
        href={sortHref(params, sortKey, sort)}
        aria-label={`Sort by ${children}, ${next}`}
        className={cn(
          "flex h-10 w-full items-center gap-1.5 px-3 transition-colors hover:text-foreground",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
          active && "text-foreground",
        )}
      >
        <span className="truncate">{children}</span>
        <Icon
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "opacity-40")}
        />
      </Link>
    </TableHead>
  );
}

