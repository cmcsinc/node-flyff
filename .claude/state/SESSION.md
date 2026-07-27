# Session: 2026-07-27

## Current Task
Fix: NPCs showing quest icon above head but dialog offers no quest.

## Root Cause (confirmed via game/source C++)
- Quest icon is **client-computed** every frame in `CMover::ProcessQuest` (`_Common/Mover.cpp:1118-1159`), driven by the NPC's `m_awSrcQuest`/`m_awDstQuest` loaded from the client's own `propQuest.inc` at boot (NOT network). Server sends NO NPC quest data in ADD_OBJ.
- Icon types: 1=yellow"!" new, 2=grey"?" in-progress, 3=green"?" completable, 4=grey"!" next-level.
- Canonical server offer scan = C++ `__QuestEnd` (`_Common/ScriptHelper.cpp:542-586`) which classifies NPC quests into **4 buckets**: vecNewQuest / vecNextQuest / vecEndQuest / vecCurrQuest, emitting one dialog row per quest.
- Server `ScriptDlgService.emitQuestOffer` only emitted 2 of 4 buckets (new + end). **Dropped next-level (grey !) and in-progress-not-complete (grey ?)** → those NPCs showed an icon but the click dialog had no quest row.

## Fix (implemented, my-side tests green; NOT user-confirmed)
- `packages/quest/src/services/questConditions.ts`: added `isNextLevel()` (port of `__IsNextLevelQuest`, Mover.cpp:10301) — refactored `canBegin` body into shared `evalBegin(.., nextLevel)`; next-level mode requires a `SetBeginCondLevel` present with `level < min && level+5 >= min`.
- `packages/npc/src/services/scriptDlg.service.ts`: `emitQuestOffer` now mirrors `__QuestEnd`'s 4-bucket classification across begin+end quest lists (deduped); emits `NEWQUEST/QUEST_NEXT_LEVEL` for next-level and `CURRQUEST/QUEST_END` for current quests. Tightened the single-new-quest shortcut to require all other buckets empty.
- Tests: `questConditions.test.ts` (+5 isNextLevel cases), `scriptDlg.service.test.ts` (+3 offer-scan cases: next-level row, current-quest row, new+current lists both).

## Test Results (my side)
- @flyff/quest: 65/0 pass
- @flyff/npc: 152/0 pass
- @flyff/world-server: 232/0 pass

## Files Modified
- packages/quest/src/services/questConditions.ts
- packages/npc/src/services/scriptDlg.service.ts
- packages/quest/test/services/questConditions.test.ts
- packages/npc/test/services/scriptDlg.service.test.ts

## Branch / Commit
NOT committed (override rule: no auto-commit). Changes in working tree on master. Awaiting user in-game test before marking fixed.

## Next
User: test in-game — click an NPC that previously showed a quest icon with no dialog offer. Should now list the quest (yellow"!" accept, grey"!" come-back-later, or grey"?" in-progress).
