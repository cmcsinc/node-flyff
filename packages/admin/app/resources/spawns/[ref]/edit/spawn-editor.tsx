'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ResourceFormEditor } from '@/components/resource-form-editor';
import { FieldOptionsProvider } from '@/components/form/field-options';
import type { EnumOption } from '@/lib/field-schema';
import { responseError } from '@/lib/api-response';
import { Trash2 } from 'lucide-react';

/**
 * Monster spawn-point form. Reuses the generic resource form editor but routes
 * saves to `/api/spawns` (the entry lives inside a zone file, not a resource
 * file) and adds delete, which the resource types don't support.
 *
 * `mover_id` on a spawn is a *monster*, so the picker is injected here rather
 * than taken from the field schema's static registries — the NPC editor injects
 * its own NPC list for the same key.
 */
export function SpawnEditor({
  ref_,
  entry,
  moverOptions,
  isNew = false,
}: {
  ref_: string;
  entry: Record<string, unknown>;
  moverOptions: EnumOption[];
  isNew?: boolean;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function save(form: Record<string, unknown>): Promise<string | null> {
    const res = await fetch('/api/spawns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ref_, spawn: form }),
    });
    return res.ok ? null : ((await responseError(res)) ?? 'Save failed');
  }

  async function remove(): Promise<void> {
    const res = await fetch('/api/spawns', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ref_ }),
    });
    if (!res.ok) {
      toast.error((await responseError(res)) ?? 'Delete failed');
      return;
    }
    toast.success('Spawn deleted');
    router.push('/resources/spawns');
    router.refresh();
  }

  return (
    <FieldOptionsProvider options={{ mover: moverOptions }}>
      <ResourceFormEditor
        type="spawns"
        id={ref_}
        entry={entry}
        save={save}
        backHref="/resources/spawns"
        saveClean={isNew}
        destructiveAction={
          isNew ? undefined : (
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(true);
              }}
              className="cursor-pointer gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete spawn
            </Button>
          )
        }
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this spawn point?"
        description="The entry is removed from the zone YAML file, and the monsters it spawns disappear on the world server's next restart. This cannot be undone from the panel."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </FieldOptionsProvider>
  );
}
