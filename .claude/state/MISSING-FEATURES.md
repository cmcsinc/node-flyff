# Flyff v19 — Missing Features Checklist

> **Fidelity audit (2026-07-27):** All 64 TS↔C++ behavioral deviations found in
> the C++ fidelity audit (`docs/c++-fidelity-audit.md`) have been resolved. This
> checklist covers features not yet ported at all (wider scope).

Generated 2026-07-23 from a full-source sweep (3 parallel domain maps + every
`ponytail:` comment). Re-verified 2026-07-24 (57 items), **re-verified 2026-08-01**
against master `c9ae378` (136 commits later) by 4 parallel read-only explorers
over 16 sections, **targeted re-audit 2026-08-03** (4 parallel explorers —
opcode gap, unstarted systems, slash commands, fix-first shortlist re-verify)
which added §23-25, and **spot re-verify 2026-08-04** of 10 §1-2 / shortlist
claims against live code. Compares the emulator against full retail v19.

**Status legend**
- ✅ DONE — implemented + passing on this device's checks (NOT user-confirmed)
- 🟡 PARTIAL — core path works, sub-features/edge-cases stubbed
- 🟥 STUB — code exists but does nothing meaningful (charge consumed, no effect)
- ❌ MISSING — no code path at all

**Override rule:** ✅ here = "passes my checks", never "fixed". Only the user
declares a feature fixed by testing on a real v19 client.

**Companion signal:** there are **157 `ponytail:` markers across 82 files**
(re-counted 2026-08-04) — a denser, line-level gap inventory than this
checklist. When a line here says PARTIAL, the ponytail at the cited file:line
usually names exactly what is missing. `grep -rn "ponytail:" packages/*/src` is
the authoritative sweep.

**Tally at this refresh** (25 sections — sections 1-22 carry the 206-line tally
✅ 127 · 🟡 45 · ❌ 22 · 🟥 8 · 🚫 4; §23-25 add ~167 opcode gaps + ~25 absent
systems + ~60 missing GM commands tracked separately as cross-cutting audits).

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
- [x] ✅ Debuff proc roll **is** enforced — the gate reads the rolled
  `effectProc` from `skillFormulas.ts:321` (`prob === undefined || rng.int(100) <
  prob`), surfaced via `combat.service.ts:290,314` and consumed at
  `skill.service.ts:376` (`&& outcome.effectProc !== false`). A debuff whose
  `nProbability` roll failed no longer lands. Fixed in `812bf3f`
- [ ] 🟥 AoE (area skills) — no runtime consumer of `skillRange`/`spellRegion` in
  `combat/` or `skills/`. Re-verified 2026-08-04: the only hits are a comment
  (`skill.service.ts:329`), an admin field label, YAML data, and a test asserting
  `skillRange` is *deliberately* ignored by the cast-range gate
  (`skill.service.test.ts:422`). Needs `ApplySkillRegion`/`Around`/`Line` ports
  (`_Common/Ctrl.cpp:255,420,1675`) — `skillRange` is their radius input
- [x] ✅ DoT (damage-over-time) — `entities/params/BuffManager.ts:219 tickDots`, `world-server/systems/buff.system.ts:59` (players), `ai.system.ts:126` (monsters); seeded via `dotFromSkill()` `skill.service.ts:732`
- [ ] 🟡 **DoT death is not a real death** — re-verified 2026-08-04, both halves
  still true. Monster DoT death sets `m_bDead` and `continue`s with no MOVERDEATH
  broadcast, no exp, no drops (`ai.system.ts:135-138`, ponytail at `:128`). Player
  DoT death subtracts HP and sends only SETPOINTPARAM DST_HP — no DAMAGE
  snapshot, no killer attribution, never triggers `onPlayerDeath`
  (`buff.system.ts:67-76`, ponytail at `:74`)
- [x] ✅ Multi-hit skills (`nSkillCount` chain: N rolls + N DAMAGE snapshots, stops on death) — `combat.service.ts:185-213`
- [ ] 🟥 Projectile skills — no server-side projectile path in `combat/` or
  `skills/` (re-verified 2026-08-04: only ponytail comments at
  `skillFormulas.ts:10,264`, `skill.service.ts:178`). Ranged auto-attack ships,
  but its projectile is client-side visual only — no flight time, no travel
  interception (`rangeAttack.service.ts:14`)
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
- [x] ✅ Cast-range validation — **emulator-only divergence, not a port.** The C++
  WORLDSERVER never gates cast distance: `DoUseSkill` (`MoverSkill.cpp:320-1160`)
  checks die/fly/mode/target/PK/weapon/level/cooldown/MP and no distance
  (`docs/skills-research.md:77` states this explicitly). `GetAttackRange` is used
  for skills only in the CLIENT-side `CMD_SetUseSkill` (`MoverMsg.cpp:206`,
  callers `WndManager.cpp:7337` + `WndTaskBar.cpp:2366`), where it feeds
  `SetDestObj(target, fArrivalRange)` — the walk-to distance, not a reject. We add
  the gate anyway since an emulator can't trust the client, and AR_* is the right
  magnitude because a genuine client is always inside it when the cast fires.
  Implementation: `skill.service.ts:326-352` →
  `getAttackRange(skill.attackRange, player.m_params) + RANGE_HITBOX_SLACK`
  (`entities/constants/attackRange.ts`, the `GetAttackRange` metre table
  `MoverMsg.cpp:140-166` + `DST_HAWKEYE_RATE` scaling). Out-of-range →
  CLEAR_USESKILL, no MP/FP, no cooldown, no broadcast. **Was ❌ then briefly
  wrong**: `812bf3f` gated on the per-level `skillRange`, which is the AoE radius
  (`Ctrl.cpp:268/432/752`), capping Heal at 6 m instead of AR_WAND's 15 m and
  limiting 1 m-AoE melee skills to a 1 m cast. `RANGE_HITBOX_SLACK` (2 m) stands
  in for the two model radii `IsRangeObj` adds (`Obj.cpp:805`); ponytail for real
  bounds. **NOT user-tested**

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
- [x] ✅ Flee / low-HP retreat — **code ✅, data ✅ (re-verified 2026-08-04).**
  Gate `ai.system.ts:213-222`, `startFlee` (50 m, `FLEE_SPEED_FACTOR`),
  `stepFlee`; `spawn.manager.ts:204-205,365-366` now pass
  `fleeHpPct`/`runawayDelay`, assigned at `mover.ts:416-417`, data present in
  `data/movers/monsters.yml` via `converters/movers.ts:221`. Test-covered at
  `ai.system.test.ts:574`. Monsters with no `SetRunAway` never flee — faithful
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
- [ ] 🟡 Vending / private shop — **UPGRADE ❌→🟡**: full 6-opcode PVENDOR port — `inventory/services/vendor.service.ts` (CVTInfo vendor half, sibling of trade), `inventory/handlers/vendor.handler.ts`, `inventory/net/snapshot/vendor.serializer.ts`, dispatch `clientServer.ts:225-232`, compose `:774-783`. Open/register/unregister/query/buy/close + onDisconnect; buy re-validates the listing against the live bag (dupe-safe) and WAL-journals `INVENTORY_SLOT`+`CHAR_GOLD` both sides via `InventoryService`. Peer ADD_OBJ title field populated from `m_vtInfo.title` (`mover.serializer.ts:91`). 12 service tests green. **Ponytail'd C++ guards not enforced**: chaotic-Propensity.nVendor gate (no PK penalty table), guild-war/miniroom/quiz-world rejects (no worlds), fly check (no flight state), bound/guild-cloak/vagrant-ride item flags (not on `InventorySlot` — only quest IK3 + equipped are enforced, same surface trade stubs), chatting-room integration (bState hardcoded 1), CNPC-radius 3m reject (no NPC spatial index). In-memory only — faithful, C++ closes the shop on disconnect

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

## 23. C→S OPCODE GAP *(new section 2026-08-03)*

Full audit of v19 C++ `DPSrvr.cpp:122-579` `OnMsg` table (+`USESKILL` in
`DPSrvrLux.cpp:32`) vs emulator `clientServer.ts` dispatch. **~228 C→S opcodes
in C++; emulator routes 101, misses ~167.** Excludes S→C-only / IPC-only / the
6 known-dead codes (already retired in `unimplemented-packets-audit` memory).

### Declared-but-undispatched (cheapest — opcode value already pinned in `opcodes.ts`)

| Opcode | hex | C++ handler | Purpose |
|---|---|---|---|
| `MAGIC_ATTACK` | `0x00ff0011` | `DPSrvr.cpp:223 OnMagicAttack` | Magic/spell attack swing — the one remaining combat path |
| `PROPOSE` | `0x8FFFF000` | `DPSrvr.cpp:511 OnPropose` | Couple propose (string target) |
| `REFUSE` | `0x8FFFF001` | `DPSrvr.cpp:512 OnRefuse` | Couple refuse |
| `COUPLE` | `0x8FFFF002` | `DPSrvr.cpp:513 OnCouple` | Couple accept |
| `DECOUPLE` | `0x8FFFF003` | `DPSrvr.cpp:514 OnDecouple` | Break couple |

Snapshots `COUPLE_PROPOSE_RESULT/COUPLE_RESULT/DECOUPLE_RESULT/ADD_COUPLE_EXPERIENCE` (`0x9701-5`) are also already declared at `opcodes.ts:399-402` — someone pre-stubbed Couple for build but never wired dispatch.

### Core holes (not subsystem-clustered, newly identified)

`MELEE_ATTACK2` · `SFX_ID`/`SFX_CLEAR`/`SFX_HIT` · `TELESKILL` (blink) ·
`RETURNSCROLL` (use return scroll) · `RESURRECTION_OK`/`RESURRECTION_CANCEL`
(accept/cancel other-player resurrect) · `STATEMODE` · `MODIFYMODE` ·
`TELEPORTER` (NPC teleporter UI) · `SETLODELIGHT` (set respawn point) ·
`INC_STAT_LEVEL` · `SEND_TO_SERVER_CHANGEJOB` (packet-driven job change — note:
dialog-driven path already works, see §14) · `SUMMONPLAYER`/`TELEPORTPLAYER`
(GM teleport-target) · `PARTYSKILLUSE` · `QUERY_PLAYER_DATA2` (v2 of friend/guild
peer-data) · `ADDAPPLETTASKBAR`/`REMOVEAPPLETTASKBAR`/`SCROLLTASKBAR` (applet
taskbar grid — §15 notes applet grid absent) · `CTRL_COOLTIME_CANCEL` ·
`CORR_REQ`/`PLAYERCORR2` (position correction) · `DO_USE_ITEM_TARGET`/
`DO_USE_ITEM_INPUT` (identify / Azria scroll) · `SET_HAIR`/`CHANGEFACE`
(cosmetic) · `AWAKENING`/`PIERCING`/`PIERCINGREMOVE`/`PIERCING_SIZE`/
`CHANGE_ATTRIBUTE`/`REMOVE_ATTRIBUTE`/`SMELT_SAFETY`/`UPGRADEBASE`/`BARUNA`/
`PACHETTYPE_ITEMTRANSY` (item-upgrade side-channels — §8) · `PET_RELEASE`/
`USE_PET_FEED`/`MAKE_PET_FEED`/`CLEAR_PET_NAME`/`TRANSFORM_ITEM` (pets — §rank-6)
· `AVAIL_POCKET`/`MOVE_ITEM_POCKET` (pocket tabs).

### Subsystem clusters (count of undeclared opcodes)

Guild bank 5 · Guild combat 13 · 1v1 guild combat 9 · Secret room 9 ·
Rainbow race 5 · Housing 5 · Guild house 7 · Ultimate weapon 6 · Minigames 8 ·
Pet/feed 8 · Guild core (invite/logo/notice/contribution/ranking) 6 ·
Lord/election 5 · Honor 2 · Collecting 2 · Wanted-list 4 · Chatting-room 4 ·
Summon-friend/party 5 · Arena (enter/exit) 2 · `QUERYPOSTMAIL` (deliberate skip,
opcodes.ts:18).

> **`MOVEBANKITEM` caveat:** the `opcodes.ts` comment claims it is an unregistered
> C++ stub, but `ON_MSG` at `DPSrvr.cpp:169` does register `OnMoveBankItem`.
> Re-check the handler body before trusting either claim.

---

## 24. UNSTARTED FEATURE SYSTEMS *(new section 2026-08-03)*

Whole systems entirely absent from the emulator (zero code path) or stubbed at
the protocol layer only. Decomposes the existing biggest-gap ranks 1, 6, 10 into
separable subsystems and adds systems never previously tracked.

### Player-facing / signature (ranked by blocking + visibility)

| System | C++ source | Emulator | Blocks |
|---|---|---|---|
| **Guild sub-tree** (9 subsystems) | `guild.cpp` + 8 siblings | absent | guild chat `/g`, guild-party, guild-war revive, guild bank, guild quest, guild cloak flag, guild non-tradeable, dialog predicates |
| **Lord / Election / Lord skills** | `lord.cpp`, `slord.cpp`, `lordskill.cpp`, `election.inc`, `lordevent.inc` | absent | Lord-controlled Tax rate, lord-skill server-wide buffs, lordevent |
| **Couple / Marriage** | `couple.cpp`, `couplehelper.cpp`, `couple.inc` | **protocol-stubbed** (opcodes declared, undispatched — see §23) | couple quest conditions, `IK3_COUPLE_BUFF` items, propKarma branch |
| **Instance / Party Dungeon** | `InstanceDungeonBase.cpp`, `InstanceDungeonParty.cpp`, `PartyDungeon.lua` | absent | `propQuest-DungeonandPK.inc` (unprocessed), `propQuest-Scenario.inc`, endgame PvE |
| **Event / Live-ops** | `EventLua.cpp`, `flyffevent.cpp`, `EventMonster.cpp`, `spevent.cpp` + 4 lua + `propEvent.inc`/`propDropEvent.inc`/`randomeventmonster.inc` | absent | every data-driven drop/spawn/exp event — core live-ops tool |
| **Pets** (5 subsystems) | `pet.h` `PETLEVEL` enum, egg→D-C-B-A-S | absent | `dwPetId` field always `NULL_ID` (`mover.serializer.ts:78`); collecting/auto-loot |
| **Rainbow Race** | `RainbowRace.cpp` + siblings | absent | standalone minigame |
| **Colosseum** | `Colosseum.cpp`, `Colosseum.lua` | absent | instanced PvP arena |
| **Secret Room** | `SecretRoom.cpp`, `SecretRoomDBMng.cpp` | absent | guild-vs-guild war; Tax revenue |
| **Housing** | `Housing.cpp`, `HousingDBCtrl.cpp` | absent | standalone |
| **Guild House** | `GuildHouse.cpp` + dialog `mafl_guildhousesale.yml` (ships!) | absent (dialog predicates return safe constants) | guild-house ownership |
| **7 MiniGames** | `MiniGame{Arithmetic,Diceplay,Gawibawibo,Ladder,Pairgame,Stopwatch,Typing}.cpp` | absent | FunnyCoin economy |
| **Quiz Event / Quiz World** | `Quiz.cpp`, `QuizEvent.lua` | absent | standalone event |
| **Fishing** | `propItemEtc.inc` rods/bait, `IK3_FISHROD` | absent | self-contained gathering skill |
| **Auction House** | `auction.cpp` | absent | cross-player economy |
| **Wanted List (bounty)** | `WantedList.cpp`, `WantedListSnapshot.cpp` | absent | PvP incentive loop |
| **Honor / Title** | `honor.cpp`, `defineHonor.h` | absent | title-gated dialog conditions |
| **Ultimate Weapon** | `UltimateWeapon.cpp` | absent | endgame weapon progression; ultimate-piercing column |
| **Collecting (auto-loot pet)** | `collecting.cpp`, `collecting.inc` | absent | loot-pet economy sink |
| **Rangda (world boss)** | `rangda.cpp` | absent | world-boss PvE loop |
| **Environment / Weather / Day-Night** | `Environment.cpp`, `weather.cpp`, `Light.cpp`, `SkyBox.cpp` | absent | ambient only |

### Economy / sink

| System | C++ source | Emulator | Blocks |
|---|---|---|---|
| **Tax System** | `Tax.cpp`, `Tax.lua` | absent (one stale comment at `shop.service.ts:106`) | downstream of Lord+SecretRoom; **upstream of every shop transaction** — the cost multiplier |
| **Funny Coin** | `FunnyCoin.cpp` | absent | minigame currency spend |
| **PCBang bonuses** | `PCBang.cpp` | absent | region-locked; N/A for most deployments |

### Stubbed / partial

| System | C++ source | Emulator | Blocks |
|---|---|---|---|
| **Pocket (extra inv tabs)** | `pocket.cpp`, `CPocketController` | stub — `mover.serializer.ts:47` writes 3 zero flag bytes for absent CPocketController | bank overflow, premium-bag economy |
| **BeautyShop / SkinChange / LookChange** | `character.inc` `MMI_BEAUTYSHOP*`/`MMI_LOOKCHANGE` | absent — `characterInc.loader.ts:32-45` does not know these MMI constants → parse to undefined | cosmetic coupon economy |
| **NPC Marking (minimap markers)** | `character.inc` `MMI_MARKING` | constant only (loader:8), no service consumes it | navigation UX |
| **Guild Banking** | `character.inc` `MMI_GUILDBANKING` | constant only (loader:15) | guild-shared bank |

---

## 25. SLASH COMMANDS *(new section 2026-08-03)*

Full audit of `FuncTextCmd.cpp:5157-5522` ON_TEXTCMDFUNC table vs
`command.service.ts` + `adminCommand.service.ts`. **Player: 3/25 ported
(`/w`, `/say`, `/s`). GM: ~35 ported, ~60 missing.**

### Player commands

- **Ported:** `/w` whisper, `/say`, `/s` shout
- **Blocked on subsystems:** `/p` party chat, `/g` guild chat, `/partyinvite`, `/guildinvite`, `/campusinvite`
- **Client-only `TCM_CLIENT` (no server work):** 17 preference/display toggles — `/pos`, `/ti`, `/ta`+`/tr`, `/wa`+`/wr`, `/ma`+`/mr`, `/ga`+`/gr`, `/ca`+`/cr`, `/ha`+`/hr`, `/ig`+`/uig`+`/igl`. Not gaps

### Highest-value GM commands still missing (no new subsystem needed)

- `/cjob` changejob — needs `characterRepo.updateJob` (high test value)
- `/mute` `/talk` `/nota` `/freeze` `/nofr` — target-named mode pipeline
- `/slv` `/slvAll` `/InitSE` — skill level (skill system exists)
- `/setskilllevel`-family + `/ci2` secondary create-item

### Blocked GM commands (need their subsystem first)

`/cg` `/dg` `/gstat` (guild); `/plv` (party); `/gcopen`/`gcclose`/`gcin`/`gcNext` (guild combat); `/pl` `/pe` `/mpf` `/cpn` (pets); `/Propose`/`Couple`/`Decouple` (couple); `/ranking` (guild ranking); `/SecretRoom*` (8); `/BuyGuildHouse`/`/GuildHouseUpkeep`; all Lord/Election; `/ritem` `/pier` `/gro`/`iro`/`sro` (item random-option).

---

## Biggest gaps, ranked (re-ranked 2026-08-03)

The 2026-07-23 ranking is obsolete — items 1, 2, 6, and 8 shipped, and 3 partly
shipped. Current ranking (re-ranked 2026-08-03 after §23-25 audits):

1. **Guild** — largest wholly unstarted system; §24 decomposes it into **9
   separable subsystems** (core roster, `/g` chat, guild bank, guild quest, guild
   war, guild combat 1v1, guild house, guild party flag, guild cloak flag). No
   tables exist. ~30 undeclared C→S opcodes cluster here.
2. **Flying + mounts** — signature Flyff mechanic, entirely absent, and it is
   the blocker behind PLAYERANGLE being accepted-and-discarded plus the
   flying-mismatch targeting deferral.
3. **Skill effect breadth** — AoE and projectile remain 🟥 (DoT, multi-hit, and
   buff skills have since shipped). `MAGIC_ATTACK` opcode declared but still
   undispatched (§23).
4. **Lord / Election / Tax** — v15 signature player-elected Lord; controls the
   Tax rate that gates every shop cost. Entirely absent, 4 C++ files + 2 inc.
5. **Event / Live-ops** — 4 C++ source + 4 lua + 3 `.inc` unparseable; without
   it, the server cannot run any temporary event (the primary live-ops tool).
6. **Couple / Marriage** — opcodes + snapshots already declared (pre-stubbed),
   only dispatch + service + DB missing; couple skills + `IK3_COUPLE_BUFF` items
   + propKarma branch downstream.
7. **Pets** — entirely absent; §24 decomposes into 5 subsystems. `PET_RELEASE`/
   `USE_PET_FEED` opcodes not even declared.
8. **Instance / Party Dungeon** — v19 endgame PvE; blocks `propQuest-Scenario.inc`
   + `propQuest-DungeonandPK.inc` (both ship unprocessed).
9. **Zone transitions / world map** — one zone ships; no REPLACE cross-world
   handoff; no terrain or speed enforcement. (`Vending` dropped off — shipped 🟡
   2026-08-02, see §10.)
10. **Weight + durability decay + piercing/sockets/awakening + BeautyShop** —
    parsed/stored and consumed by nothing; durability's absence makes the shipped
    `RepairService` a no-op sink. The full item-upgrade side-channel
    (awakening/piercing/attribute-change/smelt/baruna/transy) is ~10 undeclared
    opcodes (§23).

### Newly affordable "wiring-only" wins (small effort, no new subsystem)

All five re-verified 2026-08-04; all still open.

1. **`MAGIC_ATTACK` dispatch** — opcode declared `opcodes.ts:50` `0x00ff0011`;
   `clientServer.ts:167-168` registers only MELEE_ATTACK + RANGE_ATTACK. No
   handler file exists. Closes the last combat-path hole.
2. **Couple 4-opcode dispatch** — opcodes + snapshots already declared; service
   + repo + dispatch missing (rank-6 above).
3. **`partyQuery` wiring** — `compose.ts:396-428` `new QuestService({...})` has
   no `partyQuery` key; consumer `quest.service.ts:96,155` stays falsy. One-line
   fix unblocks quest party conditions (last survivor of fix-first #2).
4. **`IK3_TEXT_DISGUISE` aggro buff check** — `ai.system.ts:460-462 isHidden()`
   tests only `MODE.TRANSPARENT`; buffs shipped long ago (fix-first #10).
5. **Flee/heal AI `healCadenceMs`** — `converters/movers.ts:223-224` emits only
   `healHpPct`/`healPct`, `mover.schema.ts:142-162` has no cadence key, and
   `spawn.manager.ts:206-209,367-370` pass only `healHpPct`/`healAmount`, so
   `mover.ts:420` always defaults to 1000 ms (fix-first #6 partial).

### Fix-first shortlist (small effort, disproportionate effect)

These are *implemented but inert*, so each is a wiring or data fix rather than a
feature build. **Re-verified 2026-08-04** — 7 of 10 fixed, #6 upgraded to
mostly-fixed (flee data now threaded; only `healCadenceMs` remains):

1. ~~`shopCostRate` omitted from the `ShopService` ctor~~ — **fixed** `compose.ts:855` passes `config.world.shopCostRate`
2. `partyQuery` never supplied, so quest party conditions fail closed — **STILL BROKEN** (re-verified 2026-08-04): `compose.ts:396-428` `new QuestService({...})` has no `partyQuery`; consumer `quest.service.ts:96,155` stays falsy
3. ~~`CHRSTATE_BITS.SLEEP` does not exist~~ — **fixed** `entities/src/constants/dst.ts:119` `SLEEP: 0x00200000` (`CHS_SLEEPING`)
4. ~~`BANK_DEPOSIT`/`BANK_WITHDRAW` have no replayer~~ — **fixed 2026-08-02** (§16); five delta types converted to absolute rows, `BANK_SLOT`/`BANK_GOLD`/`PK_KILL` replayers added, coverage now test-guarded
5. ~~Duel does not bypass the PK-consent gate~~ — **fixed** `combat.policy.ts:61-62` duel branch (`m_nDuel===1 && m_idDuelTarget===target`)
6. Flee + self-heal AI are fully coded — **flee fixed, heal-cadence PARTIAL** (re-verified 2026-08-04): `spawn.manager.ts:204-205,365-366` now pass `fleeHpPct`/`runawayDelay` and the flee branch fires (test `ai.system.test.ts:574`); only `healCadenceMs` is still unthreaded — `converters/movers.ts:223-224` emits no cadence field and `mover.ts:420` defaults to 1000 ms
7. ~~`dwReAttackDelay` reads propMover col 34 instead of col 35~~ — **fixed** `converters/movers.ts:177` reads `dwReAttackDelay` (col 35)
8. ~~Blocklist `setBlocked` has no calling opcode~~ — **fixed** `social/handlers/friend.handler.ts:157` → `friend.service.ts:305`
9. ~~Movement is not stun-gated~~ — **fixed** `movement.service.ts:92,111,123,145,165,181` all check `isStunned()`
10. `IK3_TEXT_DISGUISE` aggro check — **STILL BROKEN** (re-verified 2026-08-04): `combat/systems/ai.system.ts:460-462` `isHidden()` tests only `MODE.TRANSPARENT`, no buff check (the "when buffs ship" precondition was met long ago)
11. ~~USESKILL cast-range validation~~ — **fixed 2026-08-04** (§2): reads the base `attackRange` AR_* enum via `getAttackRange`, not the per-level AoE `skillRange`

---

## Re-verification changelog (2026-08-04)

Spot re-verify of 10 claims in §1-2 and the fix-first shortlist against live
code (one read-only explorer, file:line evidence per verdict), plus the
cast-range fix landed the same day.

**Upgrades ❌/🟡 → ✅ (3):**
- **Cast-range validation** ❌→✅ (§2). Ported `CMover::GetAttackRange`
  (`MoverMsg.cpp:140-166`) as `entities/constants/attackRange.ts`; gate at
  `skill.service.ts:326-340`. Note the intermediate bug: `812bf3f` gated on the
  per-level `skillRange`, which is the **AoE radius** (`Ctrl.cpp:268/432/752`),
  not cast reach — Heal was capped at 6 m instead of AR_WAND's 15 m. Both fields
  are now documented in `skill.schema.ts` to stop the confusion recurring.
- **Debuff proc roll** 🟡→✅ (§1). The `effectProc` roll from
  `skillFormulas.ts:321` is enforced at `skill.service.ts:376`; fixed in
  `812bf3f`, the checklist was stale.
- **Flee / low-HP retreat** 🟡→✅ (§1). `spawn.manager.ts:204-205,365-366` pass
  `fleeHpPct`/`runawayDelay`; branch fires, test-covered at
  `ai.system.test.ts:574`.

**Confirmed still open (7):** AoE skills (🟥 — no runtime `skillRange`/
`spellRegion` consumer; needs the `ApplySkillRegion`/`Around`/`Line` ports);
projectile skills (🟥 — ranged auto-attack's projectile is client-visual only);
DoT death granting no MOVERDEATH/exp/drops on monsters and never firing
`onPlayerDeath` on players (🟡, both halves); `partyQuery` unwired
(`compose.ts:396-428`); `IK3_TEXT_DISGUISE` aggro check MODE-only
(`ai.system.ts:460-462`); `healCadenceMs` unthreaded from the converter;
`MAGIC_ATTACK` declared-but-undispatched (`clientServer.ts:167-168` registers
only MELEE/RANGE).

**Counts corrected:** `ponytail:` markers 187/79 files → **157 across 82 files**
(the earlier number predated the world-server carve-out). Tally adjusted
✅ 123→127, 🟡 48→45, ❌ 23→22.

**Nothing in this changelog is user-confirmed.** All three upgrades pass local
build + tests only; the override rule stands.

---

## Re-verification changelog (2026-08-03)

Targeted re-audit (4 parallel read-only explorers) — opcode gap, unstarted
systems, slash commands, and re-verify of the 10-item fix-first shortlist.
Covered ~5 commits past the 2026-08-01 baseline `c9ae378`, incl. ranged-bow
bugfixes (`9a76c40`).

**Fix-first shortlist: 7/10 fixed** since 08-01. Fixed: shopCostRate,
CHRSTATE_BITS.SLEEP, duel/PK gate, dwReAttackDelay column, blocklist setBlocked,
movement stun-gate, USESKILL cast-range. Partial: flee/heal AI (missing
`healCadenceMs`). Still broken: `partyQuery` unwired, `IK3_TEXT_DISGUISE` aggro
MODE-only.

**Three new sections added (23-25):**
- §23 C→S opcode gap — ~228 C++ opcodes vs 101 routed (~167 missed). 5
  declared-but-undispatched (`MAGIC_ATTACK` + 4 Couple); ~162 undeclared.
- §24 Unstarted feature systems — ~25 entirely-absent systems never previously
  tracked (Lord, Honor, Colosseum, Secret Room, Rainbow Race, MiniGames, Quiz,
  Fishing, Auction, Wanted-list, Ultimate Weapon, Collecting, Rangda, Tax,
  Funny Coin, Event/Live-ops, Instance Dungeon, Housing, Pocket, BeautyShop).
- §25 Slash commands — 3/25 player commands ported; ~35 GM ported, ~60 missing.

**Newly identified gaps (not on prior checklists):** `MAGIC_ATTACK` opcode
declared-but-undispatched (the last combat path); the Couple protocol stub
(opcodes + snapshots declared, undispatched); the Tax system as the upstream of
every shop cost; Instance Dungeon blocking scenario quests; the Event system as
the core live-ops tool; `MELEE_ATTACK2`/`SFX_*`/`TELESKILL`/`RETURNSCROLL`/
`RESURRECTION_OK`/`CANCEL`/`STATEMODE`/`MODIFYMODE`/`TELEPORTER` core holes;
`MMI_BEAUTYSHOP*`/`MMI_LOOKCHANGE` constants parse to undefined in
`characterInc.loader.ts`.

**`MOVEBANKITEM` caveat flagged:** opcodes.ts comment claims it is an
unregistered C++ stub, but `DPSrvr.cpp:169` registers `OnMoveBankItem` —
re-check handler body before trusting either claim.

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

