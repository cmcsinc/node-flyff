'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

async function patchAccount(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/accounts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed');
}

export function BanToggleButton({
  id,
  banned,
}: {
  id: number;
  banned: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirm(): Promise<void> {
    setPending(true);
    try {
      await patchAccount({ id, banned: !banned });
      toast.success(banned ? 'Account unbanned' : 'Account banned');
      router.refresh();
    } catch {
      toast.error('Failed to update ban status');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={banned ? 'outline' : 'ghost'}
        size="sm"
        onClick={() => {
          setConfirmOpen(true);
        }}
        disabled={pending}
        className={banned ? undefined : 'text-destructive hover:text-destructive'}
      >
        {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {banned ? 'Unban' : 'Ban'}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={banned ? 'Unban this account?' : 'Ban this account?'}
        description={
          banned
            ? 'This account will regain access to the server immediately.'
            : 'This account will be unable to log in. You can reverse this at any time.'
        }
        confirmLabel={banned ? 'Unban' : 'Ban'}
        destructive={!banned}
        onConfirm={handleConfirm}
      />
    </>
  );
}
