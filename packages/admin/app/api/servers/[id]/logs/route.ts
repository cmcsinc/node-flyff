import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { clearInstanceLogs, getLogs, isValidInstanceId, type LogLine } from '@/lib/server-manager';

export const dynamic = 'force-dynamic';

/** Backoff after a failed daemon read, so a dead daemon isn't hammered. */
const RETRY_MS = 1_000;

/**
 * GET /api/servers/<id>/logs — Server-Sent Events stream of that instance's
 * stdout/stderr.
 *
 * Logs live in the supervisor daemon (a separate process), so this reads its
 * `/logs?since=<seq>&wait=1` cursor. `wait=1` long-polls: the daemon holds the
 * request until a line is written (or 20s passes), so output reaches the browser
 * on write rather than on a fixed poll tick. Reading a cursor (rather than
 * subscribing in-process) is also what lets the stream pick up output produced
 * while the admin app was down.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!isValidInstanceId(id as unknown)) return new Response('Invalid id', { status: 400 });

  const encoder = new TextEncoder();
  const state: { closed: boolean } = { closed: false };
  const isClosed = (): boolean => state.closed;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      const write = (frame: string): boolean => {
        try {
          controller.enqueue(encoder.encode(frame));
          return true;
        } catch {
          state.closed = true;
          return false;
        }
      };

      let since = 0;
      // First read is non-waiting so the client paints the existing buffer at
      // once; every read after that long-polls for the next line.
      let wait = false;
      while (!isClosed()) {
        try {
          const startedAt = Date.now();
          const lines: LogLine[] = await getLogs(id, since, wait);
          if (isClosed()) break;
          for (const l of lines) {
            since = Math.max(since, l.seq);
            if (!write(`data: ${JSON.stringify(l)}\n\n`)) break;
          }
          // Comment frame on an empty long-poll — keeps proxies from closing an
          // idle stream and detects a client that went away.
          if (lines.length === 0 && wait && !write(': ping\n\n')) break;
          wait = true;
          // A waiting read is meant to block (the daemon holds it up to 20s). If
          // it came back empty in a blink the daemon is unreachable -- `getLogs`
          // reports that as `[]`, not a throw, so the catch-block backoff below
          // never fires and the loop would spin flat-out. Floor the interval.
          if (lines.length === 0 && Date.now() - startedAt < RETRY_MS) {
            await new Promise((r) => setTimeout(r, RETRY_MS));
          }
        } catch {
          if (!write(': retry\n\n')) break;
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel(): void {
      state.closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * DELETE /api/servers/<id>/logs — clears the daemon's buffer for that instance.
 *
 * Server-side because the daemon's ring is the source of truth: clearing only
 * the browser's copy comes back on the next reload or instance switch.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;
  if (!isValidInstanceId(id as unknown)) return new Response('Invalid id', { status: 400 });

  const res = await clearInstanceLogs(id);
  if ('error' in res) return Response.json({ error: res.error }, { status: 502 });
  return Response.json({ ok: true });
}
