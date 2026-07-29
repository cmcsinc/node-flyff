/**
 * Supervisor daemon — owns the game-server child processes.
 *
 * Runs as its own detached process, so restarting (or killing) the Next.js
 * admin app leaves the login/cluster/world servers running. The admin app talks
 * to it over a loopback HTTP API guarded by a shared token in
 * `data/supervisor.token`.
 *
 * Boot:   node --import tsx packages/admin/lib/supervisor-daemon.ts
 *         (normally spawned for you by supervisor-client.ensureDaemon())
 *
 * API (all require `x-supervisor-token`):
 *   GET  /health                      → { ok, pid, startedAt }
 *   GET  /status                      → { procs: Record<id, ProcStatus> }
 *   GET  /logs?id=<id>&since=<seq>    → { lines: LogLine[] }
 *   POST /start  { id, type, configFile, env? }
 *   POST /stop   { id, graceMs? }
 *   POST /shutdown                    → stops all children, then exits
 *
 * ponytail: single-host supervisor, no auto-restart of crashed children, no
 * restart of the daemon itself on host reboot. Upgrade path = register this
 * entry with pm2 / systemd / a Windows service and drop ensureDaemon().
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import {
  AUTH_HEADER,
  DEFAULT_PORT,
  ENTRY,
  LOG_DIR,
  ROOT,
  isValidInstanceId,
  loadDotEnv,
  parseSpawnRequest,
  pushRing,
  readOrCreateToken,
  stripAnsi,
  tokensMatch,
  writeHandle,
  type LogLine,
  type ProcStatus,
} from './supervisor-shared';
// Registry + config generation only — never the client half (that would make
// the daemon call its own HTTP API).
import { listInstances, writeInstanceConfig } from './server-manager';

interface Running {
  child: ChildProcess;
  state: ProcStatus['state'];
  startedAt: number;
  exitCode: number | null;
  logFile: WriteStream;
}

const TOKEN = readOrCreateToken();
const procs = new Map<string, Running>();
const logs = new Map<string, LogLine[]>();
let seq = 0;

mkdirSync(LOG_DIR, { recursive: true });

function pushLog(id: string, raw: string): void {
  const ring = logs.get(id) ?? [];
  for (const line of stripAnsi(raw).split(/\r?\n/)) {
    if (!line.length) continue;
    pushRing(ring, { seq: ++seq, ts: Date.now(), line });
    procs.get(id)?.logFile.write(`${new Date().toISOString()} ${line}\n`);
  }
  logs.set(id, ring);
}

function statusOf(id: string): ProcStatus {
  const run = procs.get(id);
  if (!run) return { state: 'stopped', pid: null, startedAt: null, exitCode: null };
  return {
    state: run.state,
    pid: run.child.pid ?? null,
    startedAt: run.startedAt,
    exitCode: run.exitCode,
  };
}

function allStatuses(): Record<string, ProcStatus> {
  const out: Record<string, ProcStatus> = {};
  for (const id of procs.keys()) out[id] = statusOf(id);
  return out;
}

function isRunning(id: string): boolean {
  const run = procs.get(id);
  return run !== undefined && (run.state === 'running' || run.state === 'starting');
}

function start(body: unknown): { status: ProcStatus } | { error: string } {
  const parsed = parseSpawnRequest(body);
  if ('error' in parsed) return parsed;
  const { id, type, configFile, env: extra } = parsed.req;
  if (isRunning(id)) return { error: `${id} is already running` };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...loadDotEnv(),
    ...extra,
    CONFIG_FILE: configFile,
    SERVER_ID: id,
    LOG_PRETTY: '1',
  };
  if (!env.DB_FILENAME) env.DB_FILENAME = './data/flyff_dev.sqlite3';

  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY[type]], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // The daemon itself has no console (it is spawned DETACHED), so without
    // this Windows allocates a fresh console for every child — an empty black
    // window per game server, since their stdio is piped here.
    windowsHide: true,
  });

  const run: Running = {
    child,
    state: 'starting',
    startedAt: Date.now(),
    exitCode: null,
    logFile: createWriteStream(resolve(LOG_DIR, `${id}.log`), { flags: 'a' }),
  };
  procs.set(id, run);
  pushLog(id, `[supervisor] spawned pid=${child.pid ?? '?'} config=${configFile}`);

  child.stdout?.on('data', (c: Buffer) => {
    if (run.state === 'starting') run.state = 'running';
    pushLog(id, c.toString());
  });
  child.stderr?.on('data', (c: Buffer) => pushLog(id, c.toString()));
  child.on('error', (err) => pushLog(id, `[supervisor] spawn error: ${err.message}`));
  child.on('exit', (code, signal) => {
    run.state = 'exited';
    run.exitCode = code;
    pushLog(id, `[supervisor] exited code=${code} signal=${signal ?? 'none'}`);
    run.logFile.end();
  });

  return { status: statusOf(id) };
}

function stop(id: string, graceMs: number): { ok: true } | { error: string } {
  const run = procs.get(id);
  if (!run || run.state === 'exited') return { error: `${id} is not running` };
  pushLog(id, '[supervisor] stopping…');
  run.child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (run.state !== 'exited') {
      pushLog(id, '[supervisor] grace expired — SIGKILL');
      run.child.kill('SIGKILL');
    }
  }, graceMs);
  timer.unref();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

function send(res: ServerResponse, code: number, payload: unknown): void {
  const buf = Buffer.from(JSON.stringify(payload));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': buf.length });
  res.end(buf);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('Body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown;
}

const server = createServer((req, res) => {
  void handle(req, res).catch((err: unknown) =>
    send(res, 400, { error: err instanceof Error ? err.message : 'Bad request' }),
  );
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!tokensMatch(req.headers[AUTH_HEADER], TOKEN)) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true, pid: process.pid, startedAt: STARTED_AT });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    send(res, 200, { procs: allStatuses() });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/logs') {
    const id = url.searchParams.get('id');
    if (!isValidInstanceId(id)) {
      send(res, 400, { error: 'Invalid id' });
      return;
    }
    const since = Number(url.searchParams.get('since') ?? 0);
    const ring = logs.get(id) ?? [];
    send(res, 200, { lines: Number.isFinite(since) ? ring.filter((l) => l.seq > since) : ring });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/start') {
    const out = start(await readBody(req));
    send(res, 'error' in out ? 409 : 200, out);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/stop') {
    const body = (await readBody(req)) as { id?: unknown; graceMs?: unknown };
    if (!isValidInstanceId(body.id)) {
      send(res, 400, { error: 'Invalid id' });
      return;
    }
    const grace = typeof body.graceMs === 'number' && body.graceMs > 0 ? body.graceMs : 4000;
    const out = stop(body.id, grace);
    send(res, 'error' in out ? 409 : 200, out);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/shutdown') {
    send(res, 200, { ok: true });
    for (const id of procs.keys()) stop(id, 2000);
    setTimeout(() => process.exit(0), 3000).unref();
    return;
  }
  send(res, 404, { error: 'Not found' });
}

const STARTED_AT = Date.now();

/**
 * Boots every instance flagged `autoStart` in `config/instances.json`.
 *
 * This is what makes the servers come back after a host reboot: a service
 * manager only has to start THIS process, and it repopulates its own children.
 * Failures are logged, never fatal — one bad instance must not stop the rest.
 */
function autoStartInstances(): void {
  for (const inst of listInstances()) {
    if (inst.autoStart !== true) continue;
    try {
      const res = start({
        id: inst.id,
        type: inst.type,
        configFile: writeInstanceConfig(inst),
      });
      process.stdout.write(
        'error' in res
          ? `[supervisor] autostart ${inst.id} failed: ${res.error}\n`
          : `[supervisor] autostart ${inst.id} pid=${res.status.pid}\n`,
      );
    } catch (err) {
      process.stdout.write(
        `[supervisor] autostart ${inst.id} threw: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

server.listen(DEFAULT_PORT, '127.0.0.1', () => {
  writeHandle({ pid: process.pid, port: DEFAULT_PORT, startedAt: STARTED_AT });
  process.stdout.write(`[supervisor] listening on 127.0.0.1:${DEFAULT_PORT} pid=${process.pid}\n`);
  autoStartInstances();
});

// A supervisor that dies on SIGINT would take its children with it, which is
// the exact failure this daemon exists to prevent — so only an explicit
// /shutdown or SIGTERM tears everything down.
process.on('SIGTERM', () => {
  for (const id of procs.keys()) stop(id, 2000);
  setTimeout(() => process.exit(0), 3000).unref();
});
process.on('SIGINT', () => {
  process.stdout.write('[supervisor] SIGINT ignored — POST /shutdown to stop\n');
});
