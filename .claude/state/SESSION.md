# Session State

- **Goal**: Implement quest system (full engine) — check old client C++ for references
- **Branch**: master
- **Status**: 🔄 Phase 1 + 2 + 3 DONE. Phases 4–7 pending.
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

## Phase 3 shipped ✅ (world-server 177/177 tests green, tsc clean)
- `services/questConditions.ts` (NEW, pure) — `canBegin`/`isComplete` evaluating Set*Begin/Set*End positionally from `QuestDef.commands`, mirrors `__IsBeginQuestCondition`/`__IsEndQuestCondition` (`_Common/Mover.cpp:7108/7393`). AND-semantics; sex/job item filter (`Mover.cpp:7308`); party/guild stubbed permissive (ponytail). `InventoryOps` interface (count/emptySlots).
- `services/questRewards.ts` (NEW) — `applyBeginSet`/`applyEnd`: SetEndReward{Item/Gold/Exp}, SetEndRemove{Item/Gold/Quest}, SetBeginSetAdd{Gold/Item}. Sex/job filter on reward items. `RewardSink` (inventory + journal). WAL-journals GOLD_CHANGE/EXP_CHANGE/ITEM_ADD/ITEM_REMOVE (rule 03/04). SetEndRemoveItem count<0 = remove-all (QUEST_1 teeth turn-in).
- `services/quest.service.ts` (extend) — `beginQuest`/`setQuestState`/`endQuest`/`cancelQuest`. Dupe guard via `CPlayer.setQuest`; persist via questRepo; audit log (QUEST_LOG_ACTION 10/20/30); returns outbound frames (buildSetQuest/buildRemoveQuest) for handler to write.
- `entities/player.ts` — added `m_nGold`/`m_nExp` (ponytail: no gold DB column yet; exp not hydrated from row).
- `compose.ts` — QuestService wired with `resources.quests` + `journal` (inventory left permissive stub).
- Tests: questConditions (13 branches), questRewards (6 grants/filters), quest.service QUEST_1 worked example (vagrant lvl10, 20 teeth → begin → end → 500 gold + teeth removed + completed; refuses under-level / under-teeth; cancel; WAL journal asserts).

## Next: Phase 4 — C→S quest handlers
- `handlers/removeQuest.handler.ts` — PACKETTYPE_REMOVEQUEST (DWORD questId), 400ms rate limit (m_tickScript, DPSrvr.cpp:1107), questService.cancelQuest → write frame.
- `handlers/questCheck.handler.ts` — PACKETTYPE_QUEST_CHECK (int questId, BOOL bCheck), update m_aCheckedQuest (cap 5), buildCheckedQuest.
- `handlers/questHelper.handler.ts` — PACKETTYPE_QUESTHELPER_REQNPCPOS (String charKey), resolve NPC pos via spawnManager, buildNpcPos or TID fail.
- `compose.ts` + dispatcher wiring (3 handlers).
- Companion tests per handler.

## Technical Context

- **Current Branch**: `master`
- **Branch**: master
- **Last**: Phase 2 green. world-server 148/148, database 96/96, resources convert+tsc clean.
- **Tasks**: #2 ✅ #3 ✅ #6 ✅ #7 ✅. Next #8 (Phase 4).
