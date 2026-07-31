"use client";

import { AlertTriangle, Ban, ChevronRight, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QuestArgField } from "./quest-arg-field";
import type { CommandView } from "@/lib/quest-args";
import type { BlastTier } from "@/lib/quest-fields";
import type { QuestArg } from "@flyff/resources";

/**
 * One quest command as a titled group of named argument controls.
 *
 * @module app/resources/quests/[id]/edit/quest-command-card
 */

/** What each tier means for a client that has not been patched. */
export const TIER_COPY: Readonly<Record<BlastTier, { label: string; blurb: string }>> = {
  server: {
    label: "Server only",
    blurb:
      "The client never reads this. A world-server restart applies it; no client patch needed.",
  },
  cosmetic: {
    label: "Client display",
    blurb:
      "The client renders this from its own copy of propQuest.inc. Until the archive is rebuilt, players see the old value — but the server still grants the real result.",
  },
  structural: {
    label: "Client logic",
    blurb:
      "The client re-evaluates this itself to decide the NPC quest icon and the objective list. An un-patched client will offer or hide the quest incorrectly.",
  },
};

const TIER_VARIANT: Readonly<Record<BlastTier, "secondary" | "warning" | "destructive">> = {
  server: "secondary",
  cosmetic: "warning",
  structural: "destructive",
};

export function QuestCommandCard({
  view,
  expanded,
  onToggle,
  onArgChange,
  onRemove,
}: {
  view: CommandView;
  expanded: boolean;
  onToggle: () => void;
  onArgChange: (argIndex: number, arg: QuestArg) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const title = view.spec?.label ?? view.cmd;

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-xs font-medium">{title}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{view.cmd}</span>
        </button>

        {view.dead ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Ban className="h-3 w-3" aria-hidden="true" />
            Not parsed
          </Badge>
        ) : (
          <Badge variant={TIER_VARIANT[view.tier]} className="shrink-0">
            {TIER_COPY[view.tier].label}
          </Badge>
        )}

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-3 py-4">
          {view.dead && (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Ban className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>
                  <code className="font-mono">{view.cmd}</code> has no parse branch in{" "}
                  <code className="font-mono">CProject::LoadPropQuest</code>.
                </strong>{" "}
                Neither the server nor the client acts on it, so it is shown read-only —
                editing it would change nothing. Removing it is safe.
              </span>
            </p>
          )}

          {!view.dead && view.tier !== "server" && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{TIER_COPY[view.tier].blurb}</span>
            </p>
          )}

          {view.spec?.hint && (
            <p className="text-[11px] leading-snug text-muted-foreground">{view.spec.hint}</p>
          )}

          {view.args.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              Takes no arguments
            </p>
          ) : (
            // Two columns at md — every control here is a single-line input, so
            // rows stay the same height and the grid does not break.
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              {view.args.map((a, i) => (
                <QuestArgField
                  key={i}
                  id={`q-${view.cmd}-${String(view.index)}-${String(i)}`}
                  {...(a.spec ? { spec: a.spec } : {})}
                  {...(a.arg ? { arg: a.arg } : {})}
                  index={i}
                  {...(a.group !== undefined ? { group: a.group } : {})}
                  {...(view.dead ? { disabled: true } : {})}
                  onChange={(arg) => { onArgChange(i, arg); }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
