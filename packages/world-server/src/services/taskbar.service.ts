/**
 * TaskBarService -- taskbar hotkey binding (add/remove shortcut) + persistence.
 *
 * Ports `CDPSrvr::OnAddItemTaskBar` / `OnRemoveItemTaskBar`
 * (`WORLDSERVER/DPSrvr.cpp:2203/2251`). Stores bindings into the player's
 * in-memory `m_aSlotItem[8][9]` grid and fire-and-forget persists the grid to
 * `characters.taskbar` (migration 009). C++ saves the grid on logout
 * (`DbManagerSave.cpp:SaveTaskBar`); we write through on every change instead --
 * a drag is user-paced (rare) and a crash between logout saves would otherwise
 * lose the session's bindings. Low-stakes UI state, so no WAL journal entry
 * (rule 04 lists items/gold/exp/SP/quest/trade; taskbar is not among them).
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
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SHORTCUT_CHAT } from '@flyff/world-core';

const logger = createLogger({ module: 'taskbar-service' });

/**
 * Persist hook -- `compose.ts` wires this to `charRepo.update(id, { taskbar })`.
 * Optional so unit tests can exercise the grid logic with no DB.
 */
export type TaskBarPersist = (charId: number, json: string) => Promise<void>;

export type AddShortcutResult =
  | { ok: true }
  | { ok: false; reason: 'too_many_chat' };

/** Player shape this service needs -- the grid + an optional id for persist. */
interface TaskBarPlayer {
  m_idPlayer?: number;
  m_aSlotItem: Shortcut[][];
}

/** One non-empty grid slot, positioned -- the `characters.taskbar` JSON shape. */
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

/**
 * Encode the grid as JSON for the `characters.taskbar` column. Only non-empty
 * slots are stored (matches C++ `SaveTaskBar` skipping `SHORTCUT_NONE`).
 */
export function encodeTaskBar(grid: ReadonlyArray<ReadonlyArray<Shortcut>>): string {
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
  return JSON.stringify(out);
}

/**
 * Decode the `characters.taskbar` column into a fresh grid. Bad/out-of-range
 * rows are dropped defensively. `null`/empty yields an all-empty grid (fresh
 * character). Mirrors C++ `GetTaskBar` (`DbManagerFun.cpp:984`).
 */
export function decodeTaskBar(json: string | null | undefined): Shortcut[][] {
  const grid: Shortcut[][] = Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
    Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 })),
  );
  if (!json) return grid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    logger.warn({ json }, 'taskbar column unreadable -- ignoring');
    return grid;
  }
  if (!Array.isArray(parsed)) return grid;
  for (const e of parsed as StoredShortcut[]) {
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

  /** Fire-and-forget write-through of the grid (rule 05 -- no unhandled rejection). */
  private save(player: TaskBarPlayer): void {
    if (!this.persist || player.m_idPlayer === undefined) return;
    void this.persist(player.m_idPlayer, encodeTaskBar(player.m_aSlotItem)).catch((err) =>
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
}
