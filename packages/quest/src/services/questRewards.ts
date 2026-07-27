/**
 * Quest reward grantors + removers -- pure functions side-effecting via deps.
 *
 * Mirrors the C++ reward-grant path invoked from `CUser::OnEndQuest`-style
 * handlers (`WORLDSERVER/User.cpp`): `SetBeginSetAdd*` apply at quest start;
 * `SetEndReward*` / `SetEndRemove*` apply at completion. Signatures follow
 * `_Common/PROJECT.CPP:2031-2159`.
 *
 * Rule 03/04 -- gold/exp mutations are WAL-journaled through the injected sink
 * BEFORE the mutation lands, recording the ABSOLUTE post-state so the boot
 * replayer can idempotently re-apply them. Item mutations are not journaled
 * here: QuestService has no real inventory sink yet, so there is no DB write to
 * recover (see `grantItem` ponytail). The journal type discriminator is the
 * replayer registry key.
 *
 * @module services/questRewards
 */

import type { QuestArg, QuestDef } from '@flyff/resources';
import type { JournalEntry } from '@flyff/database';
import type { CPlayer } from '@flyff/entities';
import type { InventoryOps } from './questConditions';
import { addExp } from '@flyff/combat';

/** Sink the grantors mutate through. `inventory` covers count/add/remove. */
export interface RewardSink {
  inventory: InventoryOps & {
    add(itemId: number, count: number): void;
    remove(itemId: number, count: number): void;
  };
  /** WAL journal -- appended before any gold/exp/item mutation (rule 04). */
  journal?: (entry: JournalEntry) => void;
  /**
   * Fire-and-forget gold persist (migration 003). Called after the WAL append
   * so the DB is consistent even if the server exits before the next 30s flush.
   */
  flushGold?: (charId: number, gold: number) => void;
  /**
   * Exp-gain client notification. Fired after the player's `m_nExp`/`m_nLevel`
   * mutate so the QuestService can broadcast SETEXPERIENCE (+ SETLEVEL when
   * `leveled` is true) without this module taking a serializer dep. Matches
   * the C++ `AddExperienceSolo` tail (`Mover.cpp:6254`) which always broadcasts.
   */
  onExpGain?: (player: CPlayer, leveled: boolean) => void;
  /**
   * Item-acquire client notification. Fired after an item reward lands so the
   * QuestService can emit a `SNAPSHOTTYPE_TEXT` "you acquired X" chat line.
   * Emulator addition -- v19 C++ sends no item-name text on quest reward, only
   * CREATEITEM + the pickup sound (see memory `v19-loot-quest-acquire-notice`).
   * Optional -- no-op in tests.
   */
  onItemReward?: (player: CPlayer, itemId: number, count: number) => void;
}

function num(arg: QuestArg | undefined, fallback = 0): number {
  if (!arg) return fallback;
  return typeof arg.value === 'number' ? arg.value : fallback;
}

/**
 * Resolve a min/max reward pair to a concrete amount. min==max -> that value
 * (deterministic for tests); otherwise uniform in [min, max]. Mirrors C++
 * `Random(min, max)` in the gold/exp grant paths.
 */
function resolveRange(min: number, max: number): number {
  if (min === max) return min;
  if (max < min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

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

/**
 * `SetBeginSetAdd*` -- granted on quest accept. Gold (`SetBeginSetAddGold`) and
 * up to 4 `SetBeginSetAddItem(idx, item, num)` slots (`PROJECT.CPP:1707-1725`).
 */
export function applyBeginSet(player: CPlayer, def: QuestDef, sink: RewardSink): void {
  for (const c of def.commands) {
    if (c.cmd === 'SetBeginSetAddGold') {
      const gold = num(c.args[0]);
      if (gold > 0) grantGold(player, gold, sink);
    } else if (c.cmd === 'SetBeginSetAddItem') {
      const item = num(c.args[1]);
      const count = num(c.args[2], 1);
      if (item !== 0) grantItem(player, item, count, sink);
    }
  }
}

/**
 * `SetEndReward*` + `SetEndRemove*` -- granted on quest completion
 * (`PROJECT.CPP:2031-2159`). Rewards grant first, removes after, matching the
 * C++ turn-in order.
 */
export function applyEnd(player: CPlayer, def: QuestDef, sink: RewardSink): void {
  for (const c of def.commands) {
    switch (c.cmd) {
      case 'SetEndRewardItem': {
        const item = num(c.args[3]);
        const count = num(c.args[4], 1);
        if (item !== 0 && passesSexJob(player, sink.inventory, num(c.args[0]), num(c.args[1]), num(c.args[2])))
          grantItem(player, item, count, sink);
        break;
      }
      case 'SetEndRewardGold': {
        const gold = resolveRange(num(c.args[0]), num(c.args[1]));
        if (gold > 0) grantGold(player, gold, sink);
        break;
      }
      case 'SetEndRewardExp': {
        const exp = resolveRange(num(c.args[0]), num(c.args[1]));
        if (exp > 0) grantExp(player, exp, sink);
        break;
      }
      case 'SetEndRemoveItem': {
        const item = num(c.args[1]);
        const count = num(c.args[2]);
        if (item !== 0) removeItem(player, item, count, sink);
        break;
      }
      case 'SetEndRemoveGold': {
        const gold = num(c.args[0]);
        if (gold > 0) {
          player.m_nGold = Math.max(0, player.m_nGold - gold);
          journal(player, 'CHAR_GOLD', { gold: player.m_nGold }, sink);
          sink.flushGold?.(player.m_idPlayer, player.m_nGold);
        }
        break;
      }
      case 'SetEndRemoveQuest':
        // Turn-in removes the listed quests from the completed log. Quest state
        // is write-through persisted by QuestService (removeActive on turn-in),
        // so there is no crash gap to journal here.
        for (const a of c.args) {
          const id = num(a);
          if (id !== 0) player.removeQuest(id);
        }
        break;
      // SetEndRewardPKValue/Teleport/Hide/PetLevelup: ponytail -- wire when those
      // systems (PK, teleport, pet, hide state) land. No-op for now.
      default:
        break;
    }
  }
}

function grantGold(player: CPlayer, amount: number, sink: RewardSink): void {
  // Journal the ABSOLUTE post-state (no clamp here, so total = pre + amount)
  // before the mutation lands (rule 04). Idempotent on replay.
  journal(player, 'CHAR_GOLD', { gold: player.m_nGold + amount }, sink);
  player.m_nGold += amount;
  player._dirty.add('m_nGold');
  sink.flushGold?.(player.m_idPlayer, player.m_nGold);
}

function grantExp(player: CPlayer, amount: number, sink: RewardSink): void {
  // m_nExp is within-level; addExp carries excess across level boundaries.
  const gain = addExp(player.m_nLevel, player.m_nExp, amount);
  // Journal the ABSOLUTE post-state (within-level exp -- the wire/DB value)
  // before the mutation (rule 04). Quest-granted exp has no write-through
  // persist today, so this WAL row is the ONLY crash recovery for it --
  // idempotent replay on next boot.
  journal(player, 'CHAR_EXP', {
    level: gain.level,
    exp: String(Math.floor(gain.exp)),
  }, sink);
  player.m_nExp = gain.exp;
  player.m_nLevel = gain.level;
  player._dirty.add('m_nExp');
  if (gain.levelsGained > 0) {
    player.m_nHp = player.m_nMaxHp;
    player.m_nMp = player.m_nMaxMp;
    player._dirty.add('m_nLevel');
    player._dirty.add('m_nHp');
    player._dirty.add('m_nMp');
  }
  // Notify the client (SETEXPERIENCE + SETLEVEL on level-up). QuestService
  // wires this so the bar updates live without a serializer dep here.
  sink.onExpGain?.(player, gain.levelsGained > 0);
}

function grantItem(player: CPlayer, item: number, count: number, sink: RewardSink): void {
  // No WAL: QuestService has no real inventory sink today (PERMISSIVE_INV
  // stub), so there is no DB write to recover. When the inventory system ships
  // and journals per-slot absolute state, item rewards recover through it.
  sink.inventory.add(item, count);
  sink.onItemReward?.(player, item, count);
}

/**
 * Remove an item. `count < 0` means "all of that item" (the `-1` turn-in
 * sentinel used by QUEST_1's `SetEndRemoveItem(0, 6005, -1)`); `count > 0`
 * removes exactly that many.
 */
function removeItem(player: CPlayer, item: number, count: number, sink: RewardSink): void {
  const have = sink.inventory.count(item);
  const remove = count < 0 ? have : Math.min(have, count);
  if (remove <= 0) return;
  // No WAL -- see grantItem (no inventory persistence behind this path yet).
  sink.inventory.remove(item, remove);
}

function journal(player: CPlayer, type: string, payload: unknown, sink: RewardSink): void {
  sink.journal?.({ charId: player.m_idPlayer, type, payload });
}
