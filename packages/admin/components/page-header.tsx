import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Renders a back-arrow link to this href. */
  backHref?: string;
  /** Right-aligned actions (buttons, badges, etc.). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Shared page header — title, optional description, back link, and actions.
 * Replaces the copy-pasted `<h1> + count` and back-arrow blocks across pages.
 */
export function PageHeader({ title, description, backHref, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl md:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
