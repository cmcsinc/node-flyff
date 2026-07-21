/**
 * QuestService — per-player quest lifecycle orchestrator.
 *
 * Phase 2: hydrate quest state from the DB on JOIN (`loadOnJoin`).
 * Phase 3: the begin/complete engine — `beginQuest` / `setQuestState` /
 * `endQuest` / `cancelQuest`. Each runs the matching pure evaluator
 * (`questConditions`) + reward grantor (`questRewards`), persists the new state
 * via {@link QuestRepository}, writes the WAL audit row, and returns the
 * outbound snapshot frames for the handler to write.
 *
 * The service owns no socket bytes (rule 02) — handlers write returned frames.
 *
 * @module services/quest
 */

import type { JournalEntry, QuestRepository, CharacterRepository } from '@flyff/database';
import type { QuestDef, QuestIndex } from '@flyff/resources';
import type { CPlayer } from '../entities/player.js';
import { QUEST_LOG_ACTION, QS_BEGIN, QS_END } from '@flyff/core/constants/quest.js';
import type { RuntimeQuest } from '../net/snapshot/quest.serializer.js';
import {
  buildSetQuest,
  buildRemoveQuest,
  buildCheckedQuest,
} from '../net/snapshot/quest.serializer.js';
import { REMOVEQUEST_TYPE } from '@flyff/core/constants/quest.js';
import { createLogger } from '@flyff/core/logger.js';
import type { InventoryOps, QuestFailReason } from './questConditions.js';
import { canBegin, isComplete } from './questConditions.js';
import type { RewardSink } from './questRewards.js';
import { applyBeginSet, applyEnd } from './questRewards.js';

const logger = createLogger({ module: 'quest-service' });

/** Inventory the service needs: evaluator reads + reward grantor writes. */
export type QuestInventory = InventoryOps & {
  add(itemId: number, count: number): void;
  remove(itemId: number, count: number): void;
};

export interface QuestServiceDeps {
  questRepo: QuestRepository;
  quests: QuestIndex;
  /** Inventory ops. Optional — a permissive stub keeps non-item quests playable. */
  inventory?: QuestInventory;
  /** WAL journal for reward audit (rule 03/04). Optional for tests. */
  journal?: { append(entry: JournalEntry): number };
  /**
   * Character repo for gold persistence (migration 003). Optional — gold still
   * mutates in-memory + WAL without it; only the cold DB flush is skipped.
   */
  charRepo?: Pick<CharacterRepository, 'updateGold'>;
}

export type QuestOpResult =
  | { ok: true; frames: Buffer[] }
  | { ok: false; reason: QuestFailReason };

/** Permissive fallback inventory (no inventory system yet — ponytail). */
const PERMISSIVE_INV: QuestInventory = {
  count: () => 0,
  emptySlots: () => Number.MAX_SAFE_INTEGER,
  add: () => {},
  remove: () => {},
};

/** Map a persisted active-quest row → the in-memory `RuntimeQuest` mirror. */
function rowToRuntime(row: {
  quest_id: number; state: number; time: number;
  kill_npc_num_0: number; kill_npc_num_1: number; flags: number;
}): RuntimeQuest {
  return {
    id: row.quest_id,
    state: row.state,
    time: row.time,
    killNpcNum: [row.kill_npc_num_0, row.kill_npc_num_1],
    flags: row.flags,
  };
}

/** Initial `SetEndCondLimitTime` for a freshly begun quest (0 if none). */
function limitTimeOf(def: QuestDef): number {
  for (const c of def.commands) {
    if (c.cmd === 'SetEndCondLimitTime') {
      const v = typeof c.args[0]?.value === 'number' ? c.args[0].value : 0;
      return v > 0 ? v : 0;
    }
  }
  return 0;
}

export class QuestService {
  constructor(private deps: QuestServiceDeps) {}

  private get inv(): QuestInventory {
    return this.deps.inventory ?? PERMISSIVE_INV;
  }

  private get sink(): RewardSink {
    const sink: RewardSink = { inventory: this.inv };
    const journal = this.deps.journal;
    if (journal) sink.journal = (entry) => { journal.append(entry); };
    const charRepo = this.deps.charRepo;
    if (charRepo) {
      // Fire-and-forget gold flush (mirrors combat's updateLevelAndExp pattern).
      sink.flushGold = (charId, gold) => {
        charRepo.updateGold(charId, gold).catch((err: unknown) =>
          logger.error({ err, charId, gold }, 'gold persist failed'),
        );
      };
    }
    return sink;
  }

  /**
   * Hydrate `m_aQuest` / `m_aCompleteQuest` / `m_aCheckedQuest` from the DB.
   * Called from `JoinService.join` after `CPlayer.fromRow`, before the JOIN
   * snapshot is built (so the inline quest arrays carry live state).
   */
  async loadOnJoin(player: CPlayer): Promise<void> {
    const state = await this.deps.questRepo.loadState(player.m_idPlayer);
    player.m_aQuest = state.active.map(rowToRuntime);
    player.m_aCompleteQuest = state.completed;
    player.m_aCheckedQuest = state.checked;
  }

  /**
   * Begin a quest: `canBegin` → grant `SetBeginSetAdd*` → insert active at
   * `QS_BEGIN` → persist + audit log (action 10). Returns the SETQUEST frame.
   */
  async beginQuest(player: CPlayer, questId: number): Promise<QuestOpResult> {
    const def = this.deps.quests.byId.get(questId);
    if (!def) return { ok: false, reason: 'not_found' };
    const check = canBegin(player, def, this.inv);
    if (!check.ok) return check;

    applyBeginSet(player, def, this.sink);
    const rt: RuntimeQuest = {
      state: QS_BEGIN, time: limitTimeOf(def), id: questId,
      killNpcNum: [0, 0], flags: 0,
    };
    player.setQuest(rt);
    await this.persist(player, rt);
    await this.deps.questRepo.insertLog(player.m_idPlayer, questId, QUEST_LOG_ACTION.START);
    return { ok: true, frames: [buildSetQuest(player.m_idPlayer, rt)] };
  }

  /** Update an active quest's state (e.g. dialog advance). Persists + emits. */
  async setQuestState(player: CPlayer, questId: number, state: number): Promise<QuestOpResult> {
    const rt = player.findQuest(questId);
    if (!rt) return { ok: false, reason: 'not_found' };
    rt.state = state;
    player._dirty.add('m_aQuest');
    await this.persist(player, rt);
    return { ok: true, frames: [buildSetQuest(player.m_idPlayer, rt)] };
  }

  /**
   * Complete a quest: `isComplete` → grant `SetEndReward*` / apply
   * `SetEndRemove*` → move to completed at `QS_END` → persist + audit log
   * (action 20). Refuses if the active record is missing or conditions fail.
   */
  async endQuest(player: CPlayer, questId: number): Promise<QuestOpResult> {
    const def = this.deps.quests.byId.get(questId);
    if (!def) return { ok: false, reason: 'not_found' };
    const rt = player.findQuest(questId);
    if (!rt) return { ok: false, reason: 'not_found' };

    const check = isComplete(player, rt, def, this.inv);
    if (!check.ok) return check;

    applyEnd(player, def, this.sink);
    const done: RuntimeQuest = { ...rt, state: QS_END };
    player.setQuest(done);
    await this.deps.questRepo.removeActive(player.m_idPlayer, questId);
    await this.deps.questRepo.addCompleted(player.m_idPlayer, questId);
    await this.deps.questRepo.insertLog(player.m_idPlayer, questId, QUEST_LOG_ACTION.END);
    return { ok: true, frames: [buildSetQuest(player.m_idPlayer, done)] };
  }

  /**
   * Player-initiated cancel (`PACKETTYPE_REMOVEQUEST`). Drops the active record
   * + audit log (action 30), returns the QUEST_REMOVE frame. `CMover::SetQuest`
   * already refuses cancels on quests already at `QS_END`.
   */
  async cancelQuest(player: CPlayer, questId: number): Promise<QuestOpResult> {
    if (!player.findQuest(questId)) return { ok: false, reason: 'not_found' };
    player.removeQuest(questId);
    await this.deps.questRepo.removeActive(player.m_idPlayer, questId);
    await this.deps.questRepo.insertLog(player.m_idPlayer, questId, QUEST_LOG_ACTION.CANCEL);
    return { ok: true, frames: [buildRemoveQuest(player.m_idPlayer, REMOVEQUEST_TYPE.CANCEL, questId)] };
  }

  /**
   * Toggle a quest in the checked (tracked) list — `PACKETTYPE_QUEST_CHECK`.
   * Mutates the CPlayer array, persists the full replacement, returns the
   * QUEST_CHECKED frame for the handler to write.
   */
  async setChecked(player: CPlayer, questId: number, check: boolean): Promise<Buffer> {
    const list = player.setCheckedQuest(questId, check);
    await this.deps.questRepo.setChecked(player.m_idPlayer, list);
    return buildCheckedQuest(player.m_idPlayer, list);
  }

  /** Upsert one active record (DTO shape mirrors `CharacterQuestRow` minus metadata). */
  private async persist(player: CPlayer, rt: RuntimeQuest): Promise<void> {
    await this.deps.questRepo.upsertActive(player.m_idPlayer, {
      quest_id: rt.id, state: rt.state, time: rt.time,
      kill_npc_num_0: rt.killNpcNum[0], kill_npc_num_1: rt.killNpcNum[1], flags: rt.flags,
    });
  }
}
