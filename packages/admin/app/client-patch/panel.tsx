'use client';

/**
 * Client patch panel — one card per `.res` archive.
 *
 * Shows which `raw/` files differ from the copy packed into the client, and
 * offers Patch (merge stale files in, behind a backup) and Restore (put the
 * backup back). Both go through `/api/client-patch`.
 *
 * @module app/client-patch/panel
 */

import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { ArchiveStatus, ClientPatchStatus } from '@/lib/client-patch';
import type { AuthFileStatus } from '@/lib/client-auth-file';

async function post(
  body: Record<string, unknown>,
): Promise<{ replaced?: { name: string }[]; records?: number | null }> {
  const res = await fetch('/api/client-patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  const data = (json ?? {}) as {
    ok?: boolean;
    error?: string;
    replaced?: { name: string }[];
    records?: number | null;
  };
  if (!res.ok || data.ok !== true) throw new Error(data.error ?? 'Request failed');
  return data;
}

export function ClientPatchPanel({ initial }: { initial: ClientPatchStatus }): React.JSX.Element {
  const totalStale = initial.archives.reduce((n, a) => n + a.staleCount, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Client data at <code className="font-mono">{initial.clientDir}</code>.{' '}
        {totalStale === 0
          ? 'Every tracked resource matches the client.'
          : `${String(totalStale)} file(s) edited here have not reached the client yet.`}
      </p>

      {initial.archives.map((a) => (
        <ArchiveCard key={a.name} archive={a} />
      ))}

      {initial.authFile !== undefined && <AuthFileCard status={initial.authFile} />}
    </div>
  );
}

/**
 * `Flyff.a` integrity manifest.
 *
 * Its own card because a mismatch here is fatal in a way a stale archive is not:
 * the client `ExitProcess(-1)`s on the first read of any member whose hash is
 * missing. Patch and Restore both rebuild it, so this is normally informational
 * — the button exists for a manifest left stale by an interrupted patch.
 */
function AuthFileCard({ status }: { status: AuthFileStatus }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const bad = status.mismatched.length;

  async function rebuild(): Promise<void> {
    setPending(true);
    try {
      const data = await post({ action: 'rebuild-manifest' });
      toast.success(
        data.records === null
          ? 'Flyff.a already matched the archives'
          : `Flyff.a rebuilt — ${String(data.records)} records`,
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-mono">Flyff.a</CardTitle>
          {status.error !== undefined || !status.present ? (
            <Badge variant="outline">{status.present ? 'Unreadable' : 'Missing'}</Badge>
          ) : (
            <Badge variant={bad > 0 ? 'warning' : 'success'}>
              {bad > 0 ? `${String(bad)} mismatched` : 'In sync'}
            </Badge>
          )}
          {status.hasBackup && <Badge variant="outline">Backup available</Badge>}
        </div>
        <CardDescription>
          {status.error ??
            `Integrity manifest — ${String(status.entries)} records for ${String(status.members)} archive members. The client exits if a file's hash is missing.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {bad > 0 && (
          <ul className="space-y-1.5">
            {status.mismatched.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                <span className="font-mono">{name}</span>
                <span className="text-xs text-muted-foreground">not covered by the manifest</span>
              </li>
            ))}
          </ul>
        )}

        {status.error === undefined && bad === 0 && status.present && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
            Every archive member is covered.
          </p>
        )}

        <Button
          variant={bad > 0 ? 'default' : 'outline'}
          onClick={() => void rebuild()}
          disabled={pending}
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Rebuild manifest
        </Button>
      </CardContent>
    </Card>
  );
}

function ArchiveCard({ archive }: { archive: ArchiveStatus }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<null | 'patch' | 'restore'>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const stale = archive.tracked.filter((t) => t.stale);

  async function run(action: 'patch' | 'restore'): Promise<void> {
    setPending(action);
    try {
      const data = await post({ action, archive: archive.name });
      toast.success(
        action === 'restore'
          ? `${archive.name} restored from backup, Flyff.a rebuilt`
          : `${archive.name}: ${String(data.replaced?.length ?? 0)} file(s) merged, Flyff.a rebuilt. Restart the client.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-mono">{archive.name}</CardTitle>
          {archive.error !== undefined ? (
            <Badge variant="outline">Unreadable</Badge>
          ) : (
            <Badge variant={stale.length > 0 ? 'warning' : 'success'}>
              {stale.length > 0 ? `${String(stale.length)} stale` : 'In sync'}
            </Badge>
          )}
          {archive.hasBackup && <Badge variant="outline">Backup available</Badge>}
        </div>
        <CardDescription>
          {archive.error ??
            `${String(archive.memberCount)} members, ${String(archive.tracked.length)} tracked in raw/`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {stale.length > 0 && (
          <ul className="space-y-1.5">
            {stale.map((m) => (
              <li key={m.name} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                <span className="font-mono">{m.name}</span>
                <span className="text-xs text-muted-foreground">
                  client {m.packedSize.toLocaleString()} B → raw {(m.rawSize ?? 0).toLocaleString()}{' '}
                  B
                </span>
              </li>
            ))}
          </ul>
        )}

        {archive.error === undefined && stale.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
            Nothing to merge.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => void run('patch')}
            disabled={pending !== null || stale.length === 0}
          >
            {pending === 'patch' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Patch client
          </Button>
          {archive.hasBackup && (
            <Button
              variant="outline"
              onClick={() => {
                setRestoreOpen(true);
              }}
              disabled={pending !== null}
            >
              {pending === 'restore' && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              )}
              Restore backup
            </Button>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={`Restore ${archive.name}?`}
        destructive
        confirmLabel="Restore"
        description={
          <>
            The client&apos;s current <code className="font-mono">{archive.name}</code> is replaced
            by the pre-patch backup. The patched copy is kept as{' '}
            <code className="font-mono">{archive.name}.patched</code>, so this is reversible. Close
            the game client first.
          </>
        }
        onConfirm={() => run('restore')}
      />
    </Card>
  );
}
