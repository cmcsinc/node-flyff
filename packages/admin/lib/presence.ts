/**
 * Live-session presence helpers.
 *
 * The world upserts an `online_players` row on JOIN, deletes it on disconnect,
 * and bumps `last_seen_ms` from its 30 s checkpoint. A row can therefore survive
 * a world crash, so "online" is a freshness window rather than row existence.
 *
 * @module lib/presence
 */

import { db } from '@/lib/db';
import { onlinePlayers } from '@/../drizzle/schema';
import { gt } from 'drizzle-orm';

/**
 * Staleness window. Must be > the world's 30 s checkpoint interval (which bumps
 * `last_seen_ms`) so a healthy session never flickers offline; 60 s gives one
 * missed checkpoint of slack.
 */
export const PRESENCE_STALE_MS = 60_000;

/** True when this presence row was refreshed inside the freshness window. */
export function isOnline(row: { lastSeenMs: number } | null | undefined): boolean {
  if (!row) return false;
  return row.lastSeenMs > Date.now() - PRESENCE_STALE_MS;
}

/** Character ids with a fresh presence row. Empty set when the world is down. */
export async function getOnlineCharacterIds(): Promise<Set<number>> {
  const rows = await db
    .select({ characterId: onlinePlayers.characterId })
    .from(onlinePlayers)
    .where(gt(onlinePlayers.lastSeenMs, Date.now() - PRESENCE_STALE_MS));
  return new Set(rows.map((r) => r.characterId));
}
