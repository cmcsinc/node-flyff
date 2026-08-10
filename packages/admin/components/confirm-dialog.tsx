'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Confirm button label. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styles the confirm button red. */
  destructive?: boolean;
  /** Called on confirm. If it returns a promise, the button shows a spinner until it resolves. */
  onConfirm: () => void | Promise<void>;
}

/**
 * Accessible confirmation dialog for destructive/irreversible actions.
 * Focus trap, Escape-to-close, click-outside-to-close, `role="alertdialog"`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element | null {
  const [pending, setPending] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // Initial focus + focus trap
  React.useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      } else if (e.key === 'Tab') {
        const focusables = [cancelRef.current, confirmRef.current].filter(
          Boolean,
        ) as HTMLButtonElement[];
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return (): void => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const handleConfirm = async (): Promise<void> => {
    try {
      setPending(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
    >
      <div
        className="absolute inset-0 bg-scrim backdrop-blur-sm animate-[fade-in-up_0.15s_ease-out]"
        onClick={() => {
          if (!pending) onOpenChange(false);
        }}
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-overlay animate-[fade-in-up_0.2s_cubic-bezier(0.4,0,0.2,1)]">
        <h2 id="confirm-title" className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <div id="confirm-desc" className="mt-2 text-sm text-muted-foreground">
          {description}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              void handleConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
