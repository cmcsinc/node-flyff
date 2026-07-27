# Session: 2026-07-27

## Current Task
NPC quest-icon/but-no-offer bug — investigation ongoing (NOT fixed)

## What was tried (both dead ends)
**Path 1: byNpc key mismatch.** Found 8 NPCs in character.inc + propQuest.inc not in server byNpc. BUT: all 8 are from quest blocks inside a `/* */` comment in propQuest.inc (QUEST_PANG at line 15975+). Commented out in source → client also doesn't load them. **Red herring.**

**Path 2: Classification failure.** 4-bucket offer scan (new/next/end/curr) already shipped in a22b94a. User confirms problem persists AFTER that commit. The 4-bucket logic matches C++ `__QuestEnd` (ScriptHelper.cpp:542-586).

## Diagnostic log pushed
Commit `dbb14a8` adds a warn log in `emitQuestOffer` when it returns 0 rows. Distinguishes:
- `byNpc miss` — NPC key not in begin/end maps
- `NPC has byNpc entries but 0 rows classified` — all quests failed classification

## What the user needs to do
Rebuild, click ONE affected NPC, check pino log for `quest offer:` warn line. That line reveals the exact cause. Share the NPC name + log line.

## Key architectural facts confirmed
- Quest icon is CLIENT-SIDE (CMover::ProcessQuest, Mover.cpp:1118-1159). Server sends zero NPC quest data.
- Server's byNpc has 178 begin-NPCs, 131 end-NPCs, 489 quest defs.
- Client's propQuest.inc is IDENTICAL to server's raw (diff confirmed).
- 81 quests have genuinely-empty SetCharacter("") in the source.
- canBegin matches C++ __IsBeginQuestCondition faithfully.
- isNextLevel added this session (port of __IsNextLevelQuest).

## Files Modified
- packages/quest/src/services/questConditions.ts (isNextLevel added)
- packages/npc/src/services/scriptDlg.service.ts (4-bucket classify + diagnostic log)
- packages/quest/test/services/questConditions.test.ts (+5 tests)
- packages/npc/test/services/scriptDlg.service.test.ts (+3 tests)

## Commits
- a22b94a (prior session): 4-bucket offer scan
- aa0802b: party system commit + push
- dbb14a8: diagnostic log pushed
