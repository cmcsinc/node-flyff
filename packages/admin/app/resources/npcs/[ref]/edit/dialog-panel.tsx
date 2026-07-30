"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, Code2, Info, MessageSquare, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { DialogPrefixView } from "@/lib/dialog-inc";
import { DialogStateEditor } from "./dialog-state-editor";
import {
  appendCount,
  buildPutBody,
  draftsFromView,
  isDirty,
  type StateDraft,
} from "./dialog-drafts";

/** Shape of `/api/dialog` PUT's JSON reply. */
interface PutResponse {
  ok?: boolean;
  error?: string;
  appended?: number[];
}

/**
 * NPC dialog editor — the `CNpcScript::<prefix>_<keyIdx>()` bodies plus the
 * `WorldDialog.txt` rows they reference.
 *
 * Four things this panel must not misrepresent:
 *
 * 1. **No client patch is needed.** Dialog text crosses the wire as a string and
 *    `WorldDialog.txt` is not packed into `data.res`. This is the opposite of a
 *    quest edit, so the header says it outright — otherwise a GM assumes a client
 *    rebuild and is blocked on nothing.
 * 2. **A `source` state is read-only.** The writer emits its raw C++ verbatim and
 *    ignores every structured field, so offering controls would be a lie. It gets
 *    a marked code block instead.
 * 3. **Text rows are shared.** There is no insert, so editing a row used by
 *    several states changes all of them. Each line says how many.
 * 4. **It is not live.** The world server loads dialog at boot, so the success
 *    path says "restart", never "applied".
 */
export function DialogPanel({ view }: { view: DialogPrefixView }): React.JSX.Element {
  const baseline = useMemo(() => draftsFromView(view), [view]);
  const [drafts, setDrafts] = useState<StateDraft[]>(() => draftsFromView(view));
  const [open, setOpen] = useState<number | null>(() => view.states[0]?.keyIdx ?? null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  const dirty = isDirty(drafts, baseline);
  const willAppend = appendCount(drafts);
  const sourceCount = view.states.filter((s) => s.hasSource).length;
  const blankNew = drafts.some(
    (d) =>
      [...d.say, ...d.speak, ...d.keys.map((k) => k.label)].some(
        (l) => l.index === null && l.text.trim() === "",
      ),
  );

  function patchState(keyIdx: number, patch: Partial<StateDraft>): void {
    setDrafts((prev) => prev.map((d) => (d.keyIdx === keyIdx ? { ...d, ...patch } : d)));
  }

  async function save(): Promise<void> {
    if (!view.prefix) return;
    setSaving(true);
    try {
      const body = buildPutBody(view.prefix, drafts, baseline);
      const res = await fetch("/api/dialog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as PutResponse | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Save failed");
        return;
      }
      const added = data?.appended?.length ?? 0;
      toast.success(
        "Saved to NpcScript.cpp + WorldDialog.txt — restart the world server to apply" +
          (added > 0 ? ` (${String(added)} new string rows)` : ""),
      );
      router.refresh();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!view.exists) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Dialog</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {view.characterKey ? (
              <>
                No script group for <code className="font-mono">{view.characterKey}</code> exists in{" "}
                <code className="font-mono">raw/NpcScript.cpp</code>, so this NPC has no dialog.
                A new group has to be added by hand — it needs its own{" "}
                <code className="font-mono">{"// File :"}</code> header among 4,244 functions.
              </>
            ) : (
              <>
                This placement has no <strong>Character key</strong>. Dialog resolves through that
                key — set one above.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Dialog
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {view.prefix}
              </span>
            </CardTitle>
            <Badge variant="secondary">{view.states.length} states</Badge>
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              These are the <code className="font-mono">CNpcScript::{view.prefix}_&lt;n&gt;()</code>{" "}
              bodies in <code className="font-mono">raw/NpcScript.cpp</code> and the{" "}
              <code className="font-mono">WorldDialog.txt</code> rows they reference. Dialog text
              crosses the wire as a string and is <strong>not</strong> packed into the client&apos;s{" "}
              <code className="font-mono">data.res</code>, so an edit here needs{" "}
              <strong>no client patch</strong> — only a <strong>world-server restart</strong>.
            </span>
          </p>

          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>String rows are shared and never renumbered.</strong> The table has{" "}
              {view.stringCount} rows and 4,244 script functions reference them by number, so there
              is no insert and no delete: new text is appended, and editing a row used by several
              states changes every one of them.
              {sourceCount > 0 && (
                <>
                  {" "}
                  {sourceCount} of these states store a raw C++ body and are read-only here.
                </>
              )}
            </span>
          </p>
        </CardHeader>

        <CardContent className="space-y-2 pt-0">
          {drafts.map((d) => {
            const stored = view.states.find((s) => s.keyIdx === d.keyIdx);
            const expanded = open === d.keyIdx;
            return (
              <div key={d.keyIdx} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => { setOpen(expanded ? null : d.keyIdx); }}
                  aria-expanded={expanded}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {d.keyIdx}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {stored?.reserved ?? summarize(d)}
                  </span>
                  {d.hasSource && (
                    <Badge variant="warning" className="shrink-0 gap-1">
                      <Code2 className="h-3 w-3" aria-hidden="true" />
                      Raw C++
                    </Badge>
                  )}
                </button>
                {expanded && (
                  <div className="border-t border-border px-3 py-4">
                    {d.hasSource && stored?.source !== undefined ? (
                      <SourceState source={stored.source} />
                    ) : (
                      <DialogStateEditor
                        draft={d}
                        onChange={(patch) => { patchState(d.keyIdx, patch); }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>

        {/*
          Actions sit in the card footer, not a sticky bar: the placement form
          above already owns the page's one sticky bar, and a second element
          pinned to bottom:0 would overlap it.
        */}
        <CardFooter className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            onClick={() => { setConfirming(true); }}
            disabled={!dirty || saving || blankNew}
            className="cursor-pointer gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="outline"
            onClick={() => { setDrafts(draftsFromView(view)); }}
            disabled={!dirty || saving}
            className="cursor-pointer gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </Button>
          {blankNew ? (
            <span className="text-[11px] font-medium text-destructive">
              A new line cannot be empty — it would append a blank string row.
            </span>
          ) : (
            dirty && (
              <span className="text-[11px] text-muted-foreground">
                Unsaved changes
                {willAppend > 0 &&
                  ` · ${String(willAppend)} new string row${willAppend > 1 ? "s" : ""} will be appended`}
              </span>
            )
          )}
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Write dialog files?"
        description={
          `This writes raw/NpcScript.cpp, raw/WorldDialog.txt, and ` +
          `data/dialogues/${view.prefix ?? ""}.yml. ` +
          (willAppend > 0
            ? `${String(willAppend)} new string-table row(s) will be appended; existing rows are ` +
              `edited in place and never renumbered. `
            : "") +
          `The world server must be restarted before the change takes effect. No client patch ` +
          `is needed — the client never reads this text. Reversible by re-editing, or by ` +
          `restoring the files from git.`
        }
        confirmLabel="Write"
        onConfirm={save}
      />
    </>
  );
}

/** First line of dialog, or a structural description when there is none. */
function summarize(d: StateDraft): string {
  const first = d.say.length > 0 ? d.say[0].text : d.speak.length > 0 ? d.speak[0].text : "";
  if (first.trim()) return first;
  if (d.keys.length > 0) return `${String(d.keys.length)} choice buttons`;
  if (d.exit) return "Closes the dialog";
  if (d.launchQuest) return "Launches a quest";
  return "Empty state";
}

/**
 * A `source` state, read-only.
 *
 * The writer emits this body verbatim and ignores every structured field, so
 * structured controls here would appear to work and change nothing. Rule 12
 * permits a read-only code block for exactly this case — derived/source text.
 */
function SourceState({ source }: { source: string }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning">
        <Code2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <strong>Raw C++ body — read-only here.</strong> This state uses conditionals or calls
          outside the structured subset, and the writer emits it verbatim: any structured edit
          would be silently ignored. Edit it by hand in{" "}
          <code className="font-mono">raw/NpcScript.cpp</code>, then re-run the dialog converter.
        </span>
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">
        {source}
      </pre>
    </div>
  );
}
