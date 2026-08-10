import { cn } from '@/lib/utils';

/**
 * Horizontal fill meter for bounded values (HP, MP, EXP).
 *
 * Renders the numeric value as text as well as fill width — the bar is never the
 * only carrier of the information, and `role="meter"` exposes it to AT.
 */
export function MeterBar({
  label,
  value,
  max,
  tone = 'primary',
  suffix,
  className,
}: {
  label: string;
  value: number;
  max: number;
  tone?: 'primary' | 'success' | 'destructive' | 'gold';
  /** Text appended after `value / max`, e.g. "HP". */
  suffix?: string;
  className?: string;
}): React.ReactElement {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const fill = {
    primary: 'bg-primary',
    success: 'bg-success',
    destructive: 'bg-destructive',
    gold: 'bg-gold',
  }[tone];

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-medium">
          {value.toLocaleString()} / {max.toLocaleString()}
          {suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', fill)}
          style={{ width: `${String(pct)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Compact label→value row for read-only detail panels. Values use tabular
 * figures so stacked rows align.
 */
export function DataRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('tabular text-right font-medium', mono && 'font-mono text-xs')}>
        {value}
      </span>
    </div>
  );
}
