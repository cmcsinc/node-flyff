/**
 * Runtime quest state -- in-memory mirror of the C++ `QUEST` struct.
 *
 * Lifted to `@flyff/entities` so `CPlayer.m_aQuest` + the quest serializer +
 * the (Stage 3) quest tracker all share one type without an entities<->quest
 * cycle.
 *
 * @module entities/state/quest
 */

/** In-memory mirror of the C++ `QUEST` struct (sans padding). */
export interface RuntimeQuest {
  state: number;            // m_nState (QS_*)
  time: number;             // m_wTime
  id: number;               // m_wId (quest id)
  killNpcNum: [number, number]; // m_nKillNPCNum[2]
  flags: number;            // bit0=patrol, bit1=dialog (QUEST_FLAG)
}
