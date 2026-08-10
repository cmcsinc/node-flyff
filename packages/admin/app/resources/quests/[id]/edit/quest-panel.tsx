'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Info, RotateCcw, Save, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SearchableSelect } from '@/components/form/searchable-select';
import { pairQuestArgs, type ArgView, type CommandView } from '@/lib/quest-args';
import type { QuestEditorView } from '@/lib/quest-editor';
import { questCmdSpec, type BlastTier } from '@/lib/quest-fields';
import type { QuestArg } from '@flyff/resources';
import { QuestCommandCard, TIER_COPY } from './quest-command-card';
import {
  addCommand,
  buildPutBody,
  draftFromView,
  isDirty,
  pendingTier,
  setArg,
  toggleRemoved,
  type QuestDraft,
} from './quest-drafts';

/**
 * Quest editor, banded by client blast radius.
 *
 * `propQuest.inc` is packed into the client's `dataSub1.res`
 * (`game/resource/resource.txt:132`) and `Project.cpp:495 LoadPropQuest` has no
 * server guard, so the client parses its own copy of every quest. Editing a
 * condition here without shipping a patched archive leaves players on a client
 * that computes the quest differently from the server.
 *
 * The panel therefore never presents a flat form. Each command states which tier
 * it is in, the save confirmation names the worst tier in the pending edit, and
 * the success toast says what still has to happen (restart, and for anything
 * beyond `server`, a client patch export).
 *
 * Structural deletes are not offered: removing a quest id or a reachable `state`
 * block crashes a stale client at the unguarded deref in `DPClient.cpp:8540`.
 * Only whole commands can be removed, which the writer handles inside the
 * existing `setting { }` group.
 *
 * @module app/resources/quests/[id]/edit/quest-panel
 */

interface PutResponse {
  ok?: boolean;
  error?: string;
  needsClientPatch?: boolean;
}

const TIER_BADGE: Readonly<Record<BlastTier, 'secondary' | 'warning' | 'destructive'>> = {
  server: 'secondary',
  cosmetic: 'warning',
  structural: 'destructive',
};

export function QuestPanel({
  view,
  addable,
}: {
  view: QuestEditorView;
  addable: readonly { cmd: string; label: string; tier: BlastTier }[];
}): React.JSX.Element {
  const baseline = useMemo(() => draftFromView(view), [view]);
  const [draft, setDraft] = useState<QuestDraft>(() => draftFromView(view));
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  const dirty = isDirty(draft, baseline);
  const worst = pendingTier(draft, baseline);
  const needsPatch = worst !== null && worst !== 'server';

  const addOptions = useMemo(
    () =>
      addable.map((a) => ({
        value: a.cmd,
        label: `${a.label} — ${TIER_COPY[a.tier].label}`,
      })),
    [addable],
  );

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch('/api/quest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPutBody(view.id, draft, baseline)),
      });
      const data = (await res.json().catch(() => null)) as PutResponse | null;
      if (!res.ok) {
        toast.error(data?.error ?? 'Save failed');
        return;
      }
      toast.success(
        needsPatch
          ? 'Written to propQuest.inc — restart the world server AND export a client patch'
          : 'Written to propQuest.inc — restart the world server to apply',
      );
      router.refresh();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              Quest definition
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {view.symbol}
              </span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['structural', 'cosmetic', 'server'] as const).map((t) =>
                view.tierCounts[t] > 0 ? (
                  <Badge key={t} variant={TIER_BADGE[t]}>
                    {view.tierCounts[t]} {TIER_COPY[t].label.toLowerCase()}
                  </Badge>
                ) : null,
              )}
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-snug text-destructive">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>The client reads this file too.</strong>{' '}
              <code className="font-mono">propQuest.inc</code> is packed into{' '}
              <code className="font-mono">dataSub1.res</code>, so most fields here need a{' '}
              <strong>client patch export</strong> on top of a world-server restart. Only &ldquo;
              {TIER_COPY.server.label}&rdquo; commands are safe to change on their own.
            </span>
          </p>
        </CardHeader>

        <CardContent className="space-y-5 pt-0">
          <Field
            htmlFor="q-title"
            label="Title"
            hint={
              view.titleToken
                ? `Stored in propQuest.txt.txt under ${view.titleToken}. Shown in the client's quest list.`
                : 'This quest has no SetTitle token, so its title cannot be set here.'
            }
          >
            <Input
              id="q-title"
              value={draft.title}
              disabled={!view.titleToken}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
              }}
              className="h-9"
            />
          </Field>

          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Commands
            </h3>
            {draft.commands.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                No commands
              </p>
            ) : (
              draft.commands.map((c, i) => {
                if (c.removed) {
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground line-through">
                        {c.cmd}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraft(toggleRemoved(draft, i));
                        }}
                        className="h-7 cursor-pointer text-xs"
                      >
                        Undo
                      </Button>
                    </div>
                  );
                }
                // A command the GM added has no entry in `view`, so its slots are
                // derived from the signature here — otherwise a new command
                // renders as a row of unnamed number inputs.
                const rendered = renderView(view.commands.at(i), i, c);
                return (
                  <QuestCommandCard
                    key={i}
                    view={{ ...rendered, index: i, args: argsFor(rendered, c.args) }}
                    expanded={open === i}
                    onToggle={() => {
                      setOpen(open === i ? null : i);
                    }}
                    onArgChange={(ai, arg) => {
                      setDraft(setArg(draft, i, ai, arg));
                    }}
                    onRemove={() => {
                      setDraft(toggleRemoved(draft, i));
                    }}
                  />
                );
              })
            )}
          </div>

          <Field
            htmlFor="q-add"
            label="Add a command"
            hint="Labelled with the tier it lands in. Adding a client-logic command needs a patch export."
            hintPosition="above"
          >
            <SearchableSelect
              id="q-add"
              value=""
              options={addOptions}
              onChange={(cmd) => {
                setDraft(addCommand(draft, cmd));
                setOpen(draft.commands.length);
              }}
              placeholder="Select a command…"
              className="max-w-md"
            />
          </Field>
        </CardContent>

        <CardFooter className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            onClick={() => {
              setConfirming(true);
            }}
            disabled={!dirty || saving}
            className="cursor-pointer gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDraft(draftFromView(view));
            }}
            disabled={!dirty || saving}
            className="cursor-pointer gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </Button>
          {dirty && worst !== null && (
            <span
              className={`flex items-center gap-1.5 text-[11px] ${needsPatch ? 'font-medium text-warning' : 'text-muted-foreground'}`}
            >
              {needsPatch ? (
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {needsPatch
                ? `Unsaved · reaches ${TIER_COPY[worst].label.toLowerCase()} — needs a client patch`
                : 'Unsaved · server-only change'}
            </span>
          )}
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Write propQuest.inc?"
        destructive={needsPatch}
        description={
          <span className="space-y-2">
            <span className="block">
              This rewrites <code className="font-mono">raw/propQuest.inc</code>
              {draft.title !== baseline.title ? (
                <>
                  {' '}
                  and <code className="font-mono">raw/propQuest.txt.txt</code>
                </>
              ) : null}
              , plus <code className="font-mono">data/quests/{String(view.id)}.yml</code>. Comments,
              blank lines, and every command you did not touch are preserved byte for byte.
            </span>
            {needsPatch ? (
              <span className="block font-medium text-warning">
                {TIER_COPY[worst].blurb} Export a client patch and ship it, or players on the
                current <code className="font-mono">dataSub1.res</code> will disagree with the
                server.
              </span>
            ) : (
              <span className="block">
                Every change in this edit is server-only. A world-server restart is enough.
              </span>
            )}
            <span className="block">Reversible by re-editing or restoring the files from git.</span>
          </span>
        }
        confirmLabel="Write"
        onConfirm={save}
      />
    </>
  );
}

/**
 * Re-pair a command's live draft args with the spec slots from its stored view.
 *
 * The view was built server-side from the file; the draft holds the current
 * values. Keeping the view's `spec`/`group` while taking the draft's `arg` is what
 * lets a control stay labelled after its value changes.
 *
 * Draft args past the view's slot count (a goal-marker tail the GM just filled
 * in) are appended unlabelled rather than dropped — losing them here would
 * silently discard the edit on the next render.
 */
function argsFor(view: CommandView, args: readonly QuestArg[]): ArgView[] {
  const merged: ArgView[] = view.args.map((slot, i) => ({
    ...slot,
    arg: args[i],
  }));
  for (let i = view.args.length; i < args.length; i++) {
    merged.push({ arg: args[i] });
  }
  return merged;
}

/**
 * The view row for a draft command, synthesising one for a command the GM added.
 *
 * A newly added command has no server-built view, so its slots come from the
 * signature here. Without this it renders as unnamed number inputs.
 */
function renderView(
  stored: CommandView | undefined,
  index: number,
  draft: { cmd: string; args: readonly QuestArg[]; tier: BlastTier; dead: boolean },
): CommandView {
  if (stored) return stored;
  const spec = questCmdSpec(draft.cmd);
  return {
    index,
    cmd: draft.cmd,
    args: pairQuestArgs({ cmd: draft.cmd, args: [...draft.args] }, spec),
    ...(spec ? { spec } : {}),
    tier: draft.tier,
    dead: draft.dead,
  };
}
