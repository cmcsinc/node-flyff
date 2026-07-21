# Session State

- **Goal**: Implement quest system (full engine) — check old client C++ for references
- **Branch**: master
- **Status**: 🔄 Phase 1 + 2 DONE. Phases 3–7 pending.
- **Plan**: `C:\Users\Cyan\.claude\plans\delegated-skipping-cloud.md`

## Phase 1 shipped ✅ (tests green, tsc clean)

### Constants (`packages/core`)
- `src/constants/quest.ts` — QS_BEGIN=0, QS_END=14, MAX_QUEST=100, MAX_COMPLETE_QUEST=300, MAX_CHECKED_QUEST=5, REMOVEQUEST_TYPE, QUEST_LOG_ACTION (10/20/30), QUEST_TYPE, QUEST_KIND, QUEST_FLAG. Exported via core `index.ts`.
- `src/constants/opcodes.ts` — added REMOVEQUEST=0x00ff0026, QUESTHELPER_REQNPCPOS=0x70005000, QUEST_CHECK=0x88100110.
- `world-server/src/net/snapshot/constants.ts` — added SNAPSHOTTYPE_SETQUEST=0x00b0, QUEST_REMOVE=0x003a, QUEST_TEXT_TIME=0x00ba, QUESTHELPER_NPCPOS=0x9400, QUEST_CHECKED=0x8820.

### Resources (`packages/resources`)
- `src/schemas/quest.schema.ts` — QuestDef (id, symbol, title, commands[{cmd,args}], states, dialog, quest_items).
- `scripts/converters/questTokenize.ts` — tokenizer (handles multi-line .inc grammar) + loadAllDefines (all define*.h → symbol→number map).
- `scripts/converters/quests.ts` — propQuest.inc → data/quests/*.yml. Recursive-descent parser; flattens Set* commands; routes SetTitle/SetDialog/state/QuestItem. **285 quests converted, verified correct on QUEST_1** (id 7, JOB_VAGRANT→5, lvl5-15, 500 gold).
- `src/loaders/quest.loader.ts` — loadQuests → {byId: Map, drops: Map<MI_*, QuestItem[]>}. Wired into ResourceIndex + convert.ts + schemas/index.ts.

### Database (`packages/database`)
- `src/migrations/002_quests.ts` — character_quests, character_completed_quests, character_checked_quests, quest_log.
- `src/repositories/quest.repo.ts` — QuestRepository: loadState/upsertActive/removeActive/addCompleted/removeCompleted/clearCompleted/setChecked/insertLog. Exported via index.ts.
- `test/repositories/quest.repo.test.ts` — 6 tests. **database 96/96 green.**

## Key verified facts (research report + my confirmation)
- QUEST struct = 12 bytes (MSVC x86 align): `[u8 state][pad][u16 time][u16 id][u16 kill0][u16 kill1][u8 flags][pad]`. Padding goes on wire.
- JOIN blob writes quest arrays INLINE after the 3 size bytes (ObjSerializeOpt.cpp:201-207). Current mover.serializer writes 0/0/0 → no arrays.
- propQuest.inc is UTF-16LE; 285 real quest blocks; 40 Set* commands.
- `SETQUEST=0x00ff0ff3` in opcodes.ts is suspect (no such C++ opcode) — keep, real path is SNAPSHOTTYPE_SETQUEST=0x00b0.

## Next: Phase 2 — per-player state + JOIN sync
- CPlayer: m_aQuest/m_aCompleteQuest/m_aCheckedQuest + findQuest/setQuest/removeQuest helpers
- quest.serializer.ts: writeQuestStruct (12B), buildSetQuest/buildRemoveQuest/buildCheckedQuest/buildQuestTextTime/buildNpcPos
- mover.serializer.ts: replace lines 111-113 zero-bytes with real inline arrays
- quest.service.loadOnJoin
- Byte-exact serializer tests

## Phase 2 shipped ✅ (world-server 148/148 tests green, tsc clean)
- `entities/player.ts` — m_aQuest/m_aCompleteQuest/m_aCheckedQuest + findQuest/setQuest/removeQuest/isCompleteQuest (mirror MoverParam.cpp).
- `net/snapshot/quest.serializer.ts` — writeQuestStruct (12B byte-exact) + buildSetQuest/buildRemoveQuest/buildCheckedQuest/buildQuestTextTime/buildNpcPos. RuntimeQuest type. (6 tests)
- `net/snapshot/mover.serializer.ts` — replaced 0/0/0 with inline quest arrays (ObjSerializeOpt.cpp:201-207). Fresh player still writes 3 size bytes → empty arrays → JOIN byte length unchanged.
- `services/quest.service.ts` — loadOnJoin hydrates arrays from QuestRepository. (3 tests)
- `services/join.service.ts` + `compose.ts` — questService wired, called after CPlayer.fromRow.

## Pre-existing (not regressions)
- core js-yaml TS7016 (PROGRESS.md known blocker).

## Next: Phase 3 — begin/complete condition + reward engine
- `services/questConditions.ts` — canBegin/isComplete evaluating all Set*Begin/Set*End commands positionally from QuestDef.commands. Inject inventory/party/guild deps (stubs OK, ponytail).
- `services/questRewards.ts` — applyBeginSet/applyEnd: SetEndReward{Item/Gold/Exp/PK/Teleport/Hide/PetLevelup}, SetEndRemove{Item/Gold/Quest}, sex/job filter. WAL journal item/gold/exp (rule 03/04).
- `services/quest.service.ts` — extend: beginQuest/setQuestState/endQuest with dupe guard, persist via questRepo, emit buildSetQuest (service returns frame; handler writes).
- Tests: each condition branch, reward grant, QUEST_1 worked example (vagrant lvl5-15, hand 20 teeth → 500 gold).

## Technical Context

- **Current Branch**: `master`
- **Branch**: master
- **Last**: Phase 2 green. world-server 148/148, database 96/96, resources convert+tsc clean.
- **Tasks**: #2 ✅ #3 ✅ #6 ✅. Next #7 (Phase 3).
