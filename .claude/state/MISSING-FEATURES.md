# Flyff v19 — Missing Features Checklist

> **Fidelity audit (2026-07-27):** All 64 TS↔C++ behavioral deviations found in
> the C++ fidelity audit (`docs/c++-fidelity-audit.md`) have been resolved. This
> checklist covers features not yet ported at all (wider scope).

Generated 2026-07-23 from a full-source sweep (3 parallel domain maps + every
`ponytail:` comment). Re-verified 2026-07-24 (57 items), and **re-verified again
2026-08-01** against master `c9ae378` — 136 commits later — by 4 parallel
read-only explorers covering all 16 sections. Compares the emulator against full
retail v19.

**Status legend**
- ✅ DONE — implemented + passing on this device's checks (NOT user-confirmed)
- 🟡 PARTIAL — core path works, sub-features/edge-cases stubbed
- 🟥 STUB — code exists but does nothing meaningful (charge consumed, no effect)
- ❌ MISSING — no code path at all

**Override rule:** ✅ here = "passes my checks", never "fixed". Only the user
declares a feature fixed by testing on a real v19 client.

**Companion signal:** there are **187 `ponytail:` markers across 79 files** —
a denser, line-level gap inventory than this checklist. When a line here says
PARTIAL, the ponytail at the cited file:line usually names exactly what is
missing. `grep -rn "ponytail:" packages/*/src` is the authoritative sweep.

**Tally at this refresh** (206 tracked lines across 22 sections):
✅ 123 · 🟡 48 · ❌ 23 · 🟥 8 · 🚫 4 (retired as not-gaps).

---

## 1. COMBAT

### Melee
- [x] ✅ Hit-rate roll (player→NPC, NPC→player, PvP branches) — `combat/formulas.ts:183`
- [x] ✅ Crit (flat 2.3×) + DST_CHR_CHANCECRITICAL — `formulas.ts:150,256`
- [x] ✅ Block factor (NPC + player defender) — `formulas.ts:285`
- [x] ✅ DEF subtract, element factor, level-diff falloff — `formulas.ts:200,252,212`
- [x] ✅ ATK from weapon + DST_CHR_DMG/ATKPOWER/ATKPOWER_RATE + refine — `formulas.ts:115`
- [x] ✅ Equip→stat projection — element string→enum, refine→option decode, jewelry HR/ER, atkSpeed — `combat/equipStats.ts`
- [x] ✅ Targeting policy — `MI_CHAOGUARDIAN` inverse (`m_bChaoGuard`) + `RANK_GUARD` — `combat.policy.ts`. Flying-mismatch still deferred (no flight subsystem)
- [x] ✅ NPC→player min-damage floor (10% of ATK) — `formulas.ts`

### Ranged / bow
- [x] ✅ Bow damage curve (STR/DEX) — `formulas.ts:109`
- [x] ✅ NPC ranged attack (RANGE_ATTACK emit, re-attack delay) — `ai.system.ts:222`
- [x] ✅ Player ranged auto-attack as a distinct path — `rangeAttack.handler.ts`, `rangeAttack.service.ts`
- [ ] 🚫 Ammo / arrow consumption — **N/A by design**, not a gap: v19 retail bows are ammo-less and propItem has no arrow kind. Only relevant to later-version quivers

### Magic / skill damage
- [x] ✅ Single-target skill damage (melee + magic, element, magic-factor) — `skillFormulas.ts:268` `resolveSkillCast`
- [x] 🚫 Skill crit — **the old line was semantically wrong and is retired**: skills *never* crit in v19 by design (`MoverAttack.cpp:800` `if (IsSkillAttack(dwAtkFlags)) return FALSE`). The TS states this explicitly at `skillFormulas.ts:294`. Nothing to implement
- [x] ✅ Debuff/secondary-effect **application** — damage-skill tail calls `applyBuffToMover` on the target — `skills/skill.service.ts:351`
- [ ] 🟡 **Debuff proc roll is not enforced** — the gate is `(levelRow.destParams?.length ?? 0) > 0`, NOT the rolled `effectProc` from `skillFormulas.ts:321`, so a debuff whose `nProbability` roll *failed* still lands. Fidelity deviation — `skill.service.ts:351`
- [ ] 🟥 AoE (area skills) — no consumer of `skillRange`/`spellRegion` anywhere in `combat/` or `skills/`
- [x] ✅ DoT (damage-over-time) — `entities/params/BuffManager.ts:219 tickDots`, `world-server/systems/buff.system.ts:59` (players), `ai.system.ts:126` (monsters); seeded via `dotFromSkill()` `skill.service.ts:732`
- [ ] 🟡 **DoT death is not a real death** — monster DoT death sets `m_bDead` and `continue`s: no MOVERDEATH broadcast, no exp, no drops (`ai.system.ts:126`). Player DoT death sends no DAMAGE snapshot and never triggers `onPlayerDeath` (`buff.system.ts:67`)
- [x] ✅ Multi-hit skills (`nSkillCount` chain: N rolls + N DAMAGE snapshots, stops on death) — `combat.service.ts:185-213`
- [ ] 🟥 Projectile skills — no projectile path in `combat/` or `skills/`
- [x] ✅ Heal skills (RT_HEAL → DST_HP restore, self/other target) — `skill.service.ts` `applyHeal`
- [x] ✅ Buff skills — **UPGRADE 🟥→✅**: `effectKind` returns `'buff'` on `RT_TIME` in `referTargets[0|1]` (`skill.service.ts:381`), effects built data-driven by `buffEffects()` (`:705`). The old `dwDestParam=0` special-case is gone
- [x] ✅ PvP + PvE skill damage vars (PvP 0.60 + NPC level-diff cosine) — `skillFormulas.ts:310`

---

## 2. SKILLS

- [x] ✅ USESKILL cast handler — `skills/handlers/useSkill.handler.ts`
- [x] ✅ DOUSESKILLPOINT learn handler — `skills/handlers/doUseSkillPoint.handler.ts`
- [x] ✅ Cooldowns (`m_tmReUseDelay[45]`) — `skill.service.ts:137`
- [x] ✅ Skill learning (SP spend, tier cost, prereqs, no-decrease) — `skill.service.ts:260`
- [x] ✅ Skill points granted on level-up — `combat.service.ts:285`
- [x] ✅ MP/FP consume on cast (routed by KT; gated before spend) — `skill.service.ts:154,191` (re-verified 2026-07-24)
- [x] ✅ Damage + heal + **buff** cast — `effectKind` routes all three (`skill.service.ts:381`). AoE still missing (§1); auto-attack-type skills return `'unsupported'`
- [x] ✅ Job-match gate on learn (isJobMatch lineage) — `entities/tables/jobLineage.ts`, gated `skill.service.ts:617`
- [x] ✅ WAL `SKILL_LEARN` journal type + replayer — `skill.service.ts:655`, `journalReplayers.ts:98`
- [x] ✅ Action-slot / skill-queue combo progression — server-driven `SetNextSkill` + tick-spaced advance + `ENDSKILLQUEUE` on exhaust — `skill.service.ts:194-282`
- [x] ✅ NPC buff casting with conflict table — `skill.service.ts:487 applyNpcBuff`, `NPC_BUFF_CONFLICT:65`
- [ ] ❌ **Cast-range validation** — `useSkill.handler.ts:44` validates objid + slot only; `resolveDamageTarget` checks existence + alive, never distance. **A client can cast any skill on any objid in the zone from any distance.** Anti-cheat gap, newly identified 2026-08-01

---

## 3. BUFF / DEBUFF / STATUS EFFECTS

- [x] ✅ Buff container + expiry (BuffManager over ParamModel + 1s BuffSystem sweep + SETSKILLSTATE/REMOVESKILLINFULENCE) — `entities/params/BuffManager.ts:118,139,200,237`, `world-server/systems/buff.system.ts`
- [x] ✅ Skill buff apply/expire (RT_TIME → applyBuff; refresh/replace/ignore, 28-cap, per-effect SETDESTPARAM sync) — `skill.service.ts` applyBuff, `BuffManager.ts:118`
- [x] ✅ Buff clear on death (clear + REMOVESKILLINFULENCE + RESETDESTPARAM per buff) — `revival.service.ts:96-107`, `buff.system.ts` `onExpired`
- [x] ✅ Buff persistence across relog — `join.service.ts:395-473` (`loadBuffs`, `collectPersistedBuffs`) + `character_buffs` (migrations 015/016/018, absolute `expiresAtMs`)
- [ ] 🟡 **Stun gate has a real type bug** — `player.ts:622` reads `CHRSTATE_BITS.STUN | CHRSTATE_BITS.SLEEP`, but `entities/constants/dst.ts:112-119` **has no `SLEEP` key** (only STUN/DARK/POISON/SLOW/BLEEDING/SILENT). At runtime `8 | undefined` → `8`, so **stun gates and sleep never does**. C++ value is `CHS_SLEEPING 0x00200000`. Build stays green only because tsup/esbuild does not typecheck
- [ ] 🟡 Stun gate coverage — movement is **not** stun-gated: `world-core/services/movement.service.ts:88,103,113,132` check `m_bDead` only, never `isStunned()`. A stunned player can still walk (attack + cast paths *are* gated)
- [x] ✅ Poison DoT tick system — `BuffManager.ts:219 tickDots`, `buff.system.ts:59 onDots`, `ai.system.ts:126` (see the DoT-death caveat in §1)
- [x] ✅ Buff-grant consumable items (IK2_BUFF/IK2_BUFF2 → addItemBuff + SETSKILLSTATE + SETDESTPARAM) — `inventory/services/useItem.service.ts:78`, `BuffManager.ts:160`
- [ ] 🟥 `IK3_TEXT_DISGUISE` buff check in AI aggro — `ai.system.ts:460 isHidden()` still tests only `MODE.TRANSPARENT`. The ponytail said "when buffs ship" — **buffs have shipped, so this is now actionable**
- [ ] 🟡 Monster debuff icons never clear — `applyBuffToMover` broadcasts SETSKILLSTATE but `ai.system.ts:122` deliberately skips REMOVESKILLINFULENCE for movers, so a debuff icon appears on a monster and stays forever

---

## 4. MONSTER AI

- [x] ✅ FSM idle/wander/aggro(RAGE)/pursue/return-home — `ai.system.ts`
- [x] ✅ Leashing (RAGE_LEASH 150m + damage-pos 120m) — `ai.system.ts`
- [x] ✅ Retaliation on hit (triggerRage) — `combat.service.ts:353`
- [x] ✅ Spawn + respawn timers (static NPC never respawns) — `world-core/managers/spawn.manager.ts`
- [ ] 🟡 Aggro — single-slot target (`m_idTarget`) — `entities/mover.ts:320`; `m_idEnemies:344` tallies hit-share for exp only, never target selection. No aggro table
- [ ] 🟡 Flee / low-HP retreat — **code ✅, data ❌.** Gate `ai.system.ts:213-223`, `startFlee:344` (50 m, `FLEE_SPEED_FACTOR`), `stepFlee:368` all exist, but `spawn.manager.ts:180-236` never passes `fleeHpPct`/`runawayDelay`, so `m_nFleeHpPct` is always 0 and **the branch can never fire**. Source data exists (`resources/raw/propMoverEx.inc`, 19 `SetRunAway(...)` calls) but only `scripts/converters/drops.ts` reads that file
- [x] ✅ Ranged monster AI (holds at range, RANGE_ATTACK, re-attack cadence) — `ai.system.ts:209`
- [ ] 🟡 Healer monster AI — **self-heal code ✅, data ❌, ally-heal ❌.** `ai.system.ts:247-253` implements low-HP self-heal, but `spawn.manager.ts` never passes `m_nHealHpPct`/`m_nHealAmount`/`m_nHealCadenceMs` → always 0 → dead code. Source is `propMoverEx.inc` `Recovery 10 50 100 m`, unparsed. Healing *other* monsters is entirely absent
- [ ] ❌ Flight-capable monster AI — `flyable` is converted into the mover yml but nothing in `ai.system.ts` reads it
- [ ] ❌ Collision-aware stuck-teleport (return-home has a 20s time cap only, no pathing) — `ai.system.ts:285`
- [ ] 🟡 Per-mover `dwReAttackDelay` — **wired to the wrong column.** `spawn.manager.ts` passes `reAttackDelay: def.attack_speed`, and `scripts/converters/movers.ts:86` sets `attack_speed: num(row,'dwAttackSpeed',0)` = propMover col **34** (~1000 for 693 of ~740 movers). The real field is col **35** `dwReAttackDelay` (e.g. 6000), named in the propMover.txt header but never exported. The old "defaults to 2000ms" note was wrong — it reads a real but *incorrect* value

- [ ] 🟡 Return-home HP restore deviation from C++ StateReturn (deliberate: no S→C monster-HP-sync packet) — `ai.system.ts:290`

---

## 5. PARTY / EXP-SHARE

Shipped 2026-07-30 → 08-01 as `@flyff/party` (solo-party MVP, in-memory only —
matches C++, which keeps party state on the Core server not in the DB).

- [x] ✅ Party invite / accept / decline / leave / kick — `party/services/party.service.ts:91,127,147,163`, handlers `party/handlers/party.handler.ts:52,73,94,109`, dispatch `world-server/clientServer.ts:167-170`
- [x] ✅ Party member-list snapshot (`PARTYMEMBER` 0x0082 + `CParty::Serialize`) — `world-core/serializers/party.serializer.ts:151`
- [x] ✅ Party EXP sharing — `party.service.ts:365` `distributeExp` (64 m proximity, 20-level band, 0.2/member bonus); hit-share pooling over `m_idEnemies` at `combat/services/combat.service.ts:423-473`. **`m_idEnemies` is now consumed, not dead**
- [x] ✅ Party loot-share + FFA timeout — `inventory/services/loot.service.ts:350-358` (`IsLoot` + `sameParty` seam + `LOOT_FFA_MS`), receiver pick `party.service.ts:436`
- [x] ✅ Item-share modes (0 finder / 1 sequential / 2 leader / 3 random) — `party.service.ts:239,454`, 32 m `PARTY_ITEM_PROXIMITY`
- [x] ✅ Gold split (mode-independent; floor + remainder to one random member) — `party.service.ts:485`
- [x] ✅ CHANGETROUP "advance party" (`m_nKindTroup=1` + name) — `party.service.ts:261`
- [x] ✅ Loot-received notice to peers — `party.service.ts:529`, consumed `loot.service.ts:303`
- [x] ✅ SETNAVIPOINT party navigator ping — `party.service.ts:295`
- [x] ✅ Disconnect teardown (auto-promote leader, disband under 2) — `party.service.ts:318`
- [x] ✅ Party chat via the `PARTYCHAT` opcode (0xffffff59) — `party.service.ts:276`, dispatch `clientServer.ts:176`
- [ ] ❌ `/p` slash alias for party chat (the opcode path works; only the `/cmd` alias is absent) — `world-server/services/command.service.ts:37`
- [ ] 🟡 Contribution exp mode — the `m_nTroupsShareExp` toggle is stored + echoed (`party.service.ts:222`) but the contribution split itself is ponytail'd — `party.service.ts:360`
- [ ] ❌ Guild-party — party level/exp bar, party skills, party finder, party-duel, mute check on party chat — `party.service.ts:15`, `party/managers/party.manager.ts:13`

---

## 6. PvP / PK

- [ ] 🟡→impl Player-vs-player targeting — player-target resolution via PlayerManager; mutual consent gate (PK mode ON for both) — `combat.service.ts` resolveTarget, `combat.policy.ts` isPlayerAttackableBy (2026-07-25)
- [ ] 🟡→impl PK mode toggle — opcode 0xffffff7b (MODE), handler + service + chat notify — `pkMode.handler.ts`, `pkMode.service.ts` (2026-07-25)
- [ ] 🟡→impl `nChaotic`/isChaotic — m_dwPKPropensity/m_nPKValue/m_dwPKTime/m_dwPKExp hydrated from DB (migration 013); m_bPKMode transient toggle — `player.ts`, `character.repo.ts`, `mover.serializer.ts` (2026-07-25)
- [ ] 🟡→impl PvP damage path — playerCombatant defender routes through 0.60 PvP factor + PvP hit-rate branch (already existed in formulas.ts); PvP damage floor max(1) per C++ — `combat.service.ts` applyHitPlayer (2026-07-25)
- [ ] 🟡→impl PvP death/penalties — PK value + propensity increment, WAL PK_KILL journal, persist fire-and-forget, onPvpKill seam → revival loop — `combat.service.ts` onPvpKill (2026-07-25)
- [ ] 🟡→impl Chaotic/PK revive — isChaotic() gate: 0.1 HP rate vs 0.2 non-chaotic — `revival.service.ts` restoreVitals (2026-07-25)
- [ ] 🟡→impl PK value decay — PkDecaySystem 60s tick, -1 PK per 5min cooldown since last PK action — `pkDecay.system.ts` (2026-07-25)
- [x] ✅ DUEL handshake (0xffffff23-2a) — `combat/services/duel.service.ts:48,60,77,94,104` + `combat/managers/duel.manager.ts`, dispatch `clientServer.ts:164-166`; 1v1 request/yes/no/expire/death/disconnect
- [ ] ❌ **Duel does not bypass the PK-consent gate** — an accepted duel still requires PK mode ON for both, so duel damage cannot land. `combat.policy.ts:47,51` has no duel branch. **Likely a real gameplay bug, not just a gap**
- [ ] ❌ Guild-war revive — `revival.service.ts:20`
- [ ] ❌ Zone region-type PvP enforcement (safe zones reject PvP) — `combat.policy.ts:47`
- [ ] ❌ PK death item-drop penalty (KarmaProp table) — no code path; only `dwKarma` guard reads (`combat.policy.ts:8-9`, `entities/mover.ts:100`)
- [ ] 🚫 Lodelight (PK jail) respawn — **reclassified from ❌**: C++ `OnRevivalLodelight` is an empty stub, so the reject at `world-server/handlers/revival.handler.ts:52` is the faithful port. Not a gap
- [ ] ❌ PK-specific skill damage vars — `abilityMinPvp`/`abilityMaxPvp`/`probabilityPvp` are **parsed into the schema** (`resources/schemas/skill.schema.ts:28,30,34`) but read by nothing in `skills` or `combat`

---

## 6b. DEATH-ADJACENT PvP notes

- PvP kill now tears down an active duel via `world-server/compose.ts:647` → `duelService.onPlayerDeath`.

---

## 7. DEATH / REVIVAL

- [x] ✅ Monster death (MOVERDEATH, exp, drops, quest, remove) — `combat.service.ts:193`
- [x] ✅ Player death (dead flag, MOVERDEATH, ACTMSG STOP+DIE) — `revival.service.ts:60`
- [x] ✅ Revival (scroll in-place, lodestar town + exp penalty) — `revival.service.ts:130`
- [x] ✅ Buff clear on death (REMOVESKILLINFLUENCE + RESETDESTPARAM per buff) — `revival.service.ts:96-107`
- [x] ✅ Chaotic/PK revive HP rate (`REVIVE_HP_RATE` 0.2 / `_CHAOTIC` 0.1) — `revival.service.ts:207 restoreVitals`
- [ ] ❌ Other-player resurrection skill — no RT_HEAL-revive path, no skill hook — `revival.service.ts:20-22`
- [ ] ❌ DiePenalty.inc real table loader — hardcoded brackets; **no loader exists** (11 loaders in `resources/src/loaders`, none for penalty) and no data file — `entities/math/exp.ts:125,135`

- [ ] 🟡 5s dead lockout (`m_nDead`) — movement lockout done: all 4 move paths early-return `reason:'dead'`; attack + cast gated on the same flag — `world-core/services/movement.service.ts`. Remaining: the real `m_nDead` 5 s countdown (today `m_bDead` clears only on explicit revive)
- [ ] ❌ Cross-world revive REPLACE teleport snapshot — `teleportToRevival` is SETPOS-only — `revival.service.ts:224-227`
- [ ] ❌ Guild-war revive — no guild subsystem — `revival.service.ts:21`

---

## 8. INVENTORY / ITEMS

- [x] ✅ Add/stack/remove/move (swap)/consume/drop — `inventory.service.ts`
- [x] ✅ Gold spend/add/drop (MAX_GOLD clamp) — `inventory.service.ts:187`
- [x] ✅ Equip/unequip (server-authoritative slot, swap, level_req) — `equip.service.ts`
- [x] ✅ DST stat-bonus apply/remove on equip/unequip — `equip.service.ts:89`
- [x] ✅ **Set-item bonuses** — **UPGRADE ❌→✅**: `recomputeSetBonuses` full-recompute over `MAX_HUMAN_PARTS` with an `avails[].equipped` threshold walk, `m_setEffects` diffed through `m_params.applyEffects/removeEffects` — `equip.service.ts:66-96`, wired `compose.ts:471,692`, seeded on login `join.service.ts:228`. The old "field exists, no logic" claim was stale
- [x] ✅ Potion / food consumables — `useItem.service.ts:65`
- [ ] 🟡 Buff-grant usable items — **UPGRADE 🟥→🟡**: `IK2_BUFF`/`IK2_BUFF2` → `addItemBuff` + SETSKILLSTATE + per-effect SETDESTPARAM (`useItem.service.ts:86-115`). Skill / warp / text items are still charge-only no-ops — `:117`
- [x] ✅ Jewelry HR/parry — `hit_rate`/`parry` summed `combat/equipStats.ts:61-102`, consumed `formulas.ts:216,221-227`
- [ ] ❌ Weight / overweight enforcement — `weight: z.number().int().min(0).default(1)` is parsed with **zero consumers** (grep hits only test fixtures) — `resources/schemas/item.schema.ts:143`
- [ ] ❌ **Durability decay** — *new line, was missing from this checklist.* Nothing anywhere decrements `slot.durability`, which makes the shipped `RepairService` unreachable in practice — a no-op economy sink — `combat/formulas.ts:152-153`

### Item enhancement
- [x] ✅ Refine level storage + combat read + ACTION — storage, `UI_AO` echo, and combat read all live — `enchant.service.ts`, `equipStats.ts:61-102`, consumed `formulas.ts:177`
- [ ] 🟡 Refine / upgrade scroll (`IK3_ENCHANT`) — `ItemUpgrade.lua` tGeneral roll, non-KOR ×0.9 at +3+, fail `<3` keep / `>=3` destroy. **No anvil-NPC action path** (player-driven scroll only) — `enchant.service.ts`
- [x] ✅ Enchant element card (`IK3_ELECARD`) — sets `m_bItemResist` + `m_nResistAbilityOption`, `UI_IR`+`UI_RAO` echo, 2nd-element reject — `enchant.service.ts`
- [ ] ❌ Piercing / sockets — zero-placeholder writes only — `world-core/serializers/itemElemBody.serializer.ts:70-71`, `inventory/net/snapshot/itemSnapshot.serializer.ts:40,48`
- [x] ✅ Elements stored + combat-read + persisted + on wire — `012_item_element.ts`, `join.service.ts` load path, `itemElemBody.serializer.ts`

---

## 9. NPC / SHOP / BANK

- [x] ✅ Shop open/close/buy/sell (gold-clamped, anti-cheat) — `shop.service.ts`
- [x] ✅ Bank/warehouse open + pin + changepass (account-shared, 3 tabs) — `bank.service.ts`
- [x] ✅ Bank item deposit/withdraw — `bank.service.ts:108`
- [x] ✅ Bank per-tab gold — **UPGRADE 🟡→✅**: `getGold/setGold` tab-indexed, wire `BYTE nSlot` honored, JOIN hydrates + checkpoint flushes all 3 pools — `bank.service.ts:191`, `011_bank_per_tab_gold.ts`
- [x] ✅ NPC dialog `source:` bodies — **UPGRADE 🟡→✅ for the interpreter**: real recursive-descent evaluator with C++ int-truthiness, 19-method bindings / 13-method sink — `npc/services/dialogInterpreter.ts` (397 lines)
- [ ] 🟡 Dialog *bindings* completeness — the interpreter is real but several predicates it can call are constants: `getItemNum: () => 0`, `emptyInventoryNum: () => 32`, `partySize: () => 1`, `isParty: () => 0`, `isGuild: () => 0` — `scriptDlg.service.ts:575 makeBindings`
- [ ] 🟡 Shop cost multiplier / event buy factor — **UPGRADE ❌→🟡 with a catch**: `unitCost = max(1, floor((shopCostRate ?? 1) * rawPrice))` is implemented *and unit-tested* (`shop.service.ts:57,121`), but `ShopService` is constructed **without `shopCostRate`** at `compose.ts:803-807`, so it silently defaults to 1.0 at runtime. One-line wiring fix. Perin fixed-price still ❌

---

## 10. TRADE / VENDING

- [x] ✅ Player-to-player trade — `inventory/services/trade.service.ts` (650 lines, full `CVTInfo` state machine), handler `inventory/handlers/trade.handler.ts:36-116` (10 opcodes), dispatch `clientServer.ts:214-223`. Gold escrowed at stake; items re-validated against the live bag at commit; WAL `INVENTORY_SLOT` + `CHAR_GOLD` both sides
- [ ] 🟡 Non-tradeable flags — guild-cloak (`m_idGuild != 0`), quest-item, bound-item — `trade.service.ts:616`
- [ ] ❌ Vending / private shop — no OPENSTORE/VENDING opcode or handler. The peer ADD_OBJ frame already reserves the vendor-title field but writes `""` — `world-server/net/snapshot/mover.serializer.ts:75,90`

---

## 11. QUEST

- [x] ✅ Accept/begin + canBegin — `quest.service.ts:152`
- [x] ✅ Tracking (kill/patrol/time) — `questTracker.system.ts`
- [x] ✅ Cancel / removeAll / removeComplete / check — `quest.service.ts:209`
- [ ] 🟡 Begin conditions — party/guild stubbed permissive — `questConditions.ts:133`
- [ ] 🟡 End conditions — party/guild/state/completeQuest stubbed permissive — `questConditions.ts:196`
- [ ] 🟡 Rewards — gold/exp/item done; PK/Teleport/Hide/PetLevelup still no-op — `questRewards.ts:149-152`
- [x] ✅ Level-up SETEXPERIENCE/SETLEVEL broadcast on quest reward — **UPGRADE 🟡→✅**: the `onExpGain` sink always sends SETEXPERIENCE and broadcasts SETLEVEL when `leveled` — `compose.ts:401-413`, fired `questRewards.ts:189`
- [x] ✅ Dialog-driven turn-in — **UPGRADE 🟡→✅**: `QUEST_END_COMPLETE` (`scriptDlg.service.ts:472`) → `applyEnd:549` → `questService.endQuest`; `questEndConfirm:510` uses the real `isComplete`; `questInv:608` is a live-bag `InventoryOps`
- [x] ✅ Quest inventory adapter (real item grant/remove on reward) — `quest/services/questInventory.adapter.ts` (101 lines) `bindQuestInventory`; add → CREATEITEM/UPDATE_ITEM, remove → per-slot consume + UPDATE_ITEM. The `PERMISSIVE_INV` comment in `questRewards.ts:193` is itself stale — the bound bag is the live path
- [x] ✅ Quest offer scan (`FUNCTYPE_NEWQUEST` / `FUNCTYPE_CURRQUEST`, round-trip via `nGlobal2`) — `scriptDlg.service.ts`

---

## 12. MOVEMENT / ZONES / WORLD

- [x] ✅ Walk/run apply + broadcast + anti-teleport guard — `world-core/services/movement.service.ts:86,101,116,130`; `ANTI_TELEPORT_SQ = 1_000_000` `:73`; every path calls `visibilityService?.refresh()`
- [x] ✅ GM teleport `/te` (same-world SETPOS) — `command.service.ts:272`; 3-arg Navigator form `<worldId> <x> <z>` + 2-arg form, `x>0 && z>0` guard (`worldId` accepted and ignored)
- [ ] 🟥 PLAYERANGLE accepted + dropped — `readAngleFrame` consumes the 45-byte body then discards it; `applyAngle(_player, _now)` returns `{ok:true,reached:0}` — `movement.service.ts:150`, `playerAngle.handler.ts:57`. Flight-dependent
- [ ] ❌ Collision / terrain check — only the distance anti-cheat
- [ ] ❌ Player run/walk speed enforcement — no speed clamp anywhere in `movement.service.ts`
- [ ] 🟡 Multi-zone — buckets are real (`Map<number, Set<CPlayer>>`, `broadcastAround` frames once and reuses) but `resources/data/worlds/zones/flaris.yml` is the **only** zone file, so one zone ships — `world-core/managers/zone.manager.ts:17`
- [ ] ❌ Zone transitions / cross-world transfer — REPLACE handoff not wired; `/su` and admin teleport deliberately SETPOS (`command.service.ts:311`, `adminCommand.service.ts:208`)
- [ ] 🟡 World map — **UPGRADE ❌→🟡**: SETNAVIPOINT map-ping works and the Navigator double-click `/teleport worldId x z` path is end-to-end (`command.service.ts:272`). Still no world-map/region data model
- [ ] 🟡 Map key accept-all (no manifest) — `npc/services/mapKey.service.ts:40,44`
- [x] ✅ Vicinity radius streaming (`CLinkMap::ModifyView` port) — per-player `m_known` objid set diffed against a live radius query, streaming ADD_OBJ/DEL_OBJ deltas — `world-core/services/visibility.service.ts:110,140,152,175`. Wired into MAP_KEY, all 5 movement paths, DESTPOS, `/te` `/su` `/teleport`, admin teleport, revival, disconnect
- [ ] 🟡 Vicinity does not re-link on **monster** movement — only player moves, teleport, and spawn/despawn drive a diff; the 30 m leash bounds the error — `visibility.service.ts:27`
- [x] ✅ Player-to-player ADD_OBJ (`METHOD_EXCLUDE_ITEM` PLAYER branch) — peers appear/disappear as either side walks — `visibility.service.ts:175 diffPeers`, `world-server/net/snapshot/peerSnapshot.serializer.ts`
- [ ] 🟡 Peer frame carries an **empty buff list** — no buff icons on other players until the next SETSKILLSTATE — `mover.serializer.ts:82`

---

## 13. FLYING / MOUNTS (signature Flyff)

- [ ] 🟥 Flying (board/broom) — no flight state model; move/angle broadcast unconditionally — `movement.service.ts:108`
- [ ] ❌ Mounts / ride

---

## 14. CHARACTER PROGRESSION

- [x] ✅ Create (name/slot/dupe guards) — `charCreate.service.ts`
- [x] ✅ Select / enter-world (PRE_JOIN) — `charSelect.service.ts`
- [x] ✅ Stats allocation (MODIFY_STATUS, WAL) — `stat.service.ts`
- [x] ✅ Level / exp (cascade, WAL, SETLEVEL/SETEXPERIENCE) — `entities/math/exp.ts`, `combat.service.ts:211`
- [ ] 🟡 Delete — the **second factor arrives on the wire and is thrown away**: `char.handler.ts:124-141` reads `const _password = reader.readString(); const _deleteKey = reader.readString();` and discards both; `charCreate.service.ts:126 delete()` checks account ownership only
- [x] ✅ Job / class change 1st→2nd — **UPGRADE ❌→✅**: full port of `DPSrvr.cpp:4685-4721` + `CMover::AddChangeJob` — vagrant-only `:67`, exact-level-15 `:75`, range 1..15 `:80`, `seedRoster` `:87`, WAL `CHAR_JOB` `:94` (replayer `journalReplayers.ts:110`), SET_JOB_SKILL self + SET_NEAR_JOB_SKILL vicinity `:101,108`, `updateClass` `:117` — `world-server/services/changeJob.service.ts`. **There is no packet handler because the C++ path is itself dialog-driven**: entry is `npc/services/dialogInterpreter.ts:346 case 'ChangeJob'`, wired `scriptDlg.service.ts:318`, composed `compose.ts:612`. The old "no CHANGEJOB handler" wording was looking for the wrong thing
- [ ] 🟡 Job change caps at 15 — Master/Hero/Legend (16-39) are rejected by `changeJob.service.ts:80`, but `admin/lib/job-change.ts:21` models all five tiers. **Server and admin panel disagree**

---

## 15. SOCIAL

- [x] ✅ Normal/say chat (vicinity) — `chat.service.ts`
- [x] ✅ Shout (server-wide via PlayerManager.all) — `command.service.ts:231` (re-verified 2026-07-24)
- [x] ✅ Whisper (direct to target) — `command.service.ts:205` (re-verified 2026-07-24)
- [ ] 🟡 Party / guild / trade chat channels — party works via the `PARTYCHAT` **opcode** (`party.service.ts:276`); the `/p` and `/g` slash aliases plus guild/trade channels are absent — `command.service.ts:37`
- [ ] ❌ Guild system — only inert zero-writes (`inventory/net/snapshot/doEquip.serializer.ts:56` `idGuild=0`, `cluster-server/net/playerList.serializer.ts:64`) and dialog-interpreter stubs returning safe defaults (`npc/services/dialogInterpreter.ts:311-315`). No `guild*` tables. **Largest unstarted system**
- [x] ✅ Friend list — `social/services/friend.service.ts` (348 lines, 7 opcodes), handler `social/handlers/friend.handler.ts:44-141`, dispatch `clientServer.ts:226-230`; both-direction inserts, presence relay, actor resolved from session not packet
- [ ] 🟡 Blocklist — **storage + read path exist but nothing can write** — `database/repositories/friend.repo.ts:97 setBlocked` has no calling opcode; the roster ships blocked-aware (`friend.service.ts:251-257`). Dead storage
- [ ] 🟡 Friend presence states — `FRS_AUTOABSENT` deliberately not emitted (no idle timer) — `friend.service.ts:263`
- [ ] 🟥 Peer data reply (QUERY_PLAYER_DATA — what the friend/guild/party windows ask for) — always returns `{ reply: null }`; needs per-player `nVer` + the `sPlayerData` layout — `world-server/services/queryPlayerData.service.ts:46`
- [ ] 🟡 Motion / emote broadcast (verbatim, no `OBJMSG_*` validation) — `motion.service.ts:10`
- [ ] 🟡 Sit / rest — behavior frame accepted; still no sit state and no Stretching 1.8×/1.5× multiplier even though party now exists — `recovery.system.ts:12`
- [ ] 🟡 Taskbar — F1-F9 grid **and** the skill-queue grid now persist (v2 `{items,queue}` JSON, SKILLTASKBAR at `clientServer.ts:207`); the applet grid is still absent — `taskbar.service.ts`
- [x] ✅ Campus / master-pupil mentoring — `social/services/campus.service.ts` (506 lines), handler `social/handlers/campus.handler.ts:36,50,65,79`, dispatch `clientServer.ts:232-236`; level-91 master gate, `IK3_TS_BUFF` campus buff, point recovery on JOIN, level-up reward, boot bootstrap (`compose.ts:516,751-769,777,785`)
- [x] ✅ Cheering (CHEERING 0xffffff7c) — `world-server/services/cheer.service.ts:82`, dispatch `clientServer.ts:213`; point spend + regen tick + `II_CHEERUP` buff + motion/SFX fan-out. Points not persisted (matches C++)
- [x] ✅ MOVERFOCOUS GM target-inspect — `world-server/services/moverFocus.service.ts`, dispatch `clientServer.ts:208`; adds an `AUTH_GAMEMASTER` check C++ lacks
- [x] ✅ QUERYEQUIP / QUERYEQUIPSETTING peer-equipment inspect — dispatch `clientServer.ts:211-212`

---

## 16. INFRA / PERSISTENCE (mostly done — listed for completeness)

- [x] ✅ Login/auth (argon2id, ban, session token) — `auth.service.ts`
- [x] ✅ Char-select → world handoff (HMAC IPC) — `handoffPublisher.ts` / `clusterListener.ts`
- [x] ✅ Server / world list — `serverList.service.ts` / `worldList.service.ts`
- [x] ✅ **WAL journal + boot replay — hole closed 2026-08-02.** 10 types registered (`CHAR_EXP`, `CHAR_GOLD`, `INVENTORY_SLOT`, `BANK_PASS`, `CHAR_STATS`, `SKILL_LEARN`, `CHAR_JOB`, `BANK_SLOT`, `BANK_GOLD`, `PK_KILL` — `journalReplayers.ts`) and **every type any service emits now has one**, guarded by a test that appends one row per emitted type and asserts `summary.skipped === 0`. Five delta-shaped types that had no replayer were rewritten as absolute end-state rows per rule 04: `ITEM_MOVE`/`ITEM_DROP`/`ITEM_CONSUME` → paired `INVENTORY_SLOT`, `GOLD_DROP` → `CHAR_GOLD`, `BANK_DEPOSIT`/`BANK_WITHDRAW` → `BANK_SLOT` + `INVENTORY_SLOT`. `BANK_GOLD` and `PK_KILL` are new replayers
- [x] ✅ 30s checkpoint DB sync + dirty flags — `checkpoint.system.ts:28` `FLUSH_INTERVAL_MS=30_000`, idempotent `start()` `:40`, try/catch, fire-and-forget; per-player flush `join.service.ts:319`, loop + `presenceRepo.touch` `:355-364`
- [ ] 🟡 argon2id ships a fallback — argon2id primary via dynamic `require('argon2')`; fallback is a deterministic scrypt PHC-ish hash embedding its own salt. `argon2 ^0.40.1` **is** a declared dep in login-server + world-server, so prod can be real — `core/utils/password.ts:15`
- [x] ✅ Draining shutdown — stops listener then `adminCommandService.kickAll('shutdown:'+signal)`; `process.on('message',{cmd:'shutdown'})` is the real Windows stop path; `uncaughtException` drains, `unhandledRejection` deliberately does not — `world-server/index.ts:196,206,232-233,238,247,253`
- [x] ✅ Forced-logout kick (SEALCHARGET_REQ) — `adminCommand.service.ts:101 kick`, `:140 kickAll` (awaited flush); `buildKickNotice` + `KICK_CLOSE_DELAY_MS` — needed because C++ sends nothing and the v19 client silently freezes on a bare close
- [x] ✅ Boot presence cleanup — `presenceRepo.clearByServer(config.server.id)` so the admin panel shows no ghosts after a crash — `compose.ts:300`

---

## 17. ADMIN PANEL / LIVE-OPS *(new section 2026-08-01)*

No C++ analogue — grade against its own contract, not v19 fidelity.

- [x] ✅ Auth-gated Next.js 15 panel — `admin/middleware.ts:1` `export { auth as middleware }`, matcher excludes only `login`, `api/auth`, `_next/*`, favicon
- [x] ✅ 27 pages / 17 API routes — accounts, characters, bank, inventory, servers, settings + 10 resource-editor groups
- [x] ✅ Live-ops command channel — `world-server/ipc/adminListener.ts:122` on the `admin:command` channel (rule 07 naming), composed `compose.ts:860`
- [x] ✅ Admin audit log — `admin/lib/audit.ts:34 writeAudit`, `admin_audit_log` table `admin/lib/migrate.ts:318`
- [x] ✅ Admin teleport is SETPOS-safe (never REPLACE); no-coords falls back to the zone's `revival.position` — `adminCommand.service.ts:208`
- [ ] 🟡 EXP edited as percent — 0-100% ↔ raw via `EXP_TABLE[level+1].nExp1`; admin depends on `@flyff/entities` for the table — `admin/lib/exp-percent.ts`
- [ ] 🟡 Job-change autofill disagrees with the server (see §14)
- [ ] 🟡 `@flyff/admin` is the one package `pnpm -r build` cannot build without `next` installed — it is a Next app, not a tsup bundle

---

## 18. SUPERVISOR DAEMON *(new section 2026-08-01)*

- [x] ✅ Detached daemon owns login/cluster/world children — loopback HTTP API (`/health`, `/status`, `/logs`, `/logs/clear`, `/start`, `/stop`, `/shutdown`), every route requiring `x-supervisor-token` — `admin/lib/supervisor-daemon.ts:13-22`
- [x] ✅ Shared constants — `DAEMON_ENTRY`, `DEFAULT_PORT=28900`, `AUTH_HEADER`, `LOG_RING=500`, `ENTRY: Record<ServerType,string>` — `admin/lib/supervisor-shared.ts:30-39`
- [x] ✅ Token file `data/supervisor.token`, shared by the panel and `pnpm sv:*`
- [ ] 🟡 Single-host, no auto-restart of crashed children and no daemon restart on host reboot — `supervisor-daemon.ts:23`
- [ ] 🟡 Windows stop is IPC not signal — child stop goes through `{cmd:'shutdown'}` over the stdio channel because a Windows SIGTERM handler never runs — `world-server/index.ts:238`

---

## 19. LOG HUB / SERVER CONSOLE *(new section 2026-08-01)*

- [x] ✅ Ring-buffer log hub (500 lines) — `admin/lib/supervisor-shared.ts:125 class LogHub`, `:133 push`
- [x] ✅ Long-poll streaming — `/logs?id&since&wait=1` (≤20 s hold); route `admin/app/api/servers/[id]/logs/route.ts`
- [x] ✅ Level parsing + filtering — `admin/lib/log-line.ts:48 parseLogLine`, `:74 FILTERABLE`, `:81 passesLevel`
- [x] ✅ Persistent clear — `DELETE` → `/logs/clear`

---

## 20. MAIL / POST *(new section 2026-08-01)* — **USER-CONFIRMED 2026-08-02**

Every line below was tested on a real v19 client by the user and confirmed
working. This is the one section where ✅ means *fixed*, not "passes my checks".

- [x] ✅ Read path (5 opcodes: QUERYMAILBOX, READMAIL, QUERYGETMAILITEM, QUERYGETMAILGOLD, QUERYREMOVEMAIL) — `mail/handlers/mail.handler.ts:56-78`, dispatch `clientServer.ts:244-248`
- [x] ✅ Mailbox-state sync (`CUser::AdjustMailboxState` port; MODE_MAILBOX is the only new-mail indicator) — `mail/services/mail.service.ts:143 syncMailboxMode`
- [x] ✅ Schema — `017_presence_and_mail.ts`, `mail` table with the full C++ `CMail` field mapping
- [ ] 🚫 Player→player send — `QUERYPOSTMAIL` 0x1a **deliberately** unwired; `SNAPSHOTTYPE_POSTMAIL` intentionally absent. Admin-originated mail only. Postage/custody fees and stamped mail also out of scope by choice
- [x] ✅ Attachment fidelity — refine / element / flags dropped on attachments. **User-confirmed acceptable** — admin-originated mail is the only sender and the admin form does not set those fields — `mail.service.ts:90`

---

## 21. ONLINE PRESENCE *(new section 2026-08-01)*

Emulator infrastructure with no C++ analogue.

- [x] ✅ `online_players` table (character_id PK, account_id, world_id, zone_id, server_id, last_seen_ms) — `017_presence_and_mail.ts:39`
- [x] ✅ Upsert / remove / touch — `join.service.ts:149`, `:267`, checkpoint loop `:355-364`
- [x] ✅ Staleness window — `PRESENCE_STALE_MS = 60_000`, `isOnline`, `getOnlineCharacterIds` — `admin/lib/presence.ts:20-29`
- [x] ✅ Boot cleanup — `compose.ts:300`

---

## 22. GATEWAY (unified WebSocket) — recommend delete-or-document

- [ ] 🟥 **Orphaned prototype**, 963 lines across 8 files (`packages/gateway/src/*`). Three independent dead-code signals: zero external references to `@flyff/gateway`; absent from the supervisor `ENTRY` map (`supervisor-shared.ts:39`); last touched by a build refactor only
- [ ] 🟥 **Divergent duplicate of the real world path** — handles only PRE_JOIN, JOIN, PLAYERMOVED, MOVERDESTPOS, PLAYERANGLE, CHAT, PING, LEAVE (`gateway/src/worldHandlers.ts:20-158`) and hand-rolls its own accounts/characters DDL instead of using `@flyff/database` migrations (`main.ts:14-60 ensureSchema`). A second JOIN/movement implementation that no longer tracks the primary one is a fidelity liability, not just dead weight
- **Recommendation:** delete it, or add a header stating it is an unshipped experiment and exclude it from fidelity audits

---

## Biggest gaps, ranked (re-ranked 2026-08-01)

The 2026-07-23 ranking is obsolete — items 1, 2, 6, and 8 shipped, and 3 partly
shipped. Current ranking:

1. **Guild** — the largest wholly unstarted system. Blocks guild chat/`/g`,
   guild-party, guild-war revive, guild bank, guild quest conditions, the
   `idGuild` non-tradeable flag, and several dialog predicates that currently
   return safe constants. No tables exist.
2. **Flying + mounts** — signature Flyff mechanic, entirely absent, and it is
   the blocker behind PLAYERANGLE being accepted-and-discarded plus the
   flying-mismatch targeting deferral.
3. **Skill effect breadth** — AoE and projectile remain 🟥 (DoT, multi-hit, and
   buff skills have since shipped).
4. **Zone transitions / collision / world map** — one zone ships; no REPLACE
   cross-world handoff; no terrain or speed enforcement.
5. **Vending / private shop** — the other half of the economy loop now that
   player trade has landed.
6. **Pets** — never audited in this checklist, entirely absent, and a signature
   v19 system (`PET_RELEASE`/`USE_PET_FEED` opcodes are not even declared).
7. **Weight + durability decay** — both parsed/stored and consumed by nothing;
   durability's absence makes the shipped `RepairService` a no-op sink.
8. **Piercing / sockets / awakening** — zero-placeholder writes only.
9. **Aggro table + flight/collision AI** — plus the data-starvation bugs below.
10. **Mining / gathering, day-night / weather** — small self-contained systems,
    never started.

### Fix-first shortlist (small effort, disproportionate effect)

These are *implemented but inert*, so each is a wiring or data fix rather than a
feature build:

1. `shopCostRate` omitted from the `ShopService` ctor — `compose.ts:803-807`
2. `partyQuery` never supplied, so quest party conditions fail closed — consumed `quest.service.ts:145`
3. `CHRSTATE_BITS.SLEEP` does not exist — sleep never gates (`player.ts:622` vs `dst.ts:112-119`)
4. ~~`BANK_DEPOSIT`/`BANK_WITHDRAW` have no replayer~~ — **fixed 2026-08-02** (§16); five delta types converted to absolute rows, `BANK_SLOT`/`BANK_GOLD`/`PK_KILL` replayers added, coverage now test-guarded
5. Duel does not bypass the PK-consent gate — `combat.policy.ts:51`
6. Flee + self-heal AI are fully coded but fed zeros — no converter exports `propMoverEx` `SetRunAway`/`Recovery`
7. `dwReAttackDelay` reads propMover col 34 instead of col 35
8. Blocklist `setBlocked` has no calling opcode
9. Movement is not stun-gated — `movement.service.ts:88,103,113,132`
10. `IK3_TEXT_DISGUISE` aggro check — the "when buffs ship" precondition is met

---

## Re-verification changelog (2026-08-01)

Full re-audit against master `c9ae378` (136 commits after the 2026-07-24 pass),
4 parallel read-only explorers over all 16 original sections.

**Upgrades ❌/🟥 → ✅:** party invite/list/exp-share/loot-share; DUEL handshake;
player-to-player trade; friend roster; campus/mentor; set-item bonuses; bank
per-tab gold; NPC dialog `source:` interpreter; dialog-driven quest turn-in;
quest level-up broadcast; job change 1st→2nd; buff skills; DoT; multi-hit skills;
vicinity streaming; peer-player ADD_OBJ; cheering; MOVERFOCOUS; QUERYEQUIP.

**Newly identified gaps (not previously listed):** durability decay (makes
`RepairService` inert); USESKILL cast-range validation (anti-cheat); the
`CHRSTATE_BITS.SLEEP` type bug; monster debuff icons never clearing; DoT death
granting no exp/drops/MOVERDEATH; flee + healer AI starved of data; the
`dwReAttackDelay` wrong-column bug; the duel/PK-consent interaction; the
unsettable blocklist; and the orphaned `@flyff/gateway` package.

**Retired as not-gaps:** ammo/arrow consumption (v19 bows are ammo-less by
design); skill crit (skills never crit — `MoverAttack.cpp:800`); Lodelight
respawn (C++ `OnRevivalLodelight` is an empty stub, so the reject is faithful);
player→player mail send (deliberate scope choice).

**Six new sections added:** 17 admin/live-ops, 18 supervisor daemon, 19 log hub,
20 mail, 21 online presence, 22 gateway (delete-or-document).

**Baseline observed:** `pnpm -r build` → 18/19 `Build success` (only
`@flyff/admin` needs `next`); 20 migrations, all present in `seed.ts`.

---

## Re-verification changelog (2026-07-24)

Full re-audit against live code (3 parallel explorers, 57 items). Changes vs the
2026-07-23 baseline:

**Upgrades (now implemented):**
- Heal skills 🟥→✅ (`skill.service.ts:232 applyHeal`; RT_HEAL target + formula).
- NPC ranged attack 🟡→✅ (`ai.system.ts:222` RANGE_ATTACK emit + re-attack delay).
- Player ranged auto-attack ❌→✅ (`rangeAttack.handler/service.ts`; `d820182`).
- Ranged monster AI split off ✅ (healer AI still ❌).
- MP/FP consume on cast 🟡→✅ (`skill.service.ts:191 spendResource`, KT-routed, pre-spend gate).
- Shout routing 🟡→✅ (`command.service.ts:231`).
- Whisper routing 🟡→✅ (`command.service.ts:205`).
- Skill crit + nProbability effect-proc gate added (`51cd9ba`).

**Path corrections (files moved during world-server carve-out refactor):**
- `aiConstants.ts` → `packages/entities/src/constants/aiConstants.ts`
- `exp.ts` → `packages/entities/src/math/exp.ts`
- `itemSnapshot.serializer.ts` → `packages/inventory/src/net/snapshot/`
- `item.schema.ts` → `packages/resources/src/schemas/`

**No downgrades** — every previously-✅ item held under re-verification.

