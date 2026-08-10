import * as React from 'react';
import { cn } from '@/lib/utils';

/** Shimmering placeholder for loading states. */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-md bg-gradient-to-r from-muted via-muted-foreground/20 to-muted bg-[length:1000px_100%]',
        'animate-[shimmer_1.8s_linear_infinite]',
        className,
      )}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };
