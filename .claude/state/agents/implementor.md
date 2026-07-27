# Implementor Agent Session

- **Agent**: implementor
- **Active Task**: M8+M13+M14+M15+M16+M17 medium-fidelity fixes
- **Phase**: Complete — all tests green
- **Last Updated**: 2026-07-27

## Current Work — M8+M13+M14+M15+M16+M17

- [x] M14: Already implemented — 400ms rate limit in removeQuest.handler.ts:52-57 (`m_tickScript`)
- [x] M15: Already implemented — QS_BEGIN=0, QS_END=14 in BUILTIN_CONST (dialogInterpreter.ts:43-44)
- [x] M8: Added party/guild checks to questConditions.evalBegin
  - Extended `InventoryOps` with optional `isInParty`, `isPartyLeader`, `partySize`, `isInGuild`, `isGuildLeader`, `guildSize`
  - `SetBeginCondParty`: mode 1 (must NOT be in party), mode 2 (must be in party + leader + size gate)
  - `SetBeginCondGuild`: mode 0 pass, mode 1 pass (not in guild), mode 2 fail (ponytail: no guild system)
  - Added `passesPartyGuildNum` helper (size comparison: eq/ge/le)
  - Added `'party'` and `'guild'` to QuestFailReason union type
  - Wired `PartyQuery` interface into `QuestServiceDeps.partyQuery` (structural type, no @flyff/party import)
  - `context()` populates `inv.isInParty`/`partySize`/`isPartyLeader` from PartyManager
- [x] M13: Fixed inverted target direction in target.service.ts
  - Added `m_idTargeter: number = NULL_ID` to CMover (Mover.h:589)
  - Claim now sets `mover.m_idTargeter = player.m_idPlayer` (not `player.m_idTarget = idTarget`)
  - Release clears `mover.m_idTargeter = NULL_ID` only if claimer releases
  - Added claim-gate: refuse if `mover.m_idTargeter !== NULL_ID` (already claimed)
  - Removed `player.m_idTarget` / `player._dirty` mutations (player target not in C++ OnSetTarget)
  - Updated 4 tests to check `mover.m_idTargeter` instead of `player.m_idTarget`
- [x] M16: Fixed nPart validation order in doEquip.handler.ts
  - Coerce `nPartRaw | 0` to signed int32 BEFORE validating range
  - Validate: `nPart !== -1 && (nPart < 0 || nPart > 30)` → PacketError
  - Old: `Validate.dword(nPartRaw)` always passed (uint32 range), then `| 0` silently made 0xFFFFFFFF → -1
- [x] M17: Renamed `slot` parameter to `nId` in updateItem.serializer.ts
  - All 6 wrapper functions + private `buildUpdateItem` now use `nId` (matches C++ `nId` naming)
  - Pure rename, no logic change

## Files changed
- `packages/entities/src/mover.ts` — added `m_idTargeter` field
- `packages/npc/src/services/target.service.ts` — M13 target direction fix
- `packages/npc/test/services/target.service.test.ts` — updated 4 assertions
- `packages/inventory/src/handlers/doEquip.handler.ts` — M16 validation order fix
- `packages/inventory/src/net/snapshot/updateItem.serializer.ts` — M17 slot→nId rename
- `packages/quest/src/services/questConditions.ts` — M8 party/guild checks + InventoryOps extension
- `packages/quest/src/services/quest.service.ts` — M8 PartyQuery wiring

## Test results
- npc 154/154 pass
- quest 60/60 pass
- inventory doEquip 4/4 + updateItem 2/2 pass
- entities 42/42 pass
- tsc: 0 new errors (line 213 questConditions.ts error is pre-existing)

## Reference
- `game/source/WORLDSERVER/DPSrvr.cpp:4349-4389` — OnSetTarget (m_idTargeter on TARGET)
- `game/source/_Common/Mover.h:589` — `OBJID m_idTargeter`
- `game/source/_Common/Mover.cpp:10003-10050` — __IsBeginQuestCondition party/guild
- `game/source/_Common/Project.cpp:1619-1640` — SetBeginCondParty/Guild parser
- `game/source/_Common/Project.h:136-143` — m_nBeginCondParty* fields
- `game/resource/definequest.h:971` — QS_END=14
- `game/resource/defineNeuz.h:93` — QS_BEGIN=0
