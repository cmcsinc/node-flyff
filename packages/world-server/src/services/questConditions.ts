/**
 * Begin/end quest condition evaluators -- pure functions.
 *
 * Mirrors C++ `__IsBeginQuestCondition` / `__IsEndQuestCondition`
 * (`_Common/Mover.cpp:7108` / `:7393`). The C++ loaders
 * (`_Common/PROJECT.CPP:1586+`) read each `Set*Cond*` call into typed fields on
 * `QuestProp`; our converter keeps the calls verbatim as `{ cmd, args }`, so we
 * interpret them positionally here -- same AND-semantics: every set condition
 * must pass (unset ones auto-pass, matching the C++ `nResult` accumulator).
 *
 * Item conditions apply the C++ sex/job filter
 * (`Mover.cpp:7308` -- `m_nSex == -1 || == GetSex()`, type 0 -> job filter).
 *
 * Party/guild checks are stubbed permissive -- those systems aren't landed yet
 * (`ponytail`); the contract is the function signature, not the absence.
 *
 * @module services/questConditions
 */

import type { QuestArg, QuestDef } from '@flyff/resources';
import type { CPlayer } from '../entities/player';
import type { RuntimeQuest } from '../net/snapshot/quest.serializer';
import { QUEST_FLAG } from '@flyff/core/constants/quest';

/**
 * Inventory operations the evaluators need. Stubbed in `compose.ts` until the
 * inventory system lands -- a permissive stub (count 0, plenty of empty slots)
 * keeps non-item quests playable; item quests simply stay uncompletable.
 */
export interface InventoryOps {
  count(itemId: number): number;
  emptySlots(): number;
}

/** Failure bucket. Phase 5 dialog maps each to a `TID_GAME_*` defined-text id. */
export type QuestFailReason =
  | 'already_active'
  | 'already_complete'
  | 'not_found'
  | 'level'
  | 'job'
  | 'sex'
  | 'item'
  | 'prev_quest'
  | 'exclusive_quest'
  | 'inventory_space'
  | 'kill'
  | 'time'
  | 'patrol'
  | 'gold'
  | 'state';

export type CondResult = { ok: true } | { ok: false; reason: QuestFailReason };

/** Read a numeric arg (resolved syms are numbers; unresolved strings fall back). */
function num(arg: QuestArg | undefined, fallback = 0): number {
  if (!arg) return fallback;
  return typeof arg.value === 'number' ? arg.value : fallback;
}

/**
 * C++ sex/job gate shared by every item condition/reward
 * (`Mover.cpp:7308` -- `m_nSex == -1 || == GetSex()`; type 0 -> job filter on
 * `m_nJobOrItem`). type 1 gates on *having* item `m_nJobOrItem` instead.
 */
function passesSexJob(
  player: CPlayer,
  inv: InventoryOps,
  nSex: number,
  nType: number,
  nJobOrItem: number,
): boolean {
  if (nSex !== -1 && nSex !== player.m_nSex) return false;
  if (nType === 0) return nJobOrItem === -1 || nJobOrItem === player.m_nJob;
  return nJobOrItem === -1 || inv.count(nJobOrItem) > 0;
}

/** `SetBeginCondJob( j1, j2, ... )` -- any-of (`Mover.cpp:7464`). */
function matchesJob(player: CPlayer, jobs: QuestArg[]): boolean {
  if (jobs.length === 0) return true;
  return jobs.some((j) => num(j) === player.m_nJob);
}

/**
 * `__IsBeginQuestCondition` -- true if the player may start `def`.
 * Order mirrors C++: already-active/complete guard -> inventory space for
 * begin-set items -> each SetBeginCond* command.
 */
export function canBegin(
  player: CPlayer,
  def: QuestDef,
  inv: InventoryOps,
): CondResult {
  if (player.isCompleteQuest(def.id)) return { ok: false, reason: 'already_complete' };
  if (player.findQuest(def.id)) return { ok: false, reason: 'already_active' };

  let beginSetItems = 0;
  for (const c of def.commands) {
    switch (c.cmd) {
      case 'SetBeginCondLevel': {
        const min = num(c.args[0]);
        const max = num(c.args[1]);
        if (min !== 0 && (player.m_nLevel < min || player.m_nLevel > max))
          return { ok: false, reason: 'level' };
        break;
      }
      case 'SetBeginCondJob':
        if (!matchesJob(player, c.args)) return { ok: false, reason: 'job' };
        break;
      case 'SetBeginCondSex':
        if (num(c.args[0]) !== -1 && num(c.args[0]) !== player.m_nSex)
          return { ok: false, reason: 'sex' };
        break;
      case 'SetBeginCondItem': {
        const itemIdx = num(c.args[3]);
        if (itemIdx !== 0) {
          if (!passesSexJob(player, inv, num(c.args[0]), num(c.args[1]), num(c.args[2])))
            break;
          if (inv.count(itemIdx) < num(c.args[4], 1))
            return { ok: false, reason: 'item' };
        }
        break;
      }
      case 'SetBeginCondPreviousQuest':
        if (!passesPreviousQuest(player, c.args)) return { ok: false, reason: 'prev_quest' };
        break;
      case 'SetBeginCondExclusiveQuest':
        if (!passesExclusiveQuest(player, c.args)) return { ok: false, reason: 'exclusive_quest' };
        break;
      case 'SetBeginSetAddItem':
        if (num(c.args[1]) !== 0) beginSetItems++;
        break;
      // SetBeginCondParty / SetBeginCondGuild: stubbed permissive (ponytail).
      default:
        break;
    }
  }
  if (beginSetItems > 0 && inv.emptySlots() < beginSetItems)
    return { ok: false, reason: 'inventory_space' };
  return { ok: true };
}

/**
 * `__IsEndQuestCondition` -- true if the active quest `q` meets every end
 * condition of `def`. The runtime record `q` supplies live kill counts, the
 * limit-time remaining, and the patrol/dialog flags.
 */
export function isComplete(
  player: CPlayer,
  q: RuntimeQuest,
  def: QuestDef,
  inv: InventoryOps,
): CondResult {
  for (const c of def.commands) {
    switch (c.cmd) {
      case 'SetEndCondLevel': {
        const min = num(c.args[0]);
        const max = num(c.args[1]);
        if (min !== 0 && (player.m_nLevel < min || player.m_nLevel > max))
          return { ok: false, reason: 'level' };
        break;
      }
      case 'SetEndCondItem': {
        const itemIdx = num(c.args[3]);
        if (itemIdx !== 0) {
          if (!passesSexJob(player, inv, num(c.args[0]), num(c.args[1]), num(c.args[2])))
            break;
          if (inv.count(itemIdx) < num(c.args[4], 1))
            return { ok: false, reason: 'item' };
        }
        break;
      }
      case 'SetEndCondKillNPC': {
        const slot = Math.min(Math.max(num(c.args[0]), 0), 1);
        const need = num(c.args[2], 1);
        const have = q.killNpcNum[slot] ?? 0;
        if (need > 0 && have < need)
          return { ok: false, reason: 'kill' };
        break;
      }
      case 'SetEndCondLimitTime': {
        const limit = num(c.args[0]);
        // m_wTime bit15 = expired (DPClient.cpp:5971 &0x7fff); 0 time left = fail.
        if (limit !== 0 && (q.time & 0x7fff) === 0)
          return { ok: false, reason: 'time' };
        break;
      }
      case 'SetEndCondPatrolZone':
        if ((q.flags & QUEST_FLAG.PATROL) === 0) return { ok: false, reason: 'patrol' };
        break;
      case 'SetEndCondGold': {
        const g = num(c.args[0]);
        if (g !== 0 && player.m_nGold < g) return { ok: false, reason: 'gold' };
        break;
      }
      // SetEndCondParty/Guild/State/CompleteQuest: stubbed permissive (ponytail).
      default:
        break;
    }
  }
  return { ok: true };
}

/** `SetBeginCondPreviousQuest(type, q1, ...q6)` -- `Mover.cpp:7420`. */
function passesPreviousQuest(player: CPlayer, args: QuestArg[]): boolean {
  const type = num(args[0]);
  const ids = args.slice(1).map((a) => num(a)).filter((id) => id !== 0);
  if (ids.length === 0) return true;
  for (const id of ids) {
    const active = Boolean(player.findQuest(id));
    const complete = player.isCompleteQuest(id);
    const ok = type === 0 ? active || complete : type === 1 ? complete : type === 2 ? active && !complete : true;
    if (!ok) return false;
  }
  return true;
}

/** `SetBeginCondExclusiveQuest(q1, ...q6)` -- must have neither active nor complete. */
function passesExclusiveQuest(player: CPlayer, args: QuestArg[]): boolean {
  const ids = args.map((a) => num(a)).filter((id) => id !== 0);
  if (ids.length === 0) return true;
  return ids.every((id) => !player.findQuest(id) && !player.isCompleteQuest(id));
}
