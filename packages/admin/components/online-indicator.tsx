import { cn } from '@/lib/utils';

/**
 * Online/offline presence indicator. A coloured dot plus a text label so the
 * state never depends on colour alone; the dot itself is `aria-hidden` and the
 * label carries the meaning.
 */
export function OnlineIndicator({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          online ? 'bg-success shadow-[0_0_6px_var(--color-success)]' : 'bg-muted-foreground/50',
        )}
      />
      <span className={online ? 'text-success' : 'text-muted-foreground'}>
        {online ? 'Online' : 'Offline'}
      </span>
    </span>
  );
}
