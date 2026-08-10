'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { responseStatus } from '@/lib/api-response';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

/** Matches the route's `reason` bound (app/api/servers/kick-all/route.ts). */
const MAX_REASON_LEN = 200;

/** Reason shown on hover/focus when there is nobody to drain. */
const EMPTY_HINT = 'No characters are online — nothing to disconnect.';

interface KickAllButtonProps {
  /** Players currently online, for the blast-radius count in the dialog. */
  onlineCount: number;
}

/**
 * Maintenance drain: disconnect every online player, state saved.
 *
 * Deliberately behind a modal with a typed reason rather than a one-tap
 * confirm. This is the only control in the panel whose blast radius is the
 * whole server — every session on the world drops — so the dialog states the
 * count up front and the reason is what makes the audit row useful afterwards.
 *
 * The world side flushes each player before closing their socket, so this is
 * safe-but-disruptive, not destructive: nothing is lost, everyone is kicked.
 */
export function KickAllButton({ onlineCount }: KickAllButtonProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const idle = onlineCount === 0;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
        disabled={idle}
        title={idle ? EMPTY_HINT : undefined}
        aria-describedby={idle ? 'kick-all-empty' : undefined}
        className="text-destructive hover:text-destructive"
      >
        <PlugZap className="mr-1.5 h-4 w-4" />
        Kick all
      </Button>
      {idle && (
        <span id="kick-all-empty" className="sr-only">
          {EMPTY_HINT}
        </span>
      )}
      {open && (
        <KickAllModal
          onlineCount={onlineCount}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function KickAllModal({
  onlineCount,
  onClose,
}: KickAllButtonProps & { onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);

  const trimmed = reason.trim();
  const tooLong = trimmed.length > MAX_REASON_LEN;

  async function run(): Promise<void> {
    if (tooLong) return;
    setPending(true);
    try {
      const res = await fetch('/api/servers/kick-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `confirm` is required server-side so a stray POST cannot drain a
        // live world; the reason is optional.
        body: JSON.stringify(trimmed ? { confirm: true, reason: trimmed } : { confirm: true }),
      });
      const { ok, error } = await responseStatus(res);
      if (!res.ok || !ok) throw new Error(error ?? `HTTP ${String(res.status)}`);
      toast.success('Drain command sent', {
        description: 'Players see a disconnect notice, then drop once their state is saved.',
      });
      onClose();
      router.refresh();
    } catch (err) {
      toast.error('Failed to kick all', { description: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
          if (!next && !pending) onClose();
        }}
      title="Disconnect all players?"
      description={`${String(onlineCount)} character${onlineCount === 1 ? '' : 's'} online`}
      className="max-w-md"
      footer={
        <>
          <Button variant="destructive" onClick={() => void run()} disabled={pending || tooLong}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kick all {onlineCount}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every online session on the world server is disconnected. Each player&apos;s state
          (position, vitals, stats, bank) is written to the database first, so nothing is lost —
          they can log straight back in. Intended for maintenance before a restart.
        </p>
        <Field
          htmlFor="kick-all-reason"
          label="Reason (optional)"
          hint="Recorded in the admin audit log. Players do not see it."
          error={tooLong ? `Keep it under ${String(MAX_REASON_LEN)} characters.` : undefined}
        >
          <Input
            id="kick-all-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            placeholder="restart for migration 019"
            disabled={pending}
            maxLength={MAX_REASON_LEN + 1}
          />
        </Field>
      </div>
    </Modal>
  );
}
