"use client";

import * as React from "react";
import { toast } from "sonner";
import { Play, Square, Trash2, Plus, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ServerType } from "@/lib/config-fields";
import { cn } from "@/lib/utils";
import { ConfigEditor } from "./config-editor";
import { post, type InstanceStatus, type LogLine, type RunState } from "./types";

const STATE_VARIANT: Record<RunState, "success" | "warning" | "outline" | "destructive"> = {
  running: "success",
  starting: "warning",
  stopped: "outline",
  exited: "destructive",
};

export function ServerManager({ initial }: { initial: InstanceStatus[] }) {
  const [instances, setInstances] = React.useState(initial);
  const [selected, setSelected] = React.useState<string | null>(initial[0]?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);

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

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <div className="space-y-3">
          {instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              selected={inst.id === selected}
              busy={busy === inst.id}
              onSelect={() => setSelected(inst.id)}
              onAction={act}
              onAutoStart={setAutoStart}
            />
          ))}
          {instances.length === 0 && (
            <p className="text-sm text-muted-foreground">No instances registered yet.</p>
          )}
        </div>
        <CreateInstanceForm
          onCreated={(next) => {
            setInstances(next);
            toast.success("Instance created");
          }}
        />
      </div>

      <div className="space-y-4">
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
        <LogViewer id={selected} />
      </div>
    </div>
  );
}

function InstanceCard({
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
  onAction: (action: "start" | "stop" | "delete", id: string) => void;
  onAutoStart: (id: string, enabled: boolean) => void;
}) {
  const live = inst.state === "running" || inst.state === "starting";
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors",
        selected ? "border-primary/60" : "hover:border-border/80",
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="truncate">{inst.label}</span>
              <Badge variant={STATE_VARIANT[inst.state]}>{inst.state}</Badge>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              {inst.id} · {inst.type} · :{inst.port}
              {inst.pid !== null && live ? ` · pid ${inst.pid}` : ""}
              {inst.state === "exited" ? ` · code ${inst.exitCode}` : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <label
              className="mr-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
              title="Boot this instance automatically when the supervisor starts (e.g. after a host reboot)"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={inst.autoStart === true}
                disabled={busy}
                onChange={(e) => onAutoStart(inst.id, e.target.checked)}
              />
              auto
            </label>
            {live ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => onAction("stop", inst.id)}>
                <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => onAction("start", inst.id)}>
                <Play className="mr-1.5 h-3.5 w-3.5" /> Start
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${inst.id}`}
              disabled={busy || live}
              onClick={() => onAction("delete", inst.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function CreateInstanceForm({ onCreated }: { onCreated: (next: InstanceStatus[]) => void }) {
  const [type, setType] = React.useState<ServerType>("world");
  const [id, setId] = React.useState("world_2");
  const [label, setLabel] = React.useState("World Server 2");
  const [port, setPort] = React.useState("5401");
  const [saving, setSaving] = React.useState(false);

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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4" /> Spawn new instance
        </CardTitle>
        <CardDescription>Generates config/instances/&lt;id&gt;.json on start</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-label">Label</Label>
            <Input id="new-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-port">Port</Label>
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
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              Create
            </Button>
          </div>
        </form>
        {type === "world" && (
          <p className="mt-3 text-xs text-muted-foreground">
            A new world also needs a unique <code className="font-mono">registration.channelId</code> in its
            overrides, and its id added to the cluster&apos;s{" "}
            <code className="font-mono">registration.allowedWorlds</code> — otherwise the cluster rejects it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}


function LogViewer({ id }: { id: string | null }) {
  const [lines, setLines] = React.useState<LogLine[]>([]);
  const [follow, setFollow] = React.useState(true);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setLines([]);
    if (!id) return;
    const es = new EventSource(`/api/servers/${id}/logs`);
    es.onmessage = (ev) => {
      const l = JSON.parse(ev.data) as LogLine;
      setLines((prev) => (prev.length > 800 ? [...prev.slice(-600), l] : [...prev, l]));
    };
    return () => es.close();
  }, [id]);

  React.useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, follow]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Terminal className="h-4 w-4" /> Live logs {id ? `— ${id}` : ""}
            </CardTitle>
            <CardDescription>{lines.length} lines buffered</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setFollow((f) => !f)}>
              {follow ? "Pause follow" : "Follow"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLines([])}>
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={boxRef}
          role="log"
          aria-live="polite"
          aria-label="Server log output"
          className="h-[26rem] overflow-auto rounded-lg border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground">
              {id ? "No output yet — start the server." : "Select an instance."}
            </p>
          ) : (
            lines.map((l) => (
              <div key={l.seq} className="whitespace-pre-wrap break-all">
                {l.line}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
