import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";

type StatTone = "accent" | "gold" | "success" | "destructive";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
  /** Optional sub-text under the value (e.g. delta/trend). */
  hint?: string;
  /** Stagger index for entrance animation (0-based). */
  index?: number;
}

const TONE_CLASSES: Record<StatTone, { chip: string; bar: string }> = {
  accent: { chip: "bg-primary/15 text-primary", bar: "from-primary" },
  gold: { chip: "bg-gold/15 text-gold", bar: "from-gold" },
  success: { chip: "bg-success/15 text-success", bar: "from-success" },
  destructive: { chip: "bg-destructive/15 text-destructive", bar: "from-destructive" },
};

/**
 * Dashboard stat tile: gradient top border, accent icon chip, big number.
 * Animates in with a staggered pop; disabled under reduced-motion.
 */
export function StatCard({ label, value, icon: Icon, tone = "accent", hint, index = 0 }: StatCardProps) {
  const toneClass = TONE_CLASSES[tone];
  const display = typeof value === "number" ? formatNumber(value) : value;

  return (
    <Card
      className={cn(
        "card-top-accent relative overflow-hidden transition-transform hover:-translate-y-0.5",
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* tone-tinted top bar overrides the default accent line */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r to-transparent opacity-80",
          toneClass.bar,
        )}
      />
      <CardContent className="flex items-center justify-between p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p
            className="mt-1 text-3xl font-bold tracking-tight"
            style={{ animation: "var(--animate-count-pop)", animationDelay: `${index * 60 + 80}ms` }}
          >
            {display}
          </p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", toneClass.chip)}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
