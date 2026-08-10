/** Shared client-side types + fetch helper for the server-manager page. */

import type { ServerType } from '@/lib/config-fields';

import { responseStatus } from '@/lib/api-response';

export type RunState = 'stopped' | 'starting' | 'running' | 'exited';

export interface InstanceStatus {
  id: string;
  type: ServerType;
  label: string;
  port: number;
  /** Boot with the supervisor daemon (survives host reboot). */
  autoStart?: boolean;
  overrides?: Record<string, unknown>;
  /** Merge without overrides — rendered as form placeholders. */
  inherited?: Record<string, unknown>;
  /** Full merged config the process boots with. */
  effective?: Record<string, unknown>;
  state: RunState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
}

export interface LogLine {
  seq: number;
  ts: number;
  line: string;
}

export async function post(body: unknown): Promise<{ instances?: InstanceStatus[] }> {
  const res = await fetch('/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const { ok, error } = await responseStatus(res);
  if (!res.ok) throw new Error(error ?? `Request failed (${String(res.status)})`);
  const json: unknown = await res.json().catch(() => ({}));
  if (typeof json !== 'object' || json === null || !ok) throw new Error(error ?? 'Unknown error');
  const instances =
    'instances' in json && Array.isArray(json.instances)
      ? (json.instances as InstanceStatus[])
      : undefined;
  return { instances };
}
