import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Search field with a leading icon. Uses native `type="search"` (clear button
 * built-in). A placeholder is not a label — an `aria-label` is always set so the
 * control is named for screen readers.
 */
export function SearchInput({
  className,
  "aria-label": ariaLabel,
  placeholder,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        className="pl-8"
        placeholder={placeholder}
        aria-label={ariaLabel ?? (typeof placeholder === "string" ? placeholder : "Search")}
        {...props}
      />
    </div>
  );
}
