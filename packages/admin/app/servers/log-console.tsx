"use client";

/**
 * Live log console for one managed instance.
 *
 * Replaces the old squashed 26rem card at the bottom of the page: this fills the
 * viewport, colour-codes levels, folds pino's structured context behind a
 * per-line disclosure, and lets an operator filter by level or text without
 * scrolling a wall of monospace.
 */

import * as React from "react";
import {
  AlertTriangle,
  ArrowUpToLine,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Pause,
  Play,
  WrapText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/search-input";
import { cn } from "@/lib/utils";
import { FILTERABLE, parseLogLine, passesLevel, type LogLevel, type ParsedLine } from "@/lib/log-line";
import type { LogLine } from "./types";

/** Text + rail colour per level. Both clear 4.5:1 on `--p-card` either theme. */
const LEVEL_STYLE: Record<LogLevel, { text: string; rail: string; label: string }> = {
  fatal: { text: "text-destructive", rail: "bg-destructive", label: "FTL" },
  error: { text: "text-destructive", rail: "bg-destructive", label: "ERR" },
  warn: { text: "text-warning", rail: "bg-warning", label: "WRN" },
  info: { text: "text-success", rail: "bg-success", label: "INF" },
  debug: { text: "text-primary", rail: "bg-primary", label: "DBG" },
  trace: { text: "text-muted-foreground", rail: "bg-muted-foreground", label: "TRC" },
  system: { text: "text-primary", rail: "bg-primary", label: "SYS" },
  plain: { text: "text-muted-foreground", rail: "bg-transparent", label: "" },
};

interface Row {
  seq: number;
  raw: string;
  parsed: ParsedLine;
}

export function LogConsole({ id, state }: { id: string | null; state?: string }) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [follow, setFollow] = React.useState(true);
  const [wrap, setWrap] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [levels, setLevels] = React.useState<ReadonlySet<LogLevel>>(new Set());
  const [clearing, setClearing] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setRows([]);
    if (!id) return;
    // Seq is monotonic per daemon, so it doubles as a dedupe key: EventSource
    // reconnects replay from the start of the ring.
    let lastSeq = 0;
    const es = new EventSource(`/api/servers/${id}/logs`);
    es.onmessage = (ev) => {
      const l = JSON.parse(ev.data) as LogLine;
      if (l.seq <= lastSeq) return;
      lastSeq = l.seq;
      const row: Row = { seq: l.seq, raw: l.line, parsed: parseLogLine(l.line) };
      setRows((prev) => (prev.length > 1500 ? [...prev.slice(-1200), row] : [...prev, row]));
    };
    return () => es.close();
  }, [id]);

  // Newest first — the line you want is the one that just arrived, so it sits
  // where the eye already is instead of below a scrolling wall.
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = rows.filter(
      (r) => passesLevel(r.parsed, levels) && (q === "" || r.raw.toLowerCase().includes(q)),
    );
    kept.reverse();
    return kept;
  }, [rows, levels, query]);

  // Autoscroll after the filtered list paints, not after the raw list changes —
  // otherwise a hidden line scrolls the box while the operator reads. "Live" is
  // the top of the box now, so following means pinning scrollTop to 0.
  React.useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = 0;
  }, [visible, follow]);

  const errorCount = rows.filter(
    (r) => r.parsed.level === "error" || r.parsed.level === "fatal",
  ).length;
  const warnCount = rows.filter((r) => r.parsed.level === "warn").length;

  const toggleLevel = (lvl: LogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });

  /** Display order is newest-first; a copied/saved log reads chronologically. */
  const exportText = (): string =>
    visible
      .map((r) => r.raw)
      .reverse()
      .join("\n");

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(exportText());
      toast.success(`Copied ${visible.length} lines`);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const download = () => {
    const blob = new Blob([exportText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id ?? "server"}-log.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Clear the daemon's buffer, not just this component's copy.
   *
   * Clearing local state only looked like it worked until the next reload or
   * instance switch, when the stream replayed the ring from seq 0.
   */
  const clear = async () => {
    if (!id) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/servers/${id}/logs`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Clear failed");
      }
      setRows([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Toolbar — one row on desktop, wraps on narrow. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1" role="group" aria-label="Filter by log level">
          {FILTERABLE.map((lvl) => {
            const on = levels.has(lvl);
            return (
              <button
                key={lvl}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLevel(lvl)}
                className={cn(
                  "cursor-pointer rounded-md border px-2 py-1 font-mono text-[11px] font-semibold uppercase transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  on
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {lvl}
              </button>
            );
          })}
        </div>

        <SearchInput
          className="min-w-[10rem] flex-1"
          placeholder="Filter lines…"
          aria-label="Filter log lines by text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={follow ? "secondary" : "outline"}
            onClick={() => setFollow((f) => !f)}
            aria-pressed={follow}
          >
            {follow ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {follow ? "Following" : "Paused"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={wrap ? "Disable line wrapping" : "Enable line wrapping"}
            aria-pressed={wrap}
            title={wrap ? "Wrapping on" : "Wrapping off"}
            onClick={() => setWrap((w) => !w)}
          >
            <WrapText className={cn("h-4 w-4", !wrap && "opacity-40")} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Copy visible lines" title="Copy" onClick={copyAll}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Download visible lines" title="Download" onClick={download}>
            <Download className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Clear log buffer"
            title="Clear buffer (server-side, persists across reloads)"
            disabled={id === null || clearing}
            onClick={() => void clear()}
          >
            <Eraser className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Log body — the page's tallest element, not a 26rem letterbox. */}
      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        aria-label="Server log output"
        tabIndex={0}
        onScroll={(e) => {
          // Live = pinned to the top, since newest is first.
          const atTop = e.currentTarget.scrollTop < 24;
          if (!atTop && follow) setFollow(false);
        }}
        className="min-h-0 flex-1 overflow-auto bg-muted/40 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {id === null
              ? "Select an instance to stream its output."
              : rows.length === 0
                ? state === "running"
                  ? "Connected — waiting for output."
                  : "No output yet. Start the server to see logs."
                : "No lines match the current filter."}
          </p>
        ) : (
          visible.map((r) => <LogRow key={r.seq} row={r} wrap={wrap} />)
        )}
      </div>

      {/* Status bar — counts, and a jump-back-to-live affordance. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">
          {visible.length}
          {visible.length !== rows.length ? ` / ${rows.length}` : ""} lines
        </span>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="h-3 w-3" /> {errorCount} error{errorCount === 1 ? "" : "s"}
          </span>
        )}
        {warnCount > 0 && <span className="font-medium text-warning">{warnCount} warnings</span>}
        <div className="flex-1" />
        {!follow && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setFollow(true)}>
            <ArrowUpToLine className="h-3 w-3" /> Jump to live
          </Button>
        )}
      </div>
    </div>
  );
}

function LogRow({ row, wrap }: { row: Row; wrap: boolean }) {
  const [open, setOpen] = React.useState(false);
  const s = LEVEL_STYLE[row.parsed.level];
  const { time, module, message, detail } = row.parsed;

  return (
    <div className="border-b border-border/40 last:border-0 hover:bg-accent/40">
      <div className="flex items-start gap-2 px-3 py-1">
        <span aria-hidden="true" className={cn("mt-1.5 h-3 w-0.5 shrink-0 rounded-full", s.rail)} />
        <span className="w-[5.5rem] shrink-0 tabular-nums text-muted-foreground">{time ?? ""}</span>
        <span className={cn("w-8 shrink-0 font-semibold", s.text)}>{s.label}</span>
        {module !== null && (
          <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] leading-5 text-muted-foreground">
            {module}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 text-foreground", wrap ? "whitespace-pre-wrap break-all" : "truncate")}>
          {message}
        </span>
        {detail !== null && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
            <span className="sr-only">Toggle structured context</span>
          </button>
        )}
      </div>
      {open && detail !== null && (
        <pre className="ml-[7.5rem] mb-1.5 mr-3 overflow-auto rounded-md border border-border bg-card p-2 text-[11px] text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}
