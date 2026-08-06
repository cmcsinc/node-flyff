# C++ Fidelity Audit — 2026-07-27

> **Snapshot, not a live tracker.** These 64 findings were captured on
> 2026-07-27 and `.claude/state/MISSING-FEATURES.md` records them as resolved.
> Kept for provenance and for the C++ citations, which remain accurate as
> research. For current status use that checklist, not the severities below.
>
> Later deviations found after this snapshot are logged in
> `.claude/state/PROGRESS.md` → Lessons Learned rather than appended here (e.g.
> the 2026-08-04 `dwAttackRange` cast-reach vs `dwSkillRange` AoE-radius mixup
> in the skill cast-range gate).

All 6 domains audited against `game/source/` C++ spec. Findings listed by severity.

**Rule**: Every feature/bug has a C++ equivalent. This is a port, not new development.

---

## Summary

| Domain | CRITICAL | HIGH | MEDIUM | LOW |
|--------|----------|------|--------|-----|
| Combat formulas | 5 | 8 | 6 | 7 |
| Packet/handlers (world) | 1 | 2 | 2 | 1 |
| Packet/handlers (cluster) | 0 | 1 | 1 | 1 |
| Inventory/item | — | — | — | — |
| Skill system | — | — | — | — |
| NPC/quest/dialog | 0 | 6 | 11 | 8 |
| Player stats/vitals | 1 | 0 | 3 | 0 |
| **TOTAL** | **7** | **17** | **23** | **17** |

---

## CRITICAL — Must Fix

### C1. Player→NPC hit rate formula has wrong coefficients
- **File**: `packages/combat/src/combat/formulas.ts:187-193`
- **TS**: `(HR*1.5/(HR+parry)) * 2.0 * (LVL*0.5/(LVL+defLVL*0.3)) * 100`
- **C++** (`MoverAttack.cpp:333-336`): `(HR*1.6/(HR+parry)) * 1.5 * (LVL*1.2/(LVL+defLVL)) * 100`
- **Impact**: Player misses far more (or less) than intended vs monsters

### C2. Skill attacks can crit — C++ blocks it
- **File**: `packages/combat/src/combat/skillFormulas.ts:286-289`
- **TS**: `if (rng.int(100) < getCriticalProb(attacker)) { nATK *= 2.3 }`
- **C++** (`MoverAttack.cpp:800`): `if (IsSkillAttack(dwAtkFlags)) return FALSE;`
- **Impact**: Skill damage inflated by 2.3x when crit rolls — skills should never crit

### C3. Critical hit multiplier wrong — flat 2.3x vs variable range
- **File**: `packages/combat/src/combat/formulas.ts:277`
- **TS**: flat `nATK = Math.floor(nATK * 2.3)`
- **C++** (`MoverAttack.cpp:1659-1677`): variable `xRandom(1.1, 1.4)` pre-roll to min/max, then `*2.3` post-roll; 4th-attack crit uses `*2.6`
- **Impact**: Crit damage is always the same; C++ has a 1.1–1.4x variance layer

### C4. Hit-rate integer truncation differs
- **File**: `packages/combat/src/combat/formulas.ts:195`
- **TS**: floating point throughout, clamp at end
- **C++**: integer `(int)` cast on the full expression before clamp
- **Impact**: Intermediate rounding changes hit probability by 1-2%

### C5. Magic element factor compares wrong elements — skill vs defender instead of skill vs weapon
- **File**: `packages/combat/src/combat/skillFormulas.ts:176-178`
- **TS**: compares skill element vs **defender's** element → fire spell vs fire monster gets 1.1x
- **C++** (`MoverAttack.cpp:1140-1169`): compares skill element vs **attacker's weapon** element → fire wand casting fire spell gets 1.1x synergy
- **Impact**: Every magic skill's element factor applied to wrong target. The `Combatant` interface has no weapon-element field for the attacker in the magic skill path.

### C6. Recovery uses raw m_nSta/m_nInt, not DST-adjusted
- **File**: `packages/world-server/src/systems/recovery.system.ts:106`
- **TS**: `p.m_nSta, p.m_nInt` (raw stat)
- **C++** (`MoverParam.cpp:3145`): `GetSta()`, `GetInt()` (DST-adjusted)
- **Impact**: Gear/buff +STA/+INT doesn't boost HP/MP/FP regen

### C7. ACTMSG handler invented — no C++ server-side handler
- **File**: `packages/inventory/src/handlers/actMsg.handler.ts`
- **TS**: uses `PACKETTYPE_ACTMSG` + `OBJMSG_PICKUP` as primary loot/pickup mechanism
- **C++** (`DPSrvr.cpp` dispatch table): no `OnActMsg` exists. Pickup is via `PLAYERSETDESTOBJ` → arrival FSM → `DoLoot`
- **Impact**: Works coincidentally (client does send ACTMSG). Architecturally divergent; breaks if client behavior changes

---

## HIGH — Wrong Numbers / Missing Logic

### H1. Missing NPC→player ATK boost
- **File**: `packages/combat/src/combat/formulas.ts:257-310`
- **C++** (`AttackArbiter.cpp:462-470`): if NPC→player, non-magic, levelDelta > 0: `nATK *= (1.0 + 0.05 * levelDelta)`
- **Impact**: Monster 10 levels above player should deal +50% damage

### H2. Missing GetATKMultiplier for skills
- **File**: `packages/combat/src/combat/skillFormulas.ts:268-317`
- **C++** (`AttackArbiter.cpp:329`): `nATK *= GetATKMultiplier(pDefender, dwAtkFlags)` on ALL attack types
- **Impact**: DST_ATKPOWER_RATE buffs (SM_ATTACK_UP, mastery) don't affect skill damage

### H3. Missing DST_ABILITY_MIN/MAX
- **File**: `packages/combat/src/combat/formulas.ts:114-136`
- **C++** (`MoverAttack.cpp:508-509`): `*pnMin = GetParam(DST_ABILITY_MIN, *pnMin); *pnMax = GetParam(DST_ABILITY_MAX, *pnMax);`
- **Impact**: Buffs that set DST_ABILITY_MIN/MAX have zero effect

### H4. Missing GetItemMultiplier (expired/durability)
- **File**: `packages/combat/src/combat/formulas.ts:114-136`
- **C++** (`MoverAttack.cpp:516-521`): returns 0 for expired items, scales by durability + refine
- **Impact**: Expired weapons still deal full damage

### H5. Missing GetDEFMultiplier
- **File**: `packages/combat/src/combat/formulas.ts:198-216`
- **C++** (`MoverAttack.cpp:592`): `nDefense *= GetDEFMultiplier(pInfo)` — DST_ADJDEF_RATE, server monster scaling, armor penetrate
- **Impact**: Defense-reduction buffs and armor penetrate skills do nothing

### H6. Multi-hit skills deal full damage per hit
- **File**: `packages/combat/src/services/combat.service.ts:160-180`
- **C++** (`MoverAttack.cpp:925-926`): `if (nSkillCount > 0) factor /= nSkillCount;`
- **Impact**: 3-hit skill deals 3x intended damage

### H7. Missing NPC berserk damage multiplier
- **File**: `packages/combat/src/combat/formulas.ts:233-243`
- **C++** (`MoverAttack.cpp:979-984`): if `HP% <= nBerserkHP`, `factor *= m_fBerserkDmgMul`
- **Impact**: Boss/elite monsters don't deal bonus damage at low HP

### H8. DROPGOLD implemented but C++ v19 is no-op
- **File**: `packages/inventory/src/handlers/dropGold.handler.ts`
- **C++** (`DPSrvr.cpp:868-873`): `#if __VER >= 8 return;` — immediate no-op
- **Impact**: Players can drop gold on ground in emulator but not in real v19

### H9. Defense is deterministic; C++ randomizes within min/max range per hit
- **File**: `packages/combat/src/combat/equipStats.ts:80-91`
- **TS**: `armorDef += prop.defense ?? 0` — single deterministic value
- **C++** (`MoverParam.cpp:2051-2098`): accumulates min/max separately per armor piece, `GetDefenseByItem(bRandom=TRUE)` → `xRandom(min, max)` on every melee hit
- **Impact**: Player defense varies hit-to-hit in C++; TS produces uniform damage. Only player defense affected (NPC defense is deterministic in C++ too).

### H10. CERTIFY may be missing `__SECURITY_0628` resource version field
- **File**: `packages/login-server/src/handlers/auth.handler.ts:44-46`
- **C++** (`DPCertified.cpp:133-138`): under `__SECURITY_0628`, reads `[string resVersion]` between protocolVersion and account
- **Impact**: If v19 build has this flag, login field alignment is broken. Needs build-flag confirmation.

### H11. GETPLAYERLIST missing version validation (cluster-server)
- **File**: `packages/cluster-server/src/handlers/char.handler.ts:47`
- **TS**: reads version string into `_version` but never validates it
- **C++** (`DPLoginSrvr.cpp:151`): `strcmp(lpVer, g_szMSG_VER) != 0` → `SendError(ERROR_ILLEGAL_VER)`
- **Impact**: Outdated/modified clients can connect to cluster without version gating

### H12. NPC shop buy: no fShopCost/event-LUA/PERIN_VALUE pricing
- **File**: `packages/npc/src/services/shop.service.ts` `buy()`
- **C++** (`DPSrvr.cpp`): `OnBuyItem` applies vendor-specific `fShopCost` multiplier, event-LUA price factor, PERIN_VALUE
- **Impact**: All vendors charge base propItem price regardless of vendor type

### H13. NPC shop buy: no stock count validation
- **File**: `packages/npc/src/services/shop.service.ts` `buy()`
- **C++**: validates `nNum <= vendorStockCount` then `nNum <= affordable`; clamps both
- **Impact**: Player can buy more items than vendor has in stock

### H14. Bank open: no proximity check
- **File**: `packages/npc/src/services/bank.service.ts` `open()`
- **C++** (`DPSrvr.cpp`): `OnOpenBankWnd` checks `IsCloseNpc(MMI_BANKING)` when `dwId==NULL_ID`
- **Impact**: Player can open bank from anywhere in the world

### H15. Bank open: no chaotic-player block
- **File**: `packages/npc/src/services/bank.service.ts` `open()`
- **C++**: `IsChaotic()` check blocks PK-penalty players from bank
- **Impact**: Chaotic players can access bank when they shouldn't

### H16. Bank deposit: no proximity check
- **File**: `packages/npc/src/services/bank.service.ts` `depositItem()`
- **C++**: `OnPutGoldBank` checks `IsCloseNpc` unless `m_bInstantBank` flag
- **Impact**: Can deposit gold from anywhere

### H17. Quest cancel: no m_bNoRemove guard
- **File**: `packages/quest/src/handlers/removeQuest.handler.ts`
- **C++**: `OnRemoveQuest` checks `m_bNoRemove==FALSE` before allowing cancel
- **Impact**: Quests marked non-removable can be cancelled

---

## MEDIUM

### M1. GetWeaponATK missing GetPlusWeaponATK (weapon mastery DSTs)
- **File**: `packages/combat/src/combat/formulas.ts:97-111`
- **C++** (`MoverAttack.cpp:481`): `nATK += GetPlusWeaponATK(dwWeaponType)`
- HIGH once mastery skills are implemented

### M2. GetBlockFactor heavily simplified (player branch)
- **File**: `packages/combat/src/combat/formulas.ts:322-328`
- **C++** (`MoverAttack.cpp:808-835`): attacker-dependent, block-type-distinct formula
- Wrong for PvP

### M3. DST_ATKPOWER applied in wrong pipeline position
- **File**: `packages/combat/src/combat/formulas.ts:131-132`
- **C++**: added AFTER GetATKMultiplier; TS adds BEFORE element/crit/defense

### M4. Elemental defense factor + crit ordering differs
- **TS**: crit on element-modified ATK, subtract element-modified DEF
- **C++**: crit on (element-ATK minus element-DEF)
- Produces different numbers on crit

### M5. DST_HP/MP/FP_RECOVERY not applied in recovery system
- **File**: `packages/entities/src/math/vitals.ts:59-73`
- **C++** (`MoverParam.cpp:3149`): `GetParam(DST_HP_RECOVERY, nValue)`
- No items use it yet, but pipe is open

### M6. Master/Hero +1 GP/level-up missing
- **File**: `packages/combat/src/services/combat.service.ts:485-491`
- **C++** (`MoverParam.cpp:1446-1450`): `m_nRemainGP++` when `IsMaster()||IsHero()||IsLegendHero()`
- Master/Hero chars get 2 GP/level instead of 3

### M7. Death penalty: chaotic/revival/DST_RECOVERY_EXP modifiers missing
- **File**: `packages/entities/src/math/exp.ts:86-91`
- **C++** (`MoverParam.cpp:7333-7346`): chaotic + SM_REVIVAL = 90% penalty; SM_REVIVAL alone = 0%; DST_RECOVERY_EXP reduces

### M8. Quest conditions: party/guild stubbed permissive (return true)
- **File**: `packages/quest/src/services/questConditions.ts`
- **C++**: checks `SetBeginCondParty` / `SetBeginCondGuild`
- Party/guild quests available to solo players

### M9. Shop: no chaotic-player block on open
- **File**: `packages/npc/src/services/shop.service.ts`
- **C++**: `IsChaotic()` blocks chaotic players from shops

### M10. Shop sell: no IK3_EVENTMAIN/IsQuest/seal-char/perin blocks
- **File**: `packages/npc/src/services/shop.service.ts` `sell()`
- **C++**: blocks selling event items, quest items, sealed characters, perin items

### M11. Shop sell: no min-1 price floor
- **File**: `packages/npc/src/services/shop.service.ts` `sell()`
- **C++**: `max(1, GetCost()/4)` — TS can sell 0-cost items for 0

### M12. Bank: no gold overflow guard (CanAdd check)
- **File**: `packages/npc/src/services/bank.service.ts`
- **C++**: `CanAdd` check prevents overflow

### M13. Target service: inverted m_idTarget direction
- **File**: `packages/npc/src/services/target.service.ts`
- **TS**: sets `player.m_idTarget`; **C++**: sets `target.m_idTargeter`

### M14. Quest cancel: no 400ms rate limit
- **File**: `packages/quest/src/handlers/removeQuest.handler.ts`
- **C++**: 400ms debounce

### M-DROP1. Drop probability stored as a percent, not the raw DWORD (DELIBERATE)
- **Files**: `packages/resources/src/schemas/drop.schema.ts`,
  `packages/resources/scripts/converters/drops.ts`,
  `packages/inventory/src/services/drop.service.ts`
- **C++**: `CDropItemGenerator::GetAt` (`_Common/Project.cpp:184-206`) rolls
  `xRandom( 3000000000 ) < dwProbability`, and `propMoverEx.inc` stores
  `dwProbability` raw (`Project.cpp:2882`).
- **TS**: `drops.yml` stores `chance` as a percent and the roll is unbiased.
- **Why**: `xRandom(n)` is `xRand() % n` over a 32-bit LCG (`_Common/xUtil.h:14-28`).
  2^32 = 3e9 + 1,294,967,296, so residues below that band have two preimages and
  fire twice as often. Every probability in the shipped file is inside the band,
  so every drop actually lands at **1.3968x** its nominal `prob / 3e9`. The stored
  percent is calibrated to that real rate (`calibratePct`), so observable drop
  rates are unchanged while the number is finally readable and editable. Porting
  the bias instead would have kept the admin panel's % permanently wrong.
- **Also renamed**: `level` → `enchant`. The third `DropItem(...)` arg is not a
  level requirement; its only live use is
  `pItemElem->SetAbilityOption( lpDropItem->dwLevel )` (`Mover.cpp:8005`).

### M-DROP2. Level-difference gate now rolls once per kill (BUGFIX vs prior TS)
- **File**: `packages/inventory/src/services/drop.service.ts`
- **C++**: one `xRandom(100) < nProbability * GetItemDropRateFactor()` before the
  slot loop (`Mover.cpp:7948`); `nProbability` is the 100/80/60/30/10 bucket
  (`Mover.cpp:7940-7946`). A miss suppresses items **and** gold — the
  DROPTYPE_SEED branch is inside the same `if` (`Mover.cpp:8286`).
- **Prior TS**: multiplied *every slot's* prob by the factor, compounding a nerf
  the original never had, and paid gold even on a "miss".
- Penya additionally uses its own shallower bucket (`nPenyaRate`, 100/100/80/65/50).

### M-DROP3. `count` is a maximum, and `maxItem` excludes gold (BUGFIX vs prior TS)
- **File**: `packages/inventory/src/services/drop.service.ts`
- **C++**: `m_nItemNum = xRandom( dwNumber ) + 1` (`Mover.cpp:7970`) — a `count: 10`
  slot is a uniform 1..10 stack, not a guaranteed 10. The `Maxitem` counter is
  bumped only in the DROPTYPE_NORMAL branch (`Mover.cpp:8046`), so gold never
  consumes a slot; prior TS dropped exactly `count` and gated gold on `maxItem`.

### M-DROP4. Drop-rate multipliers wired; per-mover rate is data, not DB
- **Files**: `packages/inventory/src/services/drop.service.ts`,
  `packages/world-server/src/compose.ts`, `config/world-server.json`
- **C++**: `GetItemDropRateFactor` (`MoverParam.cpp:4248-4264`) is the product of
  `prj.m_fItemDropRate`, `GetProp()->m_fItemDrop_Rate`, and two event scalars.
- **TS**: `sim.dropRate` × the table's optional `dropRate`. The per-mover value is
  a `drops.yml` field rather than a back-end DB column (no such DB exists here).
- **Unported** (`ponytail:`): `CEventGeneric` / `EventLua` timed-event scalars,
  `GetPieceItemDropRateFactor` (couple Miracle buff), `nloop` giftbox multi-pass,
  `DropKind`, `QuestItem` in this service (quest drops live in `@flyff/quest`).

### M15. Dialog interpreter: missing QS_* constants
- **File**: `packages/npc/src/services/dialogInterpreter.ts`
- **C++**: has `QS_BEGIN_ENABLED=1, QS_END_ENABLED=2, etc.` — TS may be missing some

### M16. DOEQUIP nPart validation/coercion order fragile
- **File**: `packages/inventory/src/handlers/doEquip.handler.ts:54-56`
- Runs `Validate.dword(nPartRaw)` before `| 0` signed coercion — works but fragile

### M17. updateItem.serializer.ts `slot` parameter naming misleading
- **File**: `packages/inventory/src/handlers/updateItem.serializer.ts`
- Named `slot` but callers correctly pass objid — naming hazard only

### M18–M21. (see NPC/quest and combat sections above)

### M-SOCIAL1. Friend handlers trust a client-supplied actor id (HARDENED, deliberate)
- **File**: `packages/social/src/handlers/friend.handler.ts`
- **C++** (`WORLDSERVER/DPSrvr.cpp:1526/1578/1613`): `OnAddFriendReqest`,
  `OnAddFriendNameReqest` and `OnAddFriendCancel` all resolve the ACTOR via
  `g_UserMng.GetUserByPlayerID( uLeaderid )` — the id comes from the packet body,
  so any client can act as another player (send invites, cancel someone else's
  dialog). `OnAddFriend` / `GETFRIENDSTATE` / `SETFRIENDSTATE` / `REMOVEFRIEND` on
  the core server read the id and then correctly ignore it, using the socket.
- **TS**: actor is always resolved from the socket session; the packet's id is
  advisory and a mismatch is logged at `warn`. Rule 03.
- **Impact**: none on legitimate clients; closes a spoof.

### M-SOCIAL2. SETFRIENDSTATE accepts an unvalidated state in C++ (CLAMPED)
- **File**: `packages/social/src/services/friend.service.ts` (`clampState`)
- **C++** (`CORESERVER/DPCacheSrvr.cpp:2086`): `ar >> state` then
  `m_RTMessenger.SetState( state )` with no range check, so an arbitrary int is
  stored and relayed to every friend.
- **TS**: clamped to `0 <= state < MAX_FRIENDSTAT` (12), out-of-range falls back
  to `FRS_ONLINE`.

### M-SOCIAL3. Trade stakes are re-validated at commit (SAFER, deliberate)
- **File**: `packages/inventory/src/services/trade.service.ts` (`collectOutgoing`)
- **C++** (`_Common/MoverItem.cpp:126 TradeConsent`): staged items are raw
  `CItemBase*` pointers plus a `SetExtra(count)` marker; the commit trusts the
  pointer still being valid and the count still being available.
- **TS**: stages `{slot, objid, itemId, count}` and re-reads the live bag at
  commit; a mismatch (slot emptied, item swapped, count shrunk) aborts with
  `TRADE_CONFIRM_ERROR` instead of materialising an item that no longer exists.
- **Impact**: no change on the success path; removes a dupe vector.

### M-SOCIAL4. TRADEPUTGOLD re-stake refunds the prior stake (BUGFIX vs C++)
- **File**: `packages/inventory/src/services/trade.service.ts` (`putGold`)
- **C++** (`WORLDSERVER/DPSrvr.cpp:8827`): `TradeSetGold( nGold )` REPLACES the
  staked amount but `AddGold( -nGold )` debits the new amount again — staking
  twice silently destroys the first stake.
- **TS**: refunds the previous stake before debiting the new one. Identical for
  the normal single-stake flow.

### M-SOCIAL5. Campus tiers collapsed; no DB-server round-trip
- **File**: `packages/social/src/services/campus.service.ts`
- **C++**: the world server performs ZERO local campus mutation — every
  membership/point change is `g_dpDBClient.Send*` and only applied when the DB
  server broadcasts `PACKETTYPE_CAMPUS_ADD_MEMBER` / `REMOVE_MEMBER` /
  `UPDATE_POINT` back. `PACKETTYPE_CAMPUS_ALL` seeds the world at boot.
- **TS**: single process, so the service writes to the DB and then does what the
  broadcast handler would have done, preserving the persist-then-notify order.
  `CAMPUS_ALL` becomes `CampusService.bootstrap()`.
- Not a behaviour divergence, but the reason the DB-driven opcodes are absent
  from the dispatcher.

### M-SOCIAL6. QUERYEQUIP clamps nParts (client-side OOB in C++)
- **File**: `packages/world-server/src/services/queryEquip.service.ts`
- **C++** (`WORLDSERVER/User.cpp:2635` + `Neuz/DPClient.cpp:15781`): the server
  writes the loop index unbounded and the client indexes
  `aEquipInfoAdd[nParts]` with the wire value — a hostile server could write past
  a client stack array.
- **TS**: only emits `0 <= nParts < MAX_HUMAN_PARTS`, guaranteed by the loop bound.

### M-SOCIAL7. Awakening / piercing / pet-vis unmodelled in QUERYEQUIP
- **File**: `packages/world-server/src/net/snapshot/queryEquip.serializer.ts`
- `GetRandomOptItemId()` goes out as 0 and all three `CPiercing` counts as 0 —
  a valid empty round-trip. Marked `ponytail:`; wire up when piercing/awakening
  data exists.

---

## DELIBERATE DIVERGENCE — Hardening Beyond C++

Places where the TS intentionally does NOT match C++, because the C++ behavior
is exploitable under an untrusted client. Each needs an explicit rationale.

### D1. Quest route validates the NPC owns *this side* of the quest
- **File**: `packages/npc/src/services/scriptDlg.service.ts` (`handleQuestRoute` → `ownsQuestRoute`)
- **C++**: `__QuestEndComplete` (`ScriptHelper.cpp:873`) trusts the client's
  `dwVal2` quest id and never re-checks the NPC. The only NPC gate is the
  button-emit classification at `ScriptHelper.cpp:601`
  (`strcmpi(m_szEndCondCharacter, pMover->m_szCharacterKey)`).
- **TS**: BEGIN / BEGIN_YES require the NPC to be in the quest's `SetCharacter`
  index; END_COMPLETE requires the `SetEndCondCharacter` index. The two sides are
  checked **separately** — a begin-or-end test is not enough, because most quests
  hand off between two NPCs. `SRT_QUESTOFFICE` still serves the whole catalog.
  `QUEST_END` (opening the turn-in confirmation) is *not* blocked: C++ lists the
  active quest at the begin NPC too and answers with `QSAY_END_FAILURE` +
  `QUEST_END_FAIL` (`:601-614`), which `questEndConfirm` now reproduces by
  folding `isEndNpc` into its eligibility test.
- **Why**: `nGlobal2` is client-supplied, so the C++ shape lets any NPC begin or
  complete any quest. Concretely it broke the 1st job change:
  `QUEST_VOCACR_TRN1` (54) begins at `MaFl_Pire` and ends at `MaDa_Tailer`, but
  could be turned in at Pire — consuming the quest without ever reaching the
  master whose dialog body runs `ChangeJob(n)`, leaving the player a Vagrant.
- **Tests**: `packages/npc/test/services/scriptDlg.service.test.ts` →
  "quest route NPC ownership" (7 cases, incl. begin-NPC-cannot-complete and the
  QUEST_END_FAIL / QUEST_END_COMPLETE button split).

### D2. Looter pet picks the genuinely nearest pile

- **File**: `packages/world-server/src/systems/pet.system.ts` (`scan`)
- **C++** (`_AIInterface/AIPet.cpp:115,144`): `SubItemLoot` initialises
  `float fMinDist = 9999999.0f` and tests `fDistSq < 15*15 && fDistSq < fMinDist`
  — but **never assigns `fMinDist` inside the loop**. Every pile within 15 units
  therefore passes the second test, so `pMinObj` ends up as the *last* qualifying
  pile in link-map iteration order, not the nearest.
- **TS**: tracks the running best distance, so the pet walks to the actual
  nearest pile.
- **Why**: this is a plain C++ bug with no observable behaviour worth
  reproducing — link-map order is an implementation detail of a data structure we
  do not have, so "faithful" is undefined here. Nearest-first is what the code
  was written to express.
- **Related, same function**: C++ passes `nRange = 0` (uninitialised, `:113`) to
  `FOR_LINKMAP`, so the sweep only covers the pet's own link cell(s) and the
  15-unit test is a second filter inside that set. We sweep every pile in the
  zone and filter by distance, which is the wider (intended) behaviour.
- **Tests**: `packages/world-server/test/systems/pet.system.test.ts` → "picks the
  nearest of several candidate piles", "ignores a pile outside the 15-unit scan
  radius".

### D3. Guild-war DECLARATION is gated on `EVE_GUILDWAR`

- **File**: `packages/guild/src/services/guildWar.service.ts` (`declare_`, `accept`)
- **C++**: the flag is checked in exactly two places, both world-side:
  `CMover::IsWarTarget` (`MoverAttack.cpp:2049`) and the `CGuildWarMng::Process`
  tick (`ThreadMng.cpp:466`). The CoreServer half — `OnDeclWar` / `OnAcptWar`
  (`DPCacheSrvr.cpp:2426`, `:2503`) — runs **unconditionally**.
- **TS**: `declare_` and `accept` both refuse when the flag is down.
- **Why**: `EVE_GUILDWAR` defaults to **0** (`CFlyffEvent`'s ctor memsets
  `m_aEvent[1024]`; only the world boot-script token `GUILDWAR` sets it,
  `WorldServer.cpp:601-603`), so vanilla v19 ships guild war disabled. With the
  flag off the faithful shape lets a war be declared and accepted, which sets
  `m_idWar` on both guilds and thereby trips **ten** `pGuild->GetWar()` guards —
  no invites, no kicks, no rank changes, no disband, on either side — and the war
  then never ends, because the only thing that ends it on time is the tick the
  flag disables. Reproducing that means shipping a griefing primitive, not a
  behaviour.
- **Tests**: `packages/guild/test/services/guildWar.service.test.ts` → "declare —
  the EVE_GUILDWAR gate (divergence 1)".

### D4. War accept and truce accept are validated against stored state

- **File**: `packages/guild/src/services/guildWar.service.ts` (`accept`, `acceptTruce`)
- **C++**: `OnAcptWar` reads `idDecl` off the wire and never checks that the
  named guild declared anything — the author's own `// fixme - raiders` sits on
  the function signature (`DPCacheSrvr.cpp:2502`). `OnAcptTruce` (`:2402-2424`) is
  worse: it resolves the war from the accepter's `m_idWar` and calls `Result`
  with **no master check** and **no check that the accepter is the guild that was
  asked**.
- **TS**: a declaration is stored server-side keyed by target guild and must
  match on accept; a truce request is stored keyed by war id, and accepting
  requires being the master of the guild that was *asked*.
- **Why**: two distinct exploits. The first lets any guild master forge a war
  against any eligible guild by sending an `idDecl` that never declared — the
  victim's roster locks with no warning and no counterparty. The second lets *any
  member* of either guild end a war unilaterally (and lets the asking guild
  accept its own request), which makes the truce handshake decorative. Neither is
  a game rule; both are missing validation in a trusted-client design.
- **Note**: there is deliberately no reject/decline path on either, matching C++
  — the client's "No" button is a bare `Destroy()` with no send
  (`WndGuildWarRequest.cpp:84-91`). A refused proposal simply expires.
- **Tests**: `packages/guild/test/services/guildWar.service.test.ts` → "accept —
  proposal validation (divergence 2)" and the `truce` block.

### D5. `nAbsent` accumulates once per second, not once per frame

- **File**: `packages/guild/src/managers/guildWar.manager.ts` (`addAbsent`),
  `packages/world-server/src/systems/guildWar.system.ts`
- **C++**: `CGuildWar::Process` bumps `nAbsent` on every pass of a
  `WaitForSingleObject(..., 1)` loop (`ThreadMng.cpp:339`, `:466`) for whichever
  side's master is offline — order of a thousand increments per second.
- **TS**: the counter is normalized to whole seconds offline, with the
  millisecond remainder carried between ticks.
- **Why**: nothing reads the absolute value. `OnWarTimeout` only *compares* the
  two sides (`DPCoreSrvr.cpp:1722`), so every decision the field feeds is
  preserved, while the stored number becomes a duration a human can read. The
  alternative — a 1ms interval whose only purpose is inflating an integer — costs
  a Map walk a thousand times a second for no behavioural difference.
- **Tests**: `packages/guild/test/managers/guildWar.manager.test.ts` → "nAbsent
  counts WHOLE SECONDS", "carries the remainder rather than dropping it".

### D6. Guild-quest completion credits the QUESTING guild, not the killer's

- **File**: `packages/guild/src/services/guildQuest.service.ts` (`onBossKilled`),
  `packages/combat/src/services/combat.service.ts` (`onGuildQuestBossKilled`)
- **C++**: `CMover::DropItem`'s guild arm reads `CGuild* pGuild =
  pAttacker->GetGuild();` (`Mover.cpp:7499`) and writes the success state to it,
  with **no comparison against `pElem->idGuild`** — the guild that actually
  opened the arena. Two consequences: an outside guild that lands the killing
  blow takes the completion, and a *guildless* killer voids it entirely (the
  whole `if( pGuild )` block is skipped, so the arena stays in `GQP_WORMON` with
  a dangling `objidWormon` until its 60 minutes expire and it writes the
  FAILURE state instead).
- **TS**: the arena's own `guildId` is credited. The combat hook deliberately
  does not even receive the attacker, so the steal cannot be reintroduced by a
  later edit.
- **Why**: the arena is world-exclusive per quest id, so the theft is not a fair
  race — an uninvolved guild can camp a rect it has no claim to and take a
  60-minute run off the guild that started it. This is the same class of hole as
  D4 (war accept taking `idDecl` off the wire unvalidated), and the author's own
  `// fixme - raiders` on that function suggests the family was known.
- **Tests**: `packages/guild/test/services/guildQuest.service.test.ts` →
  the `onBossKilled` divergence case.

### D7. Guild-quest start enforces master + level server-side

- **File**: `packages/guild/src/services/guildQuest.service.ts` (`start`)
- **C++**: `MonHuntStart` checks only "not already questing / has a guild / prop
  exists" (`ScriptLib.cpp:446-457`). Every real gate lives in the dialog script:
  `GetPlayerLvl() >= 70 && IsWormonServer() == TRUE && IsGuild() == 1 &&
  IsGuildMaster() == 1` (`NpcScript.cpp:1977`).
- **TS**: the master check and the level-70 check are enforced in the service as
  well, returning `not-master` / `level`.
- **Why**: a script predicate is a client-visible *branch*, not an authority
  check. The script decides which menu key to show; the entry point is reachable
  by any dialog step that names it. Reproducing the split faithfully would mean
  any guild member at any level could open the arena through a crafted or
  mis-authored dialog, and the arena is world-exclusive — one bad actor denies
  it to everyone. Note `GUILDQUESTPROP::nLevel` is NOT the source of the 70: that
  field is parsed and read by nothing, so the literal is duplicated from the
  script as `GUILD_QUEST_MIN_LEVEL`.
- **Tests**: `packages/guild/test/services/guildQuest.service.test.ts` → the two
  gate-order divergence cases.

---

## The `#questEndComplete` (dialog state 8) callback — was MISSING, now ported

Not a divergence; a port gap that is now closed. Recorded because the mechanism
is non-obvious and easy to re-break.

- **File**: `packages/npc/src/services/scriptDlg.service.ts`
  (`applyEnd` → `runEndCompleteCallback`)
- **C++**: dialog state indices are row numbers in `WorldDialog.txt`
  (`RunDialog(key)` → `GetKeyIndex(key)` → `sprintf("%s_%d", name, index)`,
  `NpcScript.cpp:260`; key table `:296`; index map `:28518`). Rows 0–8 are
  reserved control keys: `#auto`, `#init`, `#addKey`, `#yesQuest`, `#noQuest`,
  `#questBegin`, `#questBeginYes`, `#questBeginNo`, **`#questEndComplete`**.
  `__QuestEndComplete` runs state 8 on the turn-in NPC immediately *after*
  `__EndQuest` succeeds — `ScriptHelper.cpp:877-878`.
- **Consequence of the gap**: state 8 is a server-invoked callback, never a
  clickable button, so no dialog anywhere calls `AddKey( 8 )`. The TS `applyEnd`
  completed the quest and emitted its own "Quest complete." frame but never
  dispatched state 8 — and state 8 is the ONLY place `ChangeJob(n)` lives. Every
  job master's body is
  `if( GetQuestState(QUEST_VOC*_TRN2/3) == QS_END && GetPlayerJob() == 0 && GetPlayerLvl() == 15 ) { ChangeJob( n ); InitStat(); }`.
  Result: the quest completed, no job was ever set, player stayed a Vagrant.
- **Ordering matters**: the callback must run *after* `endQuest`, because the
  `== QS_END` gate only passes once the quest has moved to the completed list.
- **Note**: `keyToIndex` maps `#init` → 0, but `#init` is row 1 and `#auto` is
  row 0. Harmless today (state 0 is treated as the greeting throughout, and
  `#auto` — the idle barker, `Mover.cpp:1384`) is not dispatched from
  `OnScriptDialogReq`), but it is a latent off-by-one if `#auto` is ever ported.
- **Tests**: `packages/npc/test/services/scriptDlg.service.test.ts` →
  "#questEndComplete callback" (3 cases: ChangeJob+InitStat fire, ordering,
  no-state-8 fallback frame).

---

## LOW / Verified Correct

- All PACKETTYPE/SNAPSHOTTYPE opcodes match C++ hex values
- All 50+ C→S handlers match C++ field order, types, semantics
- All 20+ S→C serializers match C++ byte layouts
- Base stat getters, max vital formulas, DST param model, stat allocation — all match
- Recovery formula math, exp within-level model, death penalty formula — all match
- Quest offer 4-bucket, reward grant, dialog interpreter core — all match
- NPC spawn, vicinity, ADD_OBJ timing — all match
- SELLITEM comment-only discrepancy, NPC buff invented 1s rate limit (harmless)
- Cluster-server: all 6 packets (GETPLAYERLIST, CREATE/DELETE_PLAYER, PRE_JOIN, PING, QUERYTICKCOUNT) field orders match C++ exactly
- Cluster-server: DELETE_PLAYER unread messenger trailing bytes — harmlessly ignored (LOW)
- Cluster-server: QUERYTICKCOUNT FILETIME-epoch computation — semantically equivalent (minor ms precision)

---

## Priority Fix Order

1. **C5** — magic element factor direction (skill vs weapon, not skill vs defender)
2. **C1** — hit rate coefficients (player→NPC)
3. **C2 + C3** — skill crit block + crit multiplier
4. **H6** — multi-hit skill 1/N damage division
5. **H9** — defense randomization (min/max range per hit)
6. **H1** — NPC→player ATK boost
7. **H2** — skill GetATKMultiplier
8. **H5** — GetDEFMultiplier
9. **H3 + H4** — DST_ABILITY_MIN/MAX + GetItemMultiplier
10. **C6** — recovery raw stat → DST-adjusted
11. **C7** — ACTMSG vs arrival-FSM pickup
12. **H8** — DROPGOLD should be no-op
13. **H12–H17** — shop/bank guards + quest m_bNoRemove
14. **H10–H11** — CERTIFY + cluster version validation
