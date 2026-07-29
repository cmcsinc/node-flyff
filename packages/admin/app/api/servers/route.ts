import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getStatuses,
  listInstances,
  saveInstances,
  startInstance,
  stopInstance,
  isRunning,
  isValidInstanceId,
  type ServerInstance,
  type ServerType,
} from "@/lib/server-manager";

export const dynamic = "force-dynamic";

const TYPES: ServerType[] = ["login", "cluster", "world"];

/** GET /api/servers — status of every registered instance. */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ instances: await getStatuses() });
}

/**
 * POST /api/servers — actions.
 *  { action: "start"|"stop", id }
 *  { action: "create", instance: ServerInstance }
 *  { action: "delete", id }
 *  { action: "update", id, patch: Partial<ServerInstance> }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: unknown = await req.json();
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { action, id } = body as { action?: string; id?: string };

  if (action === "start" || action === "stop") {
    if (!isValidInstanceId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const res = action === "start" ? await startInstance(id) : await stopInstance(id);
    if ("error" in res) return NextResponse.json(res, { status: 409 });
    return NextResponse.json({ ok: true, instances: await getStatuses() });
  }

  if (action === "create") {
    const raw = (body as { instance?: unknown }).instance;
    const parsed = parseInstance(raw);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
    const instances = listInstances();
    if (instances.some((i) => i.id === parsed.instance.id)) {
      return NextResponse.json({ error: "Instance id already exists" }, { status: 409 });
    }
    const portClash = instances.find((i) => i.port === parsed.instance.port);
    if (portClash) {
      return NextResponse.json(
        { error: `Port ${parsed.instance.port} already used by ${portClash.id}` },
        { status: 409 },
      );
    }
    saveInstances([...instances, parsed.instance]);
    return NextResponse.json({ ok: true, instances: await getStatuses() });
  }

  if (action === "delete") {
    if (!isValidInstanceId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (await isRunning(id)) return NextResponse.json({ error: "Stop the server first" }, { status: 409 });
    saveInstances(listInstances().filter((i) => i.id !== id));
    return NextResponse.json({ ok: true, instances: await getStatuses() });
  }

  if (action === "update") {
    if (!isValidInstanceId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (await isRunning(id)) {
      return NextResponse.json({ error: "Stop the server before editing config" }, { status: 409 });
    }
    const patch = (body as { patch?: unknown }).patch;
    if (typeof patch !== "object" || patch === null) {
      return NextResponse.json({ error: "Invalid patch" }, { status: 400 });
    }
    const instances = listInstances();
    const idx = instances.findIndex((i) => i.id === id);
    if (idx < 0) return NextResponse.json({ error: "Unknown instance" }, { status: 404 });
    const merged = { ...instances[idx], ...(patch as Partial<ServerInstance>), id, type: instances[idx].type };
    const parsed = parseInstance(merged);
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
    instances[idx] = parsed.instance;
    saveInstances(instances);
    return NextResponse.json({ ok: true, instances: await getStatuses() });
  }

  if (action === "autostart") {
    if (!isValidInstanceId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const enabled = (body as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const instances = listInstances();
    const idx = instances.findIndex((i) => i.id === id);
    if (idx < 0) return NextResponse.json({ error: "Unknown instance" }, { status: 404 });
    // Deliberately allowed while running — it only affects the next daemon boot.
    instances[idx] = { ...instances[idx], autoStart: enabled };
    saveInstances(instances);
    return NextResponse.json({ ok: true, instances: await getStatuses() });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** Validates an untrusted instance descriptor from the client. */
function parseInstance(raw: unknown): { instance: ServerInstance } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "Missing instance" };
  const { id, type, label, port, autoStart, overrides } = raw as Record<string, unknown>;
  if (!isValidInstanceId(id)) {
    return { error: "id must be 2-32 chars, alphanumeric/dash/underscore" };
  }
  if (typeof type !== "string" || !TYPES.includes(type as ServerType)) {
    return { error: "type must be login | cluster | world" };
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return { error: "port must be an integer 1024-65535" };
  }
  if (typeof label !== "string" || label.length < 1 || label.length > 64) {
    return { error: "label must be 1-64 chars" };
  }
  if (autoStart !== undefined && typeof autoStart !== "boolean") {
    return { error: "autoStart must be a boolean" };
  }
  if (overrides !== undefined && (typeof overrides !== "object" || overrides === null || Array.isArray(overrides))) {
    return { error: "overrides must be an object" };
  }
  return {
    instance: {
      id,
      type: type as ServerType,
      label,
      port,
      ...(autoStart === undefined ? {} : { autoStart }),
      ...(overrides ? { overrides: overrides as Record<string, unknown> } : {}),
    },
  };
}
