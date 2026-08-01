"use client";

/**
 * Server manager — a two-pane ops console.
 *
 * Left: the instance list (state, port, pid, uptime, start/stop). Right: the
 * selected instance's live log stream, or its config form, behind tabs. The log
 * used to be a 26rem card stacked under the config form at the bottom of the
 * page; it is now the tallest element on screen, because reading output is what
 * this page is for.
 */

import * as React from "react";
import { toast } from "sonner";
import { Play, Square, Trash2, Plus, Terminal, Settings2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Modal } from "@/components/ui/modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import type { ServerType } from "@/lib/config-fields";
import { cn } from "@/lib/utils";
import { ConfigEditor } from "./config-editor";
import { LogConsole } from "./log-console";
import { post, type InstanceStatus, type RunState } from "./types";

const STATE_VARIANT: Record<RunState, "success" | "warning" | "outline" | "destructive"> = {
  running: "success",
  starting: "warning",
  stopped: "outline",
  exited: "destructive",
};

/** Dot colour per state — the at-a-glance signal, redundant with the badge text. */
const STATE_DOT: Record<RunState, string> = {
  running: "bg-success",
  starting: "bg-warning animate-pulse",
  stopped: "bg-muted-foreground/50",
  exited: "bg-destructive",
};

function uptime(startedAt: number | null): string {
  if (startedAt === null) return "";
  const s = Math.floor((Date.now() - startedAt) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function ServerManager({ initial }: { initial: InstanceStatus[] }) {
  const [instances, setInstances] = React.useState(initial);
  const [selected, setSelected] = React.useState<string | null>(initial[0]?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("console");
  const [creating, setCreating] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<InstanceStatus | null>(null);

  // Poll status (cheap; the heavy stream is the SSE log channel).
  React.useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/servers", { cache: "no-store" });
        if (res.ok) setInstances((await res.json()).instances);
      } catch {
        /* transient — next tick retries */
      }
    };
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, []);

  const act = async (action: "start" | "stop" | "delete", id: string) => {
    setBusy(id);
    try {
      const { instances: next } = await post({ action, id });
      if (next) setInstances(next);
      toast.success(`${id}: ${action} ok`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const setAutoStart = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      const { instances: next } = await post({ action: "autostart", id, enabled });
      if (next) setInstances(next);
      toast.success(`${id}: autostart ${enabled ? "on" : "off"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const active = instances.find((i) => i.id === selected) ?? null;
  const runningCount = instances.filter((i) => i.state === "running").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      {/* ── Left rail: instances ───────────────────────────────────────────── */}
      <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-80">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Instances · {runningCount}/{instances.length} up
          </p>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>

        <div className="flex flex-col gap-1.5 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-card lg:max-h-none">
          {instances.length === 0 ? (
            <EmptyState
              icon={Server}
              title="No instances"
              description="Register a login, cluster, or world server to get started."
              className="py-10"
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" /> New instance
                </Button>
              }
            />
          ) : (
            instances.map((inst) => (
              <InstanceRow
                key={inst.id}
                inst={inst}
                selected={inst.id === selected}
                busy={busy === inst.id}
                onSelect={() => setSelected(inst.id)}
                onAction={(a) => (a === "delete" ? setPendingDelete(inst) : act(a, inst.id))}
                onAutoStart={setAutoStart}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Right pane: console / config ───────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="console">
              <Terminal className="mr-1.5 h-3.5 w-3.5" /> Console
            </TabsTrigger>
            <TabsTrigger value="config" disabled={active === null}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Config
            </TabsTrigger>
          </TabsList>
          {active && (
            <p className="font-mono text-xs text-muted-foreground">
              {active.id} · {active.type} · :{active.port}
              {active.pid !== null && active.state === "running" ? ` · pid ${active.pid}` : ""}
            </p>
          )}
        </div>

        <TabsContent value="console" className="flex min-h-0 flex-1 flex-col">
          <LogConsole id={selected} state={active?.state} />
        </TabsContent>

        <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
          {active && (
            <ConfigEditor
              inst={active}
              instances={instances}
              onSaved={(next) => {
                setInstances(next);
                toast.success("Config saved");
              }}
            />
          )}
        </TabsContent>
      </Tabs>

      <CreateInstanceModal
        open={creating}
        onOpenChange={setCreating}
        onCreated={(next) => {
          setInstances(next);
          setCreating(false);
          toast.success("Instance created");
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.id ?? ""}?`}
        description="Removes the instance from the supervisor registry. Its config/instances file and log file stay on disk, so this can be re-created — but the registration is gone until you do."
        confirmLabel="Delete instance"
        destructive
        onConfirm={() => {
          const id = pendingDelete?.id;
          setPendingDelete(null);
          if (id !== undefined) void act("delete", id);
        }}
      />
    </div>
  );
}

function InstanceRow({
  inst,
  selected,
  busy,
  onSelect,
  onAction,
  onAutoStart,
}: {
  inst: InstanceStatus;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAction: (action: "start" | "stop" | "delete") => void;
  onAutoStart: (id: string, enabled: boolean) => void;
}) {
  const live = inst.state === "running" || inst.state === "starting";
  const autoId = `auto-${inst.id}`;

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        selected ? "border-primary/60 bg-primary/5" : "border-transparent hover:bg-accent/50",
      )}
    >
      {/* The row body selects; the controls below stop propagation. */}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className="flex w-full cursor-pointer items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", STATE_DOT[inst.state])} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{inst.label}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {inst.id} · :{inst.port}
            {live && inst.startedAt !== null ? ` · up ${uptime(inst.startedAt)}` : ""}
            {inst.state === "exited" ? ` · code ${inst.exitCode}` : ""}
          </span>
        </span>
        <Badge variant={STATE_VARIANT[inst.state]}>{inst.state}</Badge>
      </button>

      <div className="mt-2 flex items-center gap-1.5">
        {live ? (
          <Button size="sm" variant="destructive" className="flex-1" disabled={busy} onClick={() => onAction("stop")}>
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        ) : (
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => onAction("start")}>
            <Play className="h-3.5 w-3.5" /> Start
          </Button>
        )}
        <label
          htmlFor={autoId}
          className="flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-muted-foreground"
          title="Boot this instance automatically when the supervisor starts (e.g. after a host reboot)"
        >
          <Switch
            id={autoId}
            checked={inst.autoStart === true}
            disabled={busy}
            onChange={(e) => onAutoStart(inst.id, e.target.checked)}
          />
          auto
        </label>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${inst.id}`}
          title={live ? "Stop the server before deleting" : "Delete instance"}
          disabled={busy || live}
          onClick={() => onAction("delete")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CreateInstanceModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (next: InstanceStatus[]) => void;
}) {
  const [type, setType] = React.useState<ServerType>("world");
  const [id, setId] = React.useState("world_2");
  const [label, setLabel] = React.useState("World Server 2");
  const [port, setPort] = React.useState("5401");
  const [saving, setSaving] = React.useState(false);
  const formId = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { instances } = await post({
        action: "create",
        instance: { id, type, label, port: Number(port) },
      });
      if (instances) onCreated(instances);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Spawn new instance"
      description="Generates config/instances/<id>.json on start. Restart is not needed — the supervisor picks it up immediately."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? "Creating…" : "Create instance"}
          </Button>
        </>
      }
    >
      <form id={formId} className="grid gap-x-6 gap-y-5 sm:grid-cols-2" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="new-type">Type</Label>
          <Select id="new-type" value={type} onChange={(e) => setType(e.target.value as ServerType)}>
            <option value="world">world</option>
            <option value="cluster">cluster</option>
            <option value="login">login</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-id">Instance id</Label>
          <Input id="new-id" value={id} onChange={(e) => setId(e.target.value)} required />
          <p className="text-xs text-muted-foreground">Lowercase letters, digits, _ and - only.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-label">Label</Label>
          <Input id="new-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-port">Client-facing port</Label>
          <Input
            id="new-port"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            required
          />
        </div>
        {type === "world" && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground sm:col-span-2">
            A new world also needs a unique <code className="font-mono">registration.channelId</code> in its
            overrides, and its id added to the cluster&apos;s{" "}
            <code className="font-mono">registration.allowedWorlds</code> — otherwise the cluster rejects it.
          </p>
        )}
      </form>
    </Modal>
  );
}
