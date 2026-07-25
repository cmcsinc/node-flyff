/**
 * TaskBarService -- taskbar hotkey binding (add/remove shortcut) + action-slot
 * queue upload + persistence.
 *
 * Ports `CDPSrvr::OnAddItemTaskBar` / `OnRemoveItemTaskBar`
 * (`WORLDSERVER/DPSrvr.cpp:2203/2251`) for the F1-F9 grid and
 * `CDPSrvr::OnSkillTaskBar` (`DPSrvr.cpp:2141`) for the action-slot queue
 * (`m_aSlotQueue[5]`). Fire-and-forget persists both to `characters.taskbar`
 * (migration 009, JSON v2 shape). C++ saves on logout
 * (`DbManagerSave.cpp:SaveTaskBar`); we write through on every change instead
 * -- a drag/queue-edit is user-paced (rare) and a crash between logout saves
 * would otherwise lose the session's bindings. Low-stakes UI state, so no WAL
 * journal entry (rule 04 lists items/gold/exp/SP/quest/trade; taskbar is not
 * among them).
 *
 * Chat-macro cap: C++ counts existing `SHORTCUT_CHAT` slots and rejects an add
 * that would push past 10 (`if (nchatshortcut > 9) return`). The check counts
 * the CURRENT grid (the new binding is not yet written), so re-binding one of
 * the 10 existing chat slots is also rejected -- a vanilla quirk we match.
 *
 * @module services/taskbar
 */

import { createLogger } from '@flyff/core/logger';
import type { Shortcut } from '@flyff/entities';
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SLOT_QUEUE, MAX_SHORTCUT_CHAT } from '@flyff/world-core';

const logger = createLogger({ module: 'taskbar-service' });

/**
 * Persist hook -- `compose.ts` wires this to `charRepo.update(id, { taskbar })`.
 * Optional so unit tests can exercise the grid logic with no DB.
 */
export type TaskBarPersist = (charId: number, json: string) => Promise<void>;

export type AddShortcutResult =
  | { ok: true }
  | { ok: false; reason: 'too_many_chat' };

/** Player shape this service needs -- grid + queue + an optional id for persist. */
interface TaskBarPlayer {
  m_idPlayer?: number;
  m_aSlotItem: Shortcut[][];
  m_aSlotQueue: Shortcut[];
}

/** One non-empty grid slot, positioned -- the v1 / v2 `items` JSON shape. */
interface StoredShortcut {
  i: number;
  j: number;
  dwShortcut: number;
  dwId: number;
  dwType: number;
  dwIndex: number;
  dwUserId: number;
  dwData: number;
  szString?: string;
}

/** One non-empty queue slot, positioned -- the v2 `queue` JSON shape. */
interface StoredQueueShortcut {
  i: number;
  dwShortcut: number;
  dwId: number;
  dwType: number;
  dwIndex: number;
  dwUserId: number;
  dwData: number;
}

/** v2 envelope: `{ v: 2, items: [...], queue: [...] }`. */
interface TaskBarBlobV2 {
  v: 2;
  items: StoredShortcut[];
  queue: StoredQueueShortcut[];
}

/**
 * Build the non-empty items entries for the grid (matches C++ `SaveTaskBar`
 * skipping `SHORTCUT_NONE`).
 */
function collectItems(grid: ReadonlyArray<ReadonlyArray<Shortcut>>): StoredShortcut[] {
  const out: StoredShortcut[] = [];
  for (let i = 0; i < MAX_SLOT_ITEM_COUNT && i < grid.length; i++) {
    const row = grid[i]!;
    for (let j = 0; j < MAX_SLOT_ITEM && j < row.length; j++) {
      const s = row[j]!;
      if (s.dwShortcut === SHORTCUT.NONE) continue;
      const entry: StoredShortcut = {
        i, j,
        dwShortcut: s.dwShortcut, dwId: s.dwId, dwType: s.dwType,
        dwIndex: s.dwIndex, dwUserId: s.dwUserId, dwData: s.dwData,
      };
      if (s.dwShortcut === SHORTCUT.CHAT && s.szString !== undefined) entry.szString = s.szString;
      out.push(entry);
    }
  }
  return out;
}

function collectQueue(queue: ReadonlyArray<Shortcut>): StoredQueueShortcut[] {
  const out: StoredQueueShortcut[] = [];
  for (let i = 0; i < MAX_SLOT_QUEUE && i < queue.length; i++) {
    const s = queue[i]!;
    if (s.dwShortcut === SHORTCUT.NONE) continue;
    out.push({
      i,
      dwShortcut: s.dwShortcut, dwId: s.dwId, dwType: s.dwType,
      dwIndex: s.dwIndex, dwUserId: s.dwUserId, dwData: s.dwData,
    });
  }
  return out;
}

/**
 * Encode grid + queue as the `characters.taskbar` JSON column (v2 envelope).
 * Empty queue collapses to an empty `queue: []`. Only non-empty slots ship.
 */
export function encodeTaskBar(
  grid: ReadonlyArray<ReadonlyArray<Shortcut>>,
  queue: ReadonlyArray<Shortcut> = [],
): string {
  const blob: TaskBarBlobV2 = { v: 2, items: collectItems(grid), queue: collectQueue(queue) };
  return JSON.stringify(blob);
}

function emptyGrid(): Shortcut[][] {
  return Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
    Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 })),
  );
}

function emptyQueue(): Shortcut[] {
  return Array.from({ length: MAX_SLOT_QUEUE }, () => ({ dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 }));
}

/**
 * Parse the `characters.taskbar` column into the v2 envelope, accepting both
 * the legacy v1 shape (bare array of item entries -- queue empty) and the
 * current v2 object. Bad/out-of-range rows are dropped defensively.
 * `null`/empty/unreadable yields an all-empty blob (fresh character).
 */
function parseTaskBar(json: string | null | undefined): TaskBarBlobV2 {
  if (!json) return { v: 2, items: [], queue: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    logger.warn({ json }, 'taskbar column unreadable -- ignoring');
    return { v: 2, items: [], queue: [] };
  }
  if (Array.isArray(parsed)) return { v: 2, items: parsed as StoredShortcut[], queue: [] };
  if (typeof parsed === 'object' && parsed !== null && (parsed as { v?: number }).v === 2) {
    return parsed as TaskBarBlobV2;
  }
  return { v: 2, items: [], queue: [] };
}

/**
 * Decode the `characters.taskbar` column into a fresh item grid. Mirrors C++
 * `GetTaskBar` (`DbManagerFun.cpp:984`); out-of-range entries are dropped.
 */
export function decodeTaskBar(json: string | null | undefined): Shortcut[][] {
  const grid = emptyGrid();
  for (const e of parseTaskBar(json).items) {
    if (typeof e !== 'object' || e === null) continue;
    if (e.i < 0 || e.i >= MAX_SLOT_ITEM_COUNT || e.j < 0 || e.j >= MAX_SLOT_ITEM) continue;
    const slot: Shortcut = {
      dwShortcut: e.dwShortcut | 0, dwId: e.dwId | 0, dwType: e.dwType | 0,
      dwIndex: e.dwIndex | 0, dwUserId: e.dwUserId | 0, dwData: e.dwData | 0,
    };
    if (e.dwShortcut === SHORTCUT.CHAT && typeof e.szString === 'string') slot.szString = e.szString;
    grid[e.i]![e.j] = slot;
  }
  return grid;
}

/**
 * Decode the action-slot queue from the same `characters.taskbar` column.
 * Legacy v1 rows (queue absent) yield an all-empty queue. Out-of-range
 * indexes are dropped defensively.
 */
export function decodeTaskBarQueue(json: string | null | undefined): Shortcut[] {
  const queue = emptyQueue();
  for (const e of parseTaskBar(json).queue) {
    if (typeof e !== 'object' || e === null) continue;
    if (e.i < 0 || e.i >= MAX_SLOT_QUEUE) continue;
    queue[e.i] = {
      dwShortcut: e.dwShortcut | 0, dwId: e.dwId | 0, dwType: e.dwType | 0,
      dwIndex: e.dwIndex | 0, dwUserId: e.dwUserId | 0, dwData: e.dwData | 0,
    };
  }
  return queue;
}

export class TaskBarService {
  constructor(private readonly persist?: TaskBarPersist) {}

  /** Count currently-bound chat-macro shortcuts across the whole grid. */
  private countChat(player: TaskBarPlayer): number {
    let n = 0;
    for (const row of player.m_aSlotItem) {
      for (const slot of row) {
        if (slot.dwShortcut === SHORTCUT.CHAT) n++;
      }
    }
    return n;
  }

  /** Fire-and-forget write-through of grid + queue (rule 05 -- no unhandled rejection). */
  private save(player: TaskBarPlayer): void {
    if (!this.persist || player.m_idPlayer === undefined) return;
    void this.persist(player.m_idPlayer, encodeTaskBar(player.m_aSlotItem, player.m_aSlotQueue)).catch((err) =>
      logger.error({ err, charId: player.m_idPlayer }, 'taskbar persist failed'),
    );
  }

  /**
   * Bind `shortcut` into `[slotIndex][index]`. Rejects a chat-macro add when
   * the grid already holds more than {@link MAX_SHORTCUT_CHAT} of them (C++
   * `OnAddItemTaskBar:2231`). On reject the slot is left untouched.
   */
  addItem(
    player: TaskBarPlayer,
    slotIndex: number,
    index: number,
    shortcut: Shortcut,
  ): AddShortcutResult {
    if (shortcut.dwShortcut === SHORTCUT.CHAT && this.countChat(player) > MAX_SHORTCUT_CHAT) {
      // ponytail: C++ sends AddDefinedText(TID_GAME_MAX_SHORTCUT_CHAT) here.
      // No defined-text serializer yet; the slot simply isn't updated.
      return { ok: false, reason: 'too_many_chat' };
    }
    player.m_aSlotItem[slotIndex]![index] = shortcut;
    this.save(player);
    return { ok: true };
  }

  /** Clear the binding at `[slotIndex][index]` (C++ `OnRemoveItemTaskBar`). */
  removeItem(player: TaskBarPlayer, slotIndex: number, index: number): void {
    player.m_aSlotItem[slotIndex]![index] = { dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 };
    this.save(player);
  }

  /**
   * Replace the action-slot queue (C++ `OnSkillTaskBar`). `slots` is the full
   * MAX_SLOT_QUEUE-length array straight off the wire; each index maps 1:1 to
   * `m_aSlotQueue[i]`. An all-empty upload clears the queue. Persists
   * fire-and-forget -- the action slot must survive logout (was the
   * "action slot not persistent" bug: handler existed for END_SKILLQUEUE
   * cancel but SKILLTASKBAR upload was never wired, so the queue was
   * in-memory only and lost on relog).
   */
  setQueue(player: TaskBarPlayer, slots: ReadonlyArray<Shortcut>): void {
    for (let i = 0; i < MAX_SLOT_QUEUE; i++) {
      const s = slots[i] ?? { dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 };
      player.m_aSlotQueue[i] = {
        dwShortcut: s.dwShortcut | 0, dwId: s.dwId | 0, dwType: s.dwType | 0,
        dwIndex: s.dwIndex | 0, dwUserId: s.dwUserId | 0, dwData: s.dwData | 0,
      };
    }
    this.save(player);
  }
}
