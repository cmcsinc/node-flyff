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
 * NPC placement form. Reuses the generic resource form editor but routes saves
 * to `/api/npcs` (the entry lives inside a zone file, not a resource file) and
 * adds delete, which the resource types don't support.
 *
 * The `mover`/`characterKey` pickers are injected rather than read from the
 * field schema's static registries: both lists live behind the server-only
 * resource index, and `mover` is page-specific — an NPC placement picks from NPC
 * movers, a spawn point from monsters.
 */
export function NpcEditor({
  ref_,
  entry,
  moverOptions = [],
  characterKeyOptions = [],
  isNew = false,
}: {
  ref_: string;
  entry: Record<string, unknown>;
  moverOptions?: EnumOption[];
  characterKeyOptions?: EnumOption[];
  isNew?: boolean;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function save(form: Record<string, unknown>): Promise<string | null> {
    const res = await fetch('/api/npcs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ref_, npc: form }),
    });
    return res.ok ? null : ((await responseError(res)) ?? 'Save failed');
  }

  async function remove(): Promise<void> {
    const res = await fetch('/api/npcs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ref_ }),
    });
    if (!res.ok) {
      toast.error((await responseError(res)) ?? 'Delete failed');
      return;
    }
    toast.success('NPC deleted');
    router.push('/resources/npcs');
    router.refresh();
  }

  return (
    <FieldOptionsProvider options={{ mover: moverOptions, characterKey: characterKeyOptions }}>
      <ResourceFormEditor
        type="npcs"
        id={ref_}
        entry={entry}
        save={save}
        backHref="/resources/npcs"
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
              Delete NPC
            </Button>
          )
        }
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this NPC placement?"
        description="The entry is removed from the zone YAML file, and the world server drops the NPC on its next restart. This cannot be undone from the panel."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </FieldOptionsProvider>
  );
}
