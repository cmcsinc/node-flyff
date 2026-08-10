'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MapPin, Radio, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { OnlineIndicator } from '@/components/online-indicator';
import { responseStatus } from '@/lib/api-response';
import type { PickerItem } from '../../inventory/[characterId]/types';
import { MailForm } from './mail-form';

/** Reason shown on hover/focus when kick + teleport are unavailable. */
const OFFLINE_HINT = 'Character is offline — no live session to act on.';

type SessionAction = 'kick' | 'teleport_town';

const ACTION_META = {
  kick: {
    label: 'Kick',
    icon: UserX,
    destructive: true,
    confirmTitle: 'Disconnect this character?',
    confirmBody:
      'The session closes gracefully — state is flushed before the socket drops. The player can log straight back in.',
    confirmLabel: 'Kick',
    success: 'Kick command sent',
    failure: 'Failed to kick',
  },
  teleport_town: {
    label: 'Teleport to town',
    icon: MapPin,
    destructive: false,
    confirmTitle: 'Teleport to town?',
    confirmBody: "The character is moved to their zone's revival point.",
    confirmLabel: 'Teleport',
    success: 'Teleport command sent',
    failure: 'Failed to teleport',
  },
} as const;

interface LiveOpsProps {
  characterId: number;
  characterName: string;
  online: boolean;
  pickerItems: PickerItem[];
}

/**
 * Live-ops trigger: a header button that opens the session-command modal.
 *
 * Collapsed behind a modal rather than sitting inline because these are the only
 * controls on the page that reach a *running* world server — kick and teleport
 * take effect on a live player the instant they're clicked, so they should not
 * be one stray tap away while browsing a character's stats.
 */
export function LiveOpsButton({
  characterId,
  characterName,
  online,
  pickerItems,
}: LiveOpsProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Radio className="mr-1.5 h-4 w-4" />
        Live ops
      </Button>
      {open && (
        <LiveOpsModal
          characterId={characterId}
          characterName={characterName}
          online={online}
          pickerItems={pickerItems}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * The modal body. Confirmation for kick/teleport swaps this panel in place
 * rather than opening a nested `ConfirmDialog` — two stacked dialogs would
 * install two document-level focus traps and two `body.overflow` writers that
 * fight over Tab/Escape and leave scroll locked when the inner one unmounts.
 */
function LiveOpsModal({
  characterId,
  characterName,
  online,
  pickerItems,
  onClose,
}: LiveOpsProps & { onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<SessionAction | null>(null);
  const [pending, setPending] = React.useState(false);

  async function run(action: SessionAction): Promise<void> {
    const meta = ACTION_META[action];
    setPending(true);
    try {
      const res = await fetch(`/api/characters/${String(characterId)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const { ok, error } = await responseStatus(res);
      if (!res.ok || !ok) throw new Error(error ?? `HTTP ${String(res.status)}`);
      toast.success(meta.success);
      setConfirming(null);
      router.refresh();
    } catch (err) {
      toast.error(meta.failure, { description: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  if (confirming) {
    const meta = ACTION_META[confirming];
    return (
      <Modal
        open
        onOpenChange={(next) => {
          if (!next && !pending) setConfirming(null);
        }}
        title={meta.confirmTitle}
        description={characterName}
        className="max-w-md"
        footer={
          <>
            <Button
              variant={meta.destructive ? 'destructive' : 'default'}
              onClick={() => void run(confirming)}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {meta.confirmLabel}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(null);
              }}
              disabled={pending}
            >
              Back
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{meta.confirmBody}</p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Live operations"
      description={
        online
          ? 'Session commands are delivered over the world IPC bus.'
          : 'Session commands need an online character. Mail still works.'
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <OnlineIndicator online={online} className="mr-1" />
          {(Object.keys(ACTION_META) as SessionAction[]).map((action) => {
            const meta = ACTION_META[action];
            const Icon = meta.icon;
            return (
              <React.Fragment key={action}>
                <Button
                  variant={meta.destructive ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={() => {
                    setConfirming(action);
                  }}
                  disabled={!online}
                  title={online ? undefined : OFFLINE_HINT}
                  aria-describedby={online ? undefined : `live-ops-offline-${action}`}
                  className={
                    meta.destructive ? 'text-destructive hover:text-destructive' : undefined
                  }
                >
                  <Icon className="mr-1 h-3.5 w-3.5" />
                  {meta.label}
                </Button>
                {!online && (
                  <span id={`live-ops-offline-${action}`} className="sr-only">
                    {OFFLINE_HINT}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
        <MailForm characterId={characterId} pickerItems={pickerItems} onSent={onClose} />
      </div>
    </Modal>
  );
}
