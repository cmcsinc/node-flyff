"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { blankLine, type KeyDraft, type LineDraft, type StateDraft } from "./dialog-drafts";

/** Shared textarea styling — matches the `Input` control's chrome. */
const TEXTAREA_CLASS =
  "flex min-h-[36px] w-full rounded-md border border-input bg-transparent px-3 py-2 " +
  "text-xs shadow-sm transition-colors placeholder:text-muted-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
  "hover:border-ring/40 aria-invalid:border-destructive";

/**
 * One editable dialog line.
 *
 * The control holds the **text**, not the index — a GM types words. The raw row
 * number is shown beside the label because it is what `Say( n )` carries and a GM
 * cross-referencing `NpcScript.cpp` needs it (rule 12: name plus raw value). A
 * row referenced by more than one state warns, because editing it changes every
 * one of them: the table has no insert, so there is no such thing as a private
 * copy of an existing row.
 */
function LineRow({
  id,
  label,
  line,
  onChange,
  onRemove,
}: {
  id: string;
  label: string;
  line: LineDraft;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const shared = line.index !== null && line.uses > 1;
  const hint =
    line.index === null
      ? "New line — appended as a new string-table row on save"
      : shared
        ? `Row ${String(line.index)} · used by ${String(line.uses)} states — editing changes all of them`
        : `String-table row ${String(line.index)}`;

  return (
    <div className="flex items-start gap-2">
      <Field htmlFor={id} label={label} hint={hint} className="min-w-0 flex-1">
        <textarea
          id={id}
          rows={2}
          value={line.text}
          onChange={(e) => { onChange({ text: e.currentTarget.value }); }}
          className={TEXTAREA_CLASS}
        />
      </Field>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="mt-6 h-9 w-9 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      {shared && (
        <AlertTriangle
          className="mt-7 h-3.5 w-3.5 shrink-0 text-warning"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Editable list of `Say`/`Speak` lines for one state. */
function LineList({
  idBase,
  title,
  hint,
  singular,
  lines,
  onChange,
}: {
  idBase: string;
  title: string;
  hint: string;
  singular: string;
  lines: readonly LineDraft[];
  onChange: (next: LineDraft[]) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4">
          <p className="text-[11px] text-muted-foreground">No {title.toLowerCase()}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { onChange([blankLine()]); }}
            className="cursor-pointer gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {singular}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {lines.map((l, i) => (
            <LineRow
              key={`${String(l.index ?? -1)}-${String(i)}`}
              id={`${idBase}-${String(i)}`}
              label={`${singular} ${String(i + 1)}`}
              line={l}
              onChange={(patch) => {
                onChange(lines.map((x, k) => (k === i ? { ...x, ...patch } : x)));
              }}
              onRemove={() => { onChange(lines.filter((_, k) => k !== i)); }}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { onChange([...lines, blankLine()]); }}
            className="cursor-pointer gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {singular}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Editable `AddKey` table — the player's choice buttons.
 *
 * `key` is the state the choice routes to; when blank the C++ routes to the
 * label's own index. `param` cannot be written without `key` (the call is
 * positional), so the writer rejects that pair and the hint says so.
 */
function KeyTable({
  idBase,
  keys,
  onChange,
}: {
  idBase: string;
  keys: readonly KeyDraft[];
  onChange: (next: KeyDraft[]) => void;
}): React.JSX.Element {
  function patch(i: number, next: Partial<KeyDraft>): void {
    onChange(keys.map((k, x) => (x === i ? { ...k, ...next } : k)));
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Choice buttons
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Each row is one <code className="font-mono">AddKey</code> line. <strong>Routes to</strong>{" "}
        is the state the choice opens — blank routes to the label&apos;s own row number. A{" "}
        <strong>Param</strong> needs a route (the C++ call is positional).
      </p>
      {keys.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4">
          <p className="text-[11px] text-muted-foreground">No choice buttons</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { onChange([{ label: blankLine(), key: null, param: null }]); }}
            className="cursor-pointer gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add choice
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k, i) => (
            <div
              key={`${String(k.label.index ?? -1)}-${String(i)}`}
              className="grid gap-x-6 gap-y-2 md:grid-cols-[minmax(0,1fr)_6rem_6rem_2.25rem]"
            >
              <Field
                htmlFor={`${idBase}-label-${String(i)}`}
                label={`Button ${String(i + 1)} text`}
                hint={
                  k.label.index === null
                    ? "New line — appended on save"
                    : `Row ${String(k.label.index)}${k.label.uses > 1 ? ` · shared by ${String(k.label.uses)} states` : ""}`
                }
              >
                <Input
                  id={`${idBase}-label-${String(i)}`}
                  value={k.label.text}
                  onChange={(e) => {
                    patch(i, { label: { ...k.label, text: e.currentTarget.value } });
                  }}
                  className="h-9 text-xs"
                />
              </Field>
              <Field htmlFor={`${idBase}-key-${String(i)}`} label="Routes to" hint="State">
                <Input
                  id={`${idBase}-key-${String(i)}`}
                  type="number"
                  step={1}
                  min={0}
                  value={k.key ?? ""}
                  onChange={(e) => {
                    const n = Number.parseInt(e.currentTarget.value, 10);
                    patch(i, { key: Number.isNaN(n) ? null : n });
                  }}
                  className="h-9 text-xs"
                />
              </Field>
              <Field
                htmlFor={`${idBase}-param-${String(i)}`}
                label="Param"
                hint="Optional"
                error={k.param !== null && k.key === null ? "Needs a route" : undefined}
              >
                <Input
                  id={`${idBase}-param-${String(i)}`}
                  type="number"
                  step={1}
                  value={k.param ?? ""}
                  onChange={(e) => {
                    const n = Number.parseInt(e.currentTarget.value, 10);
                    patch(i, { param: Number.isNaN(n) ? null : n });
                  }}
                  className="h-9 text-xs"
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove choice ${String(i + 1)}`}
                onClick={() => { onChange(keys.filter((_, x) => x !== i)); }}
                className="mt-6 h-9 w-9 cursor-pointer text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { onChange([...keys, { label: blankLine(), key: null, param: null }]); }}
            className="cursor-pointer gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add choice
          </Button>
        </div>
      )}
    </div>
  );
}

/** The structured editor for one non-`source` dialog state. */
export function DialogStateEditor({
  draft,
  onChange,
}: {
  draft: StateDraft;
  onChange: (patch: Partial<StateDraft>) => void;
}): React.JSX.Element {
  const base = `dlg-${String(draft.keyIdx)}`;
  return (
    <div className="space-y-4">
      <LineList
        idBase={`${base}-say`}
        title="Dialog body"
        hint="Say( n ) — the lines shown in the NPC's dialog window."
        singular="Line"
        lines={draft.say}
        onChange={(say) => { onChange({ say }); }}
      />
      <LineList
        idBase={`${base}-speak`}
        title="Overhead speech"
        hint="Speak( NpcId(), n ) — the chat-bubble text above the NPC."
        singular="Bubble"
        lines={draft.speak}
        onChange={(speak) => { onChange({ speak }); }}
      />
      <KeyTable
        idBase={base}
        keys={draft.keys}
        onChange={(keys) => { onChange({ keys }); }}
      />
      <div className="grid gap-x-6 gap-y-5 border-t border-border pt-4 md:grid-cols-2">
        <Field
          htmlFor={`${base}-timer`}
          label="Auto-close timer"
          hint="SetScriptTimer — seconds. Blank = no timer."
        >
          <Input
            id={`${base}-timer`}
            type="number"
            step={1}
            min={1}
            value={draft.timer ?? ""}
            onChange={(e) => {
              const n = Number.parseInt(e.currentTarget.value, 10);
              onChange({ timer: Number.isNaN(n) || n < 1 ? null : n });
            }}
            className="h-9 max-w-[8rem] text-xs"
          />
        </Field>
        <div className="space-y-1.5">
          <ToggleRow
            id={`${base}-exit`}
            label="Close the dialog"
            hint="Exit() — destroys the dialog window."
            checked={draft.exit}
            onChange={(exit) => { onChange({ exit }); }}
          />
          <ToggleRow
            id={`${base}-quest`}
            label="Launch quest"
            hint="LaunchQuest() — starts the quest this state routes to."
            checked={draft.launchQuest}
            onChange={(launchQuest) => { onChange({ launchQuest }); }}
          />
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Switch
        id={id}
        checked={checked}
        onChange={(e) => { onChange(e.currentTarget.checked); }}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-xs font-medium">
          {label}
        </label>
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
