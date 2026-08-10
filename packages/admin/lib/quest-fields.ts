/**
 * Argument signatures and client blast radius for every `propQuest.inc` command.
 *
 * The converter stores commands positionally as `{cmd, args:[{type,value}]}` —
 * enough to round-trip, not enough to edit. This table names each argument, says
 * how it must be typed, and says what a stale client does when it disagrees.
 *
 * Everything here is read from `CProject::LoadPropQuest`
 * (`game/source/_Common/Project.cpp:1396-2500`). Argument order is the order
 * `script.GetNumber()` / `GetToken()` consumes it; nothing is inferred from the
 * shipped data.
 *
 * ## The tier is the whole point
 *
 * `propQuest.inc` is packed into the client's `dataSub1.res`
 * (`game/resource/resource.txt:132`) and `Project.cpp:495 LoadPropQuest` has no
 * `__WORLDSERVER` guard, so the client parses its own copy. A field the client
 * reads is a field that desyncs until the archive is rebuilt.
 *
 * Tiers were derived by cross-referencing each command's assigned `propQuest`
 * field against every read in `Neuz/`, `_Interface/`, and `_Common/Mover.cpp`:
 *
 * - `server` — no client read found. Safe to edit; world-server restart only.
 * - `cosmetic` — client reads it for display only. A stale client shows stale
 *   text or numbers; nothing diverges.
 * - `structural` — client runs logic on it (`Mover.cpp` recomputes the NPC head
 *   icon from the begin/end conditions itself, `WndQuest.cpp` renders the goal
 *   list from the same fields). A stale client shows a quest as available when it
 *   is not, or vice versa.
 *
 * Only 14 of 74 commands are `server`. That asymmetry is why the editor bands by
 * tier rather than offering one flat form.
 *
 * @module lib/quest-fields
 */

/** How one argument must be edited and re-emitted. */
export type QuestArgKind =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'item'
  | 'mover'
  | 'job'
  | 'character-key'
  | 'quest-id'
  | 'skill-id'
  | 'text-token'
  | 'destination-id'
  | 'enum:sex'
  | 'enum:compare'
  | 'enum:condItemType'
  | 'enum:questKind'
  | 'world-id';

/** What a client running an older `dataSub1.res` does with a changed value. */
export type BlastTier = 'server' | 'cosmetic' | 'structural';

export interface QuestArgSpec {
  name: string;
  kind: QuestArgKind;
  /** Game meaning, not the type. Shown as the control's hint. */
  hint?: string;
  /** Value meaning "unset" — kept as-is rather than normalized to 0. */
  sentinel?: number;
  min?: number;
  max?: number;
  /** `#define` prefix the symbol form comes from, for the writer's symbol ladder. */
  prefix?: string;
}

export interface QuestCmdSpec {
  /** Positional args, in the order the C++ consumes them. */
  args: readonly QuestArgSpec[];
  /**
   * Trailing repeating group: `{ size }` args repeat until `)`. `size: 1` is a
   * plain variadic list.
   */
  repeat?: { size: number; max: number };
  tier: BlastTier;
  /** Why this tier — a `file:line` the reviewer can check. */
  evidence: string;
  label: string;
  hint?: string;
  /** Present in the shipped data? Absent commands are still editable but rare. */
  uses?: number;
}

const SEX: QuestArgSpec = {
  name: 'sex',
  kind: 'enum:sex',
  hint: '-1 = any',
  sentinel: -1,
};
const COND_TYPE: QuestArgSpec = {
  name: 'type',
  kind: 'enum:condItemType',
  hint: '0 = by job slot, 1 = by item id',
};
const JOB_OR_ITEM: QuestArgSpec = {
  name: 'jobOrItem',
  kind: 'int',
  hint: 'Job slot when type=0 (clamped to MAX_QUESTCONDITEM), else unused',
  sentinel: -1,
};

/** The 5-arg `(sex, type, jobOrItem, itemId, count)` shape shared by 4 commands. */
const COND_ITEM_ARGS: readonly QuestArgSpec[] = [
  SEX,
  COND_TYPE,
  JOB_OR_ITEM,
  { name: 'itemId', kind: 'item', prefix: 'II_' },
  { name: 'count', kind: 'int', min: 0 },
];

/**
 * `__IMPROVE_QUEST_INTERFACE` optional goal-marker tail (`Project.cpp:1906-1921`
 * and siblings). Present only when a `,` follows the required args. The client
 * draws the minimap goal arrow from these, so they are structural.
 */
const GOAL_TAIL: readonly QuestArgSpec[] = [
  { name: 'goalX', kind: 'float', hint: 'Minimap goal marker X' },
  { name: 'goalZ', kind: 'float', hint: 'Minimap goal marker Z' },
  { name: 'goalTextId', kind: 'destination-id', prefix: 'QUEST_DESTINATION_ID_' },
];

export const QUEST_CMDS: Readonly<Record<string, QuestCmdSpec>> = {
  // ── Identity / classification ──
  SetTitle: {
    args: [{ name: 'token', kind: 'text-token', prefix: 'IDS_' }],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:186 reads m_szTitle for the quest list',
    label: 'Title',
    hint: 'propQuest.txt.txt token. Edit the text, not the token.',
  },
  SetNPCName: {
    args: [{ name: 'token', kind: 'text-token', prefix: 'IDS_' }],
    tier: 'server',
    evidence: 'm_szNpcName: no read found in Neuz/, _Interface/, or Mover.cpp',
    label: 'NPC name override',
  },
  SetHeadQuest: {
    args: [{ name: 'kind', kind: 'enum:questKind' }],
    tier: 'structural',
    evidence: 'WndQuest.cpp:221 groups the quest tree by m_nHeadQuest',
    label: 'Quest category',
    hint: '1800-1999 are remapped to QUEST_KIND_* by Project.cpp:2387',
    uses: 441,
  },
  SetQuestType: {
    args: [{ name: 'type', kind: 'int' }],
    tier: 'server',
    evidence: 'm_nQuestType: no client read found',
    label: 'Quest type',
    uses: 4,
  },
  SetRemove: {
    args: [{ name: 'removable', kind: 'bool', hint: '0 = cannot be abandoned' }],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:386 hides the Give Up button on m_bNoRemove',
    label: 'Abandonable',
  },
  SetRepeat: {
    args: [{ name: 'repeat', kind: 'bool' }],
    tier: 'server',
    evidence: 'm_bRepeat: no client read found',
    label: 'Repeatable',
    uses: 145,
  },
  SetCharacter: {
    args: [{ name: 'key', kind: 'character-key' }],
    tier: 'structural',
    evidence:
      "no field; registers the quest on the NPC's m_awSrcQuest (Project.cpp:1520), " +
      'which Mover.cpp:1068 walks to decide the head icon',
    label: 'Quest giver',
    uses: 418,
  },
  SetParam: {
    args: [
      { name: 'index', kind: 'int', min: 0, max: 3 },
      { name: 'value', kind: 'int' },
    ],
    tier: 'server',
    evidence: 'm_nParam: no client read found',
    label: 'Script param',
  },

  // ── Begin conditions ──
  //
  // Every one of these is structural: Mover.cpp:9930-10290 evaluates the entire
  // begin-condition set client-side to decide whether to draw the `!` head icon.
  // A stale client offers a quest the server refuses, or hides one it allows.
  SetBeginCondLevel: {
    args: [
      { name: 'min', kind: 'int', min: 0 },
      { name: 'max', kind: 'int', min: 0 },
    ],
    tier: 'structural',
    evidence: 'Mover.cpp:10000 gates the head icon on the level range',
    label: 'Level range',
    uses: 432,
  },
  SetBeginCondJob: {
    args: [{ name: 'job', kind: 'job', prefix: 'JOB_' }],
    repeat: { size: 1, max: 40 },
    tier: 'structural',
    evidence: 'Mover.cpp:9993 walks m_nBeginCondJob for the head icon',
    label: 'Allowed jobs',
    hint: 'Reads until `)`, capped at MAX_JOB (Project.cpp:1650)',
    uses: 432,
  },
  SetBeginCondSex: {
    args: [SEX],
    tier: 'structural',
    evidence: 'Mover.cpp:10106',
    label: 'Required sex',
  },
  SetBeginCondParty: {
    args: [
      { name: 'inParty', kind: 'bool' },
      { name: 'numComp', kind: 'enum:compare' },
      { name: 'num', kind: 'int', min: 0 },
      { name: 'mustBeLeader', kind: 'bool' },
    ],
    tier: 'structural',
    evidence: 'Mover.cpp:10003-10044',
    label: 'Party requirement',
    uses: 428,
  },
  SetBeginCondGuild: {
    args: [
      { name: 'inGuild', kind: 'bool' },
      { name: 'numComp', kind: 'enum:compare' },
      { name: 'num', kind: 'int', min: 0 },
      { name: 'mustBeLeader', kind: 'bool' },
    ],
    tier: 'structural',
    evidence: 'Mover.cpp:10053-10097',
    label: 'Guild requirement',
    uses: 3,
  },
  SetBeginCondSkillLvl: {
    args: [
      { name: 'skillId', kind: 'skill-id', prefix: 'SI_' },
      { name: 'level', kind: 'int', min: 0 },
    ],
    tier: 'structural',
    evidence: 'Mover.cpp:10109-10116',
    label: 'Skill level requirement',
  },
  SetBeginCondPreviousQuest: {
    args: [
      { name: 'mode', kind: 'int', hint: '0 = all required, 1 = any one' },
      { name: 'questId', kind: 'quest-id', prefix: 'QUEST_' },
    ],
    repeat: { size: 1, max: 6 },
    tier: 'structural',
    evidence: 'Mover.cpp:9949-9967 walks the prerequisite list',
    label: 'Prerequisite quests',
    hint: 'Up to 6 ids after the mode flag (Project.cpp:1663)',
    uses: 163,
  },
  SetBeginCondExclusiveQuest: {
    args: [{ name: 'questId', kind: 'quest-id', prefix: 'QUEST_' }],
    repeat: { size: 1, max: 6 },
    tier: 'structural',
    evidence: 'Mover.cpp:9977-9981',
    label: 'Mutually exclusive quests',
  },
  SetBeginCondItem: {
    args: COND_ITEM_ARGS,
    tier: 'structural',
    evidence: 'Mover.cpp:10239-10246 reads m_paBeginCondItem',
    label: 'Required item to start',
    uses: 41,
  },
  SetBeginCondNotItem: {
    args: COND_ITEM_ARGS,
    tier: 'structural',
    evidence: 'Mover.cpp:10130-10137',
    label: 'Item that blocks starting',
    uses: 4,
  },
  SetBeginCondPKValue: {
    args: [{ name: 'pkValue', kind: 'int' }],
    tier: 'structural',
    evidence: 'Mover.cpp:10122',
    label: 'PK value requirement',
    uses: 1,
  },
  SetBeginCondDisguise: {
    args: [{ name: 'moverId', kind: 'mover', prefix: 'MI_' }],
    tier: 'structural',
    evidence: 'Mover.cpp:10203-10210',
    label: 'Required disguise',
  },
  SetBeginCondPetLevel: {
    args: [{ name: 'level', kind: 'int', min: 0 }],
    tier: 'structural',
    evidence: 'Mover.cpp:10223-10228',
    label: 'Pet level requirement',
    uses: 10,
  },
  SetBeginCondPetExp: {
    args: [{ name: 'exp', kind: 'int', min: 0 }],
    tier: 'structural',
    evidence: 'Mover.cpp:10215-10220',
    label: 'Pet exp requirement',
  },
  SetBeginCondTutorialState: {
    args: [{ name: 'state', kind: 'int' }],
    tier: 'structural',
    evidence: 'Mover.cpp:10233',
    label: 'Tutorial state requirement',
    uses: 1,
  },
  SetBeginCondTSP: {
    args: [{ name: 'tsp', kind: 'int' }],
    tier: 'structural',
    evidence: 'Mover.cpp:10276-10280',
    label: 'TSP requirement',
  },

  // ── Begin effects (applied on accept) ──
  SetBeginSetAddGold: {
    args: [{ name: 'gold', kind: 'int', min: 0 }],
    tier: 'server',
    evidence: 'm_nBeginSetAddGold: no client read found',
    label: 'Gold granted on accept',
  },
  SetBeginSetAddItem: {
    args: [
      { name: 'index', kind: 'int', min: 0, max: 3 },
      { name: 'itemId', kind: 'item', prefix: 'II_' },
      { name: 'count', kind: 'int', min: 0 },
    ],
    tier: 'cosmetic',
    evidence: 'Mover.cpp:9936 reads m_nBeginSetAddItemIdx (id only, not count)',
    label: 'Item granted on accept',
    uses: 11,
  },
  SetBeginSetDisguise: {
    args: [{ name: 'moverId', kind: 'mover', prefix: 'MI_' }],
    tier: 'server',
    evidence: 'm_nBeginSetDisguiseMoverIndex: no client read found',
    label: 'Disguise applied on accept',
  },

  // ── End conditions (the objectives) ──
  //
  // WndQuest.cpp:447-1060 renders the whole objective list from these fields, and
  // Mover.cpp:9540-9880 re-evaluates them for the completion (`?`) head icon.
  SetEndCondItem: {
    args: [...COND_ITEM_ARGS, ...GOAL_TAIL],
    tier: 'structural',
    evidence: 'WndQuest.cpp:522 lists required items; Mover.cpp:9838 re-checks them',
    label: 'Item to collect',
    hint: 'Goal marker args are optional (Project.cpp:1907)',
    uses: 449,
  },
  SetEndCondOneItem: {
    args: COND_ITEM_ARGS,
    tier: 'structural',
    evidence: 'WndQuest.cpp:793; Mover.cpp:9794',
    label: 'Any one of these items',
    uses: 4,
  },
  SetEndCondKillNPC: {
    args: [
      { name: 'index', kind: 'int', min: 0, max: 1, hint: 'Slot 0 or 1' },
      { name: 'moverId', kind: 'mover', prefix: 'MI_' },
      { name: 'count', kind: 'int', min: 0 },
      ...GOAL_TAIL,
    ],
    tier: 'structural',
    evidence: 'WndQuest.cpp:508 renders the kill counter; Mover.cpp:5513 counts kills',
    label: 'Monsters to kill',
    uses: 135,
  },
  SetEndCondCharacter: {
    args: [
      { name: 'key', kind: 'character-key' },
      { name: 'worldId', kind: 'world-id', hint: 'Goal marker world' },
      { name: 'goalX', kind: 'float' },
      { name: 'goalZ', kind: 'float' },
      { name: 'goalTextId', kind: 'destination-id', prefix: 'QUEST_DESTINATION_ID_' },
    ],
    tier: 'structural',
    evidence:
      'WndQuest.cpp:910 names the turn-in NPC; DPClient.cpp:18689 reads ' +
      'm_szEndCondCharacter + m_MeetCharacterGoalData for the marker',
    label: 'Turn in to NPC',
    hint: "Empty key falls back to SetCharacter's key (Project.cpp:1997)",
    uses: 306,
  },
  SetEndCondMultiCharacter: {
    args: [
      { name: 'key', kind: 'character-key' },
      { name: 'itemId', kind: 'item', prefix: 'II_' },
    ],
    repeat: { size: 2, max: 10 },
    tier: 'structural',
    evidence: 'WndQuest.cpp:938 reads m_lpszEndCondMultiCharacter',
    label: 'Turn in to any of these NPCs',
  },
  SetEndCondDialog: {
    args: [
      { name: 'charKey', kind: 'character-key' },
      { name: 'addKey', kind: 'string', hint: "AddKey label in the NPC's dialog" },
      ...GOAL_TAIL,
    ],
    tier: 'structural',
    evidence: 'WndQuest.cpp:901 reads m_szEndCondDlgCharKey; :2322 the goal marker',
    label: 'Complete via dialog choice',
  },
  SetEndCondPatrolZone: {
    args: [
      { name: 'worldId', kind: 'world-id' },
      { name: 'left', kind: 'int' },
      { name: 'top', kind: 'int' },
      { name: 'right', kind: 'int' },
      { name: 'bottom', kind: 'int' },
      { name: 'destinationId', kind: 'destination-id', prefix: 'QUEST_DESTINATION_ID_' },
      ...GOAL_TAIL,
    ],
    tier: 'structural',
    evidence: 'WndQuest.cpp:566 + Mover.cpp:1073 read the rect and world',
    label: 'Zone to visit',
    hint: 'Rect is normalized by Project.cpp:1969',
    uses: 5,
  },
  SetEndCondLevel: {
    args: [
      { name: 'min', kind: 'int', min: 0 },
      { name: 'max', kind: 'int', min: 0 },
    ],
    tier: 'structural',
    evidence: 'Mover.cpp:9580',
    label: 'Level range to complete',
    uses: 168,
  },
  SetEndCondGold: {
    args: [{ name: 'gold', kind: 'int', min: 0 }],
    tier: 'structural',
    evidence: 'Mover.cpp:9572',
    label: 'Gold to hold',
    uses: 4,
  },
  SetEndCondState: {
    args: [{ name: 'state', kind: 'int', hint: 'state N block that must be reached' }],
    tier: 'structural',
    evidence: 'Mover.cpp:9655 compares against m_questState',
    label: 'Required state',
    uses: 17,
  },
  SetEndCondCompleteQuest: {
    args: [
      { name: 'oper', kind: 'int', hint: '0 = all, 1 = any' },
      { name: 'questId', kind: 'quest-id', prefix: 'QUEST_' },
    ],
    repeat: { size: 1, max: 6 },
    tier: 'structural',
    evidence: 'Mover.cpp:9670-9689',
    label: 'Quests that must be complete',
  },
  SetEndCondSkillLvl: {
    args: [
      { name: 'skillId', kind: 'skill-id', prefix: 'SI_' },
      { name: 'level', kind: 'int', min: 0 },
    ],
    tier: 'structural',
    evidence: 'WndQuest.cpp:594; Mover.cpp:9559',
    label: 'Skill level to reach',
  },
  SetEndCondExpPercent: {
    args: [
      { name: 'min', kind: 'int', min: 0, max: 100 },
      { name: 'max', kind: 'int', min: 0, max: 100 },
    ],
    tier: 'structural',
    evidence: 'Mover.cpp:9583',
    label: 'Exp percent range',
    uses: 3,
  },
  SetEndCondLimitTime: {
    args: [{ name: 'seconds', kind: 'int', min: 0 }],
    tier: 'structural',
    evidence: 'WndQuest.cpp:493 shows the timer; Mover.cpp:1085 enforces it',
    label: 'Time limit',
  },
  SetEndCondParty: {
    args: [
      { name: 'inParty', kind: 'bool' },
      { name: 'numComp', kind: 'enum:compare' },
      { name: 'num', kind: 'int', min: 0 },
      { name: 'mustBeLeader', kind: 'bool' },
    ],
    tier: 'structural',
    evidence: 'WndQuest.cpp:644; Mover.cpp:9695',
    label: 'Party requirement to complete',
    uses: 3,
  },
  SetEndCondGuild: {
    args: [
      { name: 'inGuild', kind: 'bool' },
      { name: 'numComp', kind: 'enum:compare' },
      { name: 'num', kind: 'int', min: 0 },
      { name: 'mustBeLeader', kind: 'bool' },
    ],
    tier: 'structural',
    evidence: 'WndQuest.cpp:716; Mover.cpp:9746',
    label: 'Guild requirement to complete',
    uses: 5,
  },
  SetEndCondDisguise: {
    args: [{ name: 'moverId', kind: 'mover', prefix: 'MI_' }],
    tier: 'structural',
    evidence: 'WndQuest.cpp:574; Mover.cpp:9644',
    label: 'Required disguise to complete',
  },
  SetEndCondPetLevel: {
    args: [{ name: 'level', kind: 'int', min: 0 }],
    tier: 'structural',
    evidence: 'Mover.cpp:9633',
    label: 'Pet level to reach',
    uses: 10,
  },
  SetEndCondPetExp: {
    args: [{ name: 'exp', kind: 'int', min: 0 }],
    tier: 'structural',
    evidence: 'Mover.cpp:9625',
    label: 'Pet exp to reach',
    uses: 10,
  },
  SetEndCondTSP: {
    args: [{ name: 'tsp', kind: 'int' }],
    tier: 'structural',
    evidence: 'Mover.cpp:9875',
    label: 'TSP to reach',
  },

  // ── Rewards ──
  //
  // WndQuest.cpp:971-1060 renders the reward panel from these, so a mismatch
  // shows the player the wrong prize — visible, but no logic diverges. The
  // *server* grants the real reward either way.
  SetEndRewardItem: {
    args: [
      SEX,
      COND_TYPE,
      JOB_OR_ITEM,
      { name: 'itemId', kind: 'item', prefix: 'II_' },
      { name: 'count', kind: 'int', min: 0 },
      { name: 'flag', kind: 'int', hint: 'Bind-on-acquire flag (optional)' },
    ],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:973 reads m_paEndRewardItem for display only',
    label: 'Item reward',
    uses: 665,
  },
  SetEndRewardItemWithAbilityOption: {
    args: [
      SEX,
      COND_TYPE,
      JOB_OR_ITEM,
      { name: 'itemId', kind: 'item', prefix: 'II_' },
      { name: 'count', kind: 'int', min: 0 },
      { name: 'abilityOption', kind: 'int' },
      { name: 'flag', kind: 'int', hint: 'Bind-on-acquire flag (optional)' },
    ],
    tier: 'cosmetic',
    evidence: 'shares m_paEndRewardItem with SetEndRewardItem (WndQuest.cpp:973)',
    label: 'Item reward with option',
    uses: 1,
  },
  SetEndRewardGold: {
    args: [
      { name: 'min', kind: 'int', min: 0 },
      { name: 'max', kind: 'int', min: 0 },
    ],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:1013 displays the gold range',
    label: 'Gold reward',
    uses: 59,
  },
  SetEndRewardExp: {
    args: [
      { name: 'min', kind: 'int', min: 0 },
      { name: 'max', kind: 'int', min: 0 },
    ],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:1026 displays m_nEndRewardExpMin only',
    label: 'Exp reward',
    uses: 85,
  },
  SetEndRewardSkillPoint: {
    args: [{ name: 'points', kind: 'int', min: 0 }],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:1031',
    label: 'Skill point reward',
    uses: 22,
  },
  SetEndRewardPKValue: {
    args: [
      { name: 'min', kind: 'int' },
      { name: 'max', kind: 'int' },
    ],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:1037 displays m_nEndRewardPKValueMin',
    label: 'PK value reward',
    uses: 1,
  },
  SetEndRewardHide: {
    args: [{ name: 'hide', kind: 'bool' }],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:986 hides the whole reward panel',
    label: 'Hide rewards in UI',
    uses: 66,
  },
  SetEndRewardTeleport: {
    args: [
      { name: 'worldId', kind: 'world-id' },
      { name: 'x', kind: 'float' },
      { name: 'y', kind: 'float' },
      { name: 'z', kind: 'float' },
    ],
    tier: 'server',
    evidence: 'm_nEndRewardTeleport / Pos: no client read found',
    label: 'Teleport on completion',
    uses: 1,
  },
  SetEndRewardPetLevelup: {
    args: [],
    tier: 'server',
    evidence: 'm_bEndRewardPetLevelup: no client read found',
    label: 'Level up the pet',
    hint: 'Takes no arguments (Project.cpp:2225)',
    uses: 10,
  },
  SetEndRewardTSP: {
    args: [{ name: 'tsp', kind: 'int' }],
    tier: 'server',
    evidence: 'm_nEndRewardTSP: no client read found',
    label: 'TSP reward',
  },
  SetDlgRewardItem: {
    args: [
      { name: 'index', kind: 'int', min: 0, max: 3 },
      { name: 'itemId', kind: 'item', prefix: 'II_' },
      { name: 'count', kind: 'int', min: 0 },
    ],
    tier: 'server',
    evidence: 'm_nDlgRewardItemIdx/Num: no client read found',
    label: 'Dialog-choice reward item',
  },

  // ── Costs on completion ──
  SetEndRemoveItem: {
    args: [
      { name: 'index', kind: 'int', min: 0, max: 7 },
      { name: 'itemId', kind: 'item', prefix: 'II_' },
      { name: 'count', kind: 'int', min: 0 },
    ],
    tier: 'server',
    evidence: 'm_nEndRemoveItemIdx/Num: no client read found',
    label: 'Item consumed on completion',
    hint: 'Index 0-7, though the C++ error text says 0-3 (Project.cpp:2302)',
    uses: 428,
  },
  SetEndRemoveGold: {
    args: [{ name: 'gold', kind: 'int', min: 0 }],
    tier: 'server',
    evidence: 'm_nEndRemoveGold: no client read found',
    label: 'Gold consumed on completion',
    uses: 4,
  },
  SetEndRemoveQuest: {
    args: [{ name: 'questId', kind: 'quest-id', prefix: 'QUEST_' }],
    repeat: { size: 1, max: 8 },
    tier: 'server',
    evidence: 'm_anEndRemoveQuest: no client read found',
    label: 'Quests cleared on completion',
  },
  SetEndRemoveTSP: {
    args: [{ name: 'tsp', kind: 'int' }],
    tier: 'server',
    evidence: 'm_nEndRemoveTSP: no client read found',
    label: 'TSP consumed on completion',
  },

  // ── Text ──
  SetDialog: {
    args: [
      { name: 'slot', kind: 'int', min: 0, max: 31 },
      { name: 'token', kind: 'text-token', prefix: 'IDS_' },
    ],
    tier: 'server',
    evidence:
      'm_apQuestDialog is inside #if defined(__WORLDSERVER) (Project.cpp:2362, ' +
      'Project.h:288) — compiled out of the client entirely',
    label: 'Quest story text',
    hint: 'The only text field that is genuinely server-only',
  },
  SetPatrolZoneName: {
    args: [{ name: 'token', kind: 'text-token', prefix: 'IDS_' }],
    tier: 'cosmetic',
    evidence: 'WndQuest.cpp:568 displays m_szPatrolZoneName',
    label: 'Patrol zone name',
    hint: 'Must render under 64 chars or the loader errors (Project.cpp:2376)',
  },

  // ── Drops ──
  QuestItem: {
    args: [
      { name: 'moverId', kind: 'mover', prefix: 'MI_' },
      { name: 'itemId', kind: 'item', prefix: 'II_' },
      { name: 'probability', kind: 'int', min: 0 },
      { name: 'count', kind: 'int', min: 1 },
    ],
    tier: 'server',
    evidence:
      'attaches to MoverProp::m_QuestItemGenerator (Project.cpp:2338); the client ' +
      'never rolls drops',
    label: 'Quest item drop',
    hint: 'Valid at block level and inside a state block',
  },
};

/** Commands the client reads — editing one needs a client patch export. */
export function needsClientPatch(cmd: string): boolean {
  const spec = questCmdSpec(cmd);
  // An unknown command is treated as needing a patch: it is safer to over-warn
  // than to tell a GM an edit is server-only when nothing here knows what it is.
  return spec === undefined || spec.tier !== 'server';
}

/**
 * Spec for a command, or `undefined` when it is unknown.
 *
 * Two tokens in the shipped data have no parse branch in `LoadPropQuest` and are
 * therefore dead: `SetBeginCondCharacter` (243 occurrences in
 * `raw/propQuest.inc`, silently ignored by both server and client) and
 * `SetEndCondGuildWarWin` (1). They resolve to `undefined` here so the editor
 * shows them read-only rather than offering controls that change nothing.
 */
export function questCmdSpec(cmd: string): QuestCmdSpec | undefined {
  return Object.prototype.hasOwnProperty.call(QUEST_CMDS, cmd) ? QUEST_CMDS[cmd] : undefined;
}
