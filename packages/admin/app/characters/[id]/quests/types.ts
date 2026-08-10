/**
 * Shared types for the interactive quest UI.
 *
 * A `QuestSlotItem` is a fully-resolved, serializable view of one character
 * quest — the server component joins the DB row with its quest definition,
 * resolves every `IDS_PROPQUEST_INC_*` token, item icon, NPC display name, and
 * world coordinate so the client components need no lookups.
 *
 * @module characters/[id]/quests/types
 */

/** A world position shown on hover. */
export interface QuestGoal {
  x: number;
  z: number;
  /** Zone id (e.g. `flaris`) when known from zone placement data. */
  zone?: string;
  /** Numeric world id from the quest command args (1 = Madrigal). */
  worldId?: number;
}

/** One requirement row. `iconUrl` present for item requirements. */
export interface QuestRequirement {
  kind: 'item' | 'kill' | 'npc' | 'level' | 'job' | 'party' | 'other';
  /** Primary label (item name, NPC name, monster name, or a description). */
  label: string;
  /** Count needed, when the requirement is countable. */
  count?: number;
  /** Item/monster icon for hover preview. */
  iconUrl?: string;
  /** Underlying item or mover id, for reference. */
  refId?: number;
  /** Map goal position, when the quest data carries one. */
  goal?: QuestGoal;
  /** Which kill counter (0 or 1) tracks this requirement. */
  killIndex?: number;
}

/** One reward row. */
export interface QuestReward {
  kind: 'item' | 'gold' | 'exp' | 'skillPoint' | 'other';
  label: string;
  count?: number;
  iconUrl?: string;
  refId?: number;
}

export interface QuestSlotItem {
  /** DB row id (character_quests or character_completed_quests). */
  id: number;
  /** Quest definition id. */
  questId: number;
  /** Quest state (0 = QS_BEGIN, 14 = QS_END). */
  state: number;
  /** Kill progress counters — index 0 and 1 match `SetEndCondKillNPC` idx. */
  killNpcNum0: number;
  killNpcNum1: number;
  /** Time limit remaining (seconds); 0 = untimed. */
  time: number;
  flags: number;

  // ── Resolved from the definition ──
  /** Display name — resolved title text, else the symbol, else `Quest #id`. */
  name: string;
  /** Raw symbol (e.g. `QUEST_DORIVINIG`). Shown as secondary metadata. */
  symbol: string;
  /** Resolved title text, when the IDS token exists. */
  title?: string;
  /** Resolved state-0 description. */
  description?: string;
  /** Resolved state-0 condition text (what the player must do). */
  conditionText?: string;
  /** Resolved state-0 status text. */
  statusText?: string;
  /** NPC the quest begins at — display name + key + placement. */
  beginNpc?: { name: string; key: string; goal?: QuestGoal };
  /** NPC the quest is turned in to. */
  endNpc?: { name: string; key: string; goal?: QuestGoal };
  requirements: QuestRequirement[];
  rewards: QuestReward[];
  /** `[min, max]` level bracket from `SetBeginCondLevel`. */
  levelReq?: [number, number];
  /** Job ids allowed by `SetBeginCondJob`. */
  jobReq?: number[];
  /** `SetHeadQuest` parent — the quest-chain / category header. */
  headQuestId?: number;
  /** Resolved category label when `headQuestId` is a `QUEST_KIND_*` value. */
  categoryLabel?: string;
  /** False when `SetRemove(FALSE)` — quest cannot be cancelled. */
  removable: boolean;
  /** `SetRepeat` present. */
  repeatable: boolean;
  /** Quest-item drop generators: which monster drops what. */
  questItems: {
    moverName: string;
    itemName: string;
    itemIconUrl: string;
    count: number;
    /** Drop chance as a percentage (prob is out of 1e9). */
    chance: number;
    goal?: QuestGoal;
  }[];
}

/** `QS_*` state labels (`packages/core/src/constants/quest.ts`). */
export const QUEST_STATE_LABELS: Record<number, string> = {
  0: 'In Progress',
  14: 'Complete',
};

/** Badge variant per state. */
export const QUEST_STATE_VARIANT: Record<number, 'default' | 'secondary' | 'success'> = {
  0: 'default',
  14: 'success',
};

/**
 * `QUEST_KIND_*` category headers (`resource/definequest.h:507-510`) — quests
 * whose `SetHeadQuest` points at one of these group under that label in-game.
 */
export const QUEST_CATEGORY_LABELS: Record<number, string> = {
  6000: 'Scenario',
  6001: 'Normal',
  6002: 'Request',
  6003: 'Event',
};
