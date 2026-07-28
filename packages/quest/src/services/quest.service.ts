/**
 * QuestService -- per-player quest lifecycle orchestrator.
 *
 * Phase 2: hydrate quest state from the DB on JOIN (`loadOnJoin`).
 * Phase 3: the begin/complete engine -- `beginQuest` / `setQuestState` /
 * `endQuest` / `cancelQuest`. Each runs the matching pure evaluator
 * (`questConditions`) + reward grantor (`questRewards`), persists the new state
 * via {@link QuestRepository}, writes the WAL audit row, and returns the
 * outbound snapshot frames for the handler to write.
 *
 * The service owns no socket bytes (rule 02) -- handlers write returned frames.
 *
 * @module services/quest
 */

import type { JournalEntry, QuestRepository, InventoryRepository } from '@flyff/database';
import type { QuestDef, QuestIndex } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import { QUEST_LOG_ACTION, QS_BEGIN, QS_END } from '@flyff/core/constants/quest';
import type { RuntimeQuest } from '../net/snapshot/quest.serializer';
import {
  buildSetQuest,
  buildRemoveQuest,
  buildCheckedQuest,
} from '../net/snapshot/quest.serializer';
import { REMOVEQUEST_TYPE } from '@flyff/core/constants/quest';
import { createLogger } from '@flyff/core/logger';
import type { QuestFailReason } from './questConditions';
import { canBegin, isComplete } from './questConditions';
import type { RewardSink } from './questRewards';
import { applyBeginSet, applyEnd } from './questRewards';
import type { InventoryService } from '@flyff/inventory';
import type { CreateItemSnapshotSerializer } from '@flyff/inventory';
import { bindQuestInventory, type QuestInventory } from './questInventory.adapter';

/** Structural party-query interface (avoids @flyff/party import dependency). */
export interface PartyQuery {
  getByMember(charId: number): { members: number[] } | undefined;
}

export type { QuestInventory };

const EMPTY_FRAMES: Buffer[] = [];

const logger = createLogger({ module: 'quest-service' });

export interface QuestServiceDeps {
  questRepo: QuestRepository;
  quests: QuestIndex;
  /**
   * Test override -- a fully-shaped QuestInventory. Takes precedence over the
   * real inventory service (used by the begin/end unit tests).
   */
  inventory?: QuestInventory;
  /**
   * Real inventory backend + serializer. Used unless `inventory` is overridden.
   * Captures CREATEITEM/UPDATE_ITEM frames for item rewards and turn-in removals
   * so the handler notifies the client alongside the SETQUEST frame.
   */
  inventoryService?: InventoryService;
  createItemSerializer?: CreateItemSnapshotSerializer;
  /** WAL journal for reward audit (rule 03/04). Optional for tests. */
  journal?: { append(entry: JournalEntry): number };
  /**
   * Inventory container repo for gold persistence (migration 008 -- gold is a
   * container attribute). Optional -- gold still mutates in-memory + WAL
   * without it; only the cold DB flush is skipped.
   */
  inventoryRepo?: Pick<InventoryRepository, 'setGold'>;
  /**
   * Optional exp-gain client notifier. When wired (compose.ts binds the
   * SetExperience/SetLevel serializers + managers), the quest reward path
   * broadcasts the bar update live; otherwise the next combat exp gain
   * refreshes it (the pre-existing behavior). Matches C++ `AddExperienceSolo`
   * tail (`Mover.cpp:6254`) which always sends AddSetExperience.
   */
  onExpGain?: (player: CPlayer, leveled: boolean) => void;
  /**
   * Optional item-reward client notifier. When wired (compose.ts binds the
   * NoticeSerializer), the quest reward path emits a "you acquired X" chat line
   * alongside CREATEITEM; otherwise the item lands silently (vanilla behavior --
   * v19 C++ sends no item-name text). Matches {@link onExpGain}'s wiring shape.
   */
  onItemReward?: (player: CPlayer, itemId: number, count: number) => void;
  /** Party query for quest begin/end party conditions (M8). Optional -- guild is ponytail. */
  partyQuery?: PartyQuery;
}

export type QuestOpResult =
  | { ok: true; frames: Buffer[] }
  | { ok: false; reason: QuestFailReason };

/** Permissive fallback inventory (no inventory system yet -- ponytail). */
const PERMISSIVE_INV: QuestInventory = {
  count: () => 0,
  emptySlots: () => Number.MAX_SAFE_INTEGER,
  add: () => {},
  remove: () => {},
};

/** Map a persisted active-quest row -> the in-memory `RuntimeQuest` mirror. */
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

  /**
   * Per-call evaluator + reward sink for `player`. Binds the real
   * InventoryService (capturing CREATEITEM/UPDATE_ITEM reward + removal frames)
   * when wired and not overridden; falls back to the `inventory` test override
   * or the permissive stub. Captured frames are spread after SETQUEST on return.
   */
  private context(player: CPlayer): { inv: QuestInventory; sink: RewardSink; frames: Buffer[] } {
    const override = this.deps.inventory;
    const svc = this.deps.inventoryService;
    const ser = this.deps.createItemSerializer;
    const bound = !override && svc && ser
      ? bindQuestInventory(player, { inventoryService: svc, createItemSerializer: ser })
      : null;
    const inv: QuestInventory = override ?? bound?.inventory ?? PERMISSIVE_INV;

    // Populate party fields for questConditions (M8). Guild: ponytail.
    if (this.deps.partyQuery) {
      const party = this.deps.partyQuery.getByMember(player.m_idPlayer);
      if (party) {
        inv.isInParty = true;
        inv.partySize = party.members.length;
        inv.isPartyLeader = party.members[0] === player.m_idPlayer;
      }
    }

    const sink: RewardSink = { inventory: inv };
    if (this.deps.journal) sink.journal = (entry) => { this.deps.journal!.append(entry); };
    if (this.deps.onExpGain) sink.onExpGain = (p, leveled) => { this.deps.onExpGain!(p, leveled); };
    if (this.deps.onItemReward) sink.onItemReward = (p, itemId, count) => { this.deps.onItemReward!(p, itemId, count); };
    const inventoryRepo = this.deps.inventoryRepo;
    if (inventoryRepo) {
      // Fire-and-forget gold flush to the inventory container (migration 008).
      sink.flushGold = (charId, gold) => {
        inventoryRepo.setGold(charId, gold).catch((err: unknown) =>
          logger.error({ err, charId, gold }, 'gold persist failed'),
        );
      };
    }
    return { inv, sink, frames: bound?.frames ?? EMPTY_FRAMES };
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
    // Filter the tracked list to active quests only -- the client's quick-info
    // sidebar (CWndQuestQuickInfo::Process -> MakeQuestConditionItems,
    // WndQuest.cpp:1915) derefs FindQuest(id) per checked entry with no null
    // guard, so a stale id (quest completed/abandoned after it was tracked)
    // null-derefs Neuz. Drop stale ids defensively on hydrate.
    const activeIds = new Set(player.m_aQuest.map((q) => q.id));
    player.m_aCheckedQuest = state.checked.filter((id) => activeIds.has(id));
  }

  /**
   * Begin a quest: `canBegin` -> grant `SetBeginSetAdd*` -> insert active at
   * `QS_BEGIN` -> persist + audit log (action 10). Returns the SETQUEST frame.
   */
  async beginQuest(player: CPlayer, questId: number): Promise<QuestOpResult> {
    const def = this.deps.quests.byId.get(questId);
    if (!def) return { ok: false, reason: 'not_found' };
    const { inv, sink, frames } = this.context(player);
    const check = canBegin(player, def, inv);
    if (!check.ok) return check;

    applyBeginSet(player, def, sink);
    const rt: RuntimeQuest = {
      state: QS_BEGIN, time: limitTimeOf(def), id: questId,
      killNpcNum: [0, 0], flags: 0,
    };
    player.setQuest(rt);
    // Auto-track: surface the newly accepted quest in the tracker sidebar
    // (CWndQuestQuickInfo iterates m_aCheckedQuest). The v19 C++ begin path
    // (CMover::__SetQuest) does NOT push to the checked list, so the vanilla
    // sidebar stays empty until the player manually ticks the quest in the Q
    // window -- the user wants it tracked on accept. Safe because the quest is
    // already in m_aQuest, so the client's MakeQuestConditionItems FindQuest(id)
    // resolves (no null-deref).
    player.setCheckedQuest(questId, true);
    await this.deps.questRepo.setChecked(player.m_idPlayer, player.m_aCheckedQuest);
    await this.persist(player, rt);
    await this.deps.questRepo.insertLog(player.m_idPlayer, questId, QUEST_LOG_ACTION.START);
    return {
      ok: true,
      frames: [
        buildSetQuest(player.m_idPlayer, rt),
        buildCheckedQuest(player.m_idPlayer, player.m_aCheckedQuest),
        ...frames,
      ],
    };
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
   * Complete a quest: `isComplete` -> grant `SetEndReward*` / apply
   * `SetEndRemove*` -> move to completed at `QS_END` -> persist + audit log
   * (action 20). Refuses if the active record is missing or conditions fail.
   */
  async endQuest(player: CPlayer, questId: number): Promise<QuestOpResult> {
    const def = this.deps.quests.byId.get(questId);
    if (!def) return { ok: false, reason: 'not_found' };
    const rt = player.findQuest(questId);
    if (!rt) return { ok: false, reason: 'not_found' };

    const { inv, sink, frames } = this.context(player);
    const check = isComplete(player, rt, def, inv);
    if (!check.ok) return check;

    applyEnd(player, def, sink);
    const done: RuntimeQuest = { ...rt, state: QS_END };
    player.setQuest(done);
    await this.deps.questRepo.removeActive(player.m_idPlayer, questId);
    await this.deps.questRepo.addCompleted(player.m_idPlayer, questId);
    await this.deps.questRepo.insertLog(player.m_idPlayer, questId, QUEST_LOG_ACTION.END);
    return { ok: true, frames: [buildSetQuest(player.m_idPlayer, done), ...frames] };
  }

  /**
   * Player-initiated cancel (`PACKETTYPE_REMOVEQUEST`). Drops the active record
   * + audit log (action 30), returns the QUEST_REMOVE frame. C++
   * `DPSrvr::OnRemoveQuest` checks `m_nState != QS_END` to block cancelling
   * completed quests.
   */
  async cancelQuest(player: CPlayer, questId: number): Promise<QuestOpResult> {
    const rt = player.findQuest(questId);
    if (!rt) return { ok: false, reason: 'not_found' };
    if (rt.state === QS_END) return { ok: false, reason: 'not_found' };
    // C++ DPSrvr.cpp:1656 — pQuestProp->m_bNoRemove == FALSE required.
    const def = this.deps.quests?.byId.get(questId);
    if (def?.no_remove) return { ok: false, reason: 'no_remove' };
    player.removeQuest(questId);
    await this.deps.questRepo.removeActive(player.m_idPlayer, questId);
    await this.deps.questRepo.insertLog(player.m_idPlayer, questId, QUEST_LOG_ACTION.CANCEL);
    return { ok: true, frames: [buildRemoveQuest(player.m_idPlayer, REMOVEQUEST_TYPE.CANCEL, questId)] };
  }

  /**
   * `/raq` -- `TextCmd_RemoveAllQuest` (FuncTextCmd.cpp:4020). Clears the entire
   * active quest list: drops every record from `m_aQuest`, removes each from the
   * active repo table, returns one `REMOVEQUEST_TYPE.ALL` frame (questId 0).
   */
  async removeAllQuests(player: CPlayer): Promise<QuestOpResult> {
    const ids = player.m_aQuest.map((q) => q.id);
    player.m_aQuest = [];
    player._dirty.add('m_aQuest');
    await Promise.all(ids.map((id) => this.deps.questRepo.removeActive(player.m_idPlayer, id)));
    return { ok: true, frames: [buildRemoveQuest(player.m_idPlayer, REMOVEQUEST_TYPE.ALL, 0)] };
  }

  /**
   * `/rcq` -- `TextCmd_RemoveCompleteQuest` (FuncTextCmd.cpp:4031). Clears the
   * completed-quest ledger only (active list untouched); returns one
   * `REMOVEQUEST_TYPE.CLEAR_COMPLETED` frame.
   */
  async removeCompleteQuests(player: CPlayer): Promise<QuestOpResult> {
    await this.deps.questRepo.clearCompleted(player.m_idPlayer);
    return {
      ok: true,
      frames: [buildRemoveQuest(player.m_idPlayer, REMOVEQUEST_TYPE.CLEAR_COMPLETE, 0)],
    };
  }

  /**
   * Toggle a quest in the checked (tracked) list -- `PACKETTYPE_QUEST_CHECK`.
   * Mutates the CPlayer array, persists the full replacement, returns the
   * QUEST_CHECKED frame for the handler to write.
   */
  async setChecked(player: CPlayer, questId: number, check: boolean): Promise<Buffer> {
    // The client quick-info sidebar derefs FindQuest(id) per checked entry with
    // no null guard (WndQuest.cpp:1915) -- tracking a non-active quest (completed
    // / never begun) crashes Neuz. Reject checks on non-active quests; uncheck is
    // idempotent for any id.
    if (check && !player.findQuest(questId)) {
      logger.info({ charId: player.m_idPlayer, questId }, 'QUEST_CHECK rejected -- quest not active');
      return buildCheckedQuest(player.m_idPlayer, player.m_aCheckedQuest);
    }
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
