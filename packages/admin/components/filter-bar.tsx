import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PER_PAGE_OPTIONS } from "@/lib/paginate";

interface FilterBarProps {
  /** Filter controls (SearchInput, Select, …). Each needs a `name` + `defaultValue`. */
  children: React.ReactNode;
  perPage: number;
  /** Shown when any filter is active — clears the query string. */
  active?: boolean;
}

/**
 * GET form wrapper for the resource browser filters. Submitting drops `page`
 * (it is simply not a field here), so any filter change resets to page 1.
 */
export function FilterBar({ children, perPage, active }: FilterBarProps) {
  return (
    <form className="flex flex-wrap items-end gap-2" method="GET">
      {children}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Per page
        <Select name="perPage" defaultValue={String(perPage)} className="w-20" aria-label="Rows per page">
          {PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Select>
      </label>
      <Button type="submit">Apply</Button>
      {active && (
        <Link href="?" className={buttonVariants({ variant: "ghost" })}>
          Reset
        </Link>
      )}
    </form>
  );
}
