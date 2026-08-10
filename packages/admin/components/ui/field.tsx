'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  /** Must match the control's `id` so clicking the label focuses it. */
  htmlFor: string;
  label: string;
  /** Persistent helper text. Rendered above the control's error, if any. */
  hint?: string;
  /**
   * Where the hint sits. `below` (default) suits single inputs; `above` suits
   * tables/lists/groups, where a trailing hint reads as part of the collection
   * rather than as guidance for it.
   */
  hintPosition?: 'below' | 'above';
  /** Validation message. Rendered next to the field (never only at form top). */
  error?: string;
  /** Visually hide the label but keep it for screen readers. */
  srOnlyLabel?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * One labelled form row: visible label, control, helper text, inline error.
 *
 * Wires `aria-describedby`/`aria-invalid` onto the child control so the hint and
 * error are announced. Never use a placeholder as the only label.
 */
export function Field({
  htmlFor,
  label,
  hint,
  hintPosition = 'below',
  error,
  srOnlyLabel,
  className,
  children,
}: FieldProps): React.ReactElement {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  const hintNode = hint && !error && (
    <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
      {hint}
    </p>
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className={cn('text-xs', srOnlyLabel && 'sr-only')}>
        {label}
      </Label>
      {hintPosition === 'above' && hintNode}
      {control}
      {hintPosition === 'below' && hintNode}
      {error && (
        <p id={errorId} className="text-[11px] font-medium leading-snug text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Titled group of fields inside a form. Keeps dense grids scannable. */
export function FieldGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <fieldset className={cn('space-y-2', className)}>
      <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
