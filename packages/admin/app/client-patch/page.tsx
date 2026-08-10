/**
 * Client patch page — merge edited `raw/` resources into the game client.
 *
 * Server component: resolves the patch status once, hands it to the interactive
 * table. See `lib/client-patch` for why this step exists at all (the client
 * parses its own packed copy of files this panel edits).
 *
 * @module app/client-patch/page
 */

import type * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { clientPatchStatus } from '@/lib/client-patch';
import { ClientPatchPanel } from './panel';

export const dynamic = 'force-dynamic';

export default async function ClientPatchPage(): Promise<React.JSX.Element> {
  const status = await clientPatchStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Patch"
        description="Merge edited resources into the client's .res archives"
      />

      {status.clientDir === null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Client directory not configured</CardTitle>
            <CardDescription>
              Set <code className="font-mono">CLIENT_DIR</code> to the folder holding{' '}
              <code className="font-mono">data.res</code>, then restart the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs">
              CLIENT_DIR=H:/flyff/v19/Client
            </pre>
          </CardContent>
        </Card>
      ) : (
        <ClientPatchPanel initial={status} />
      )}
    </div>
  );
}
