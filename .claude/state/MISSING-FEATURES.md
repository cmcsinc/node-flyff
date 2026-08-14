# Flyff v19 — Missing Features Checklist

> **Fidelity audit (2026-07-27):** All 64 TS↔C++ behavioral deviations found in
> the C++ fidelity audit (`docs/c++-fidelity-audit.md`) have been resolved. This
> checklist covers features not yet ported at all (wider scope).

Generated 2026-07-23 from a full-source sweep (3 parallel domain maps + every
`ponytail:` comment). Re-verified 2026-07-24 (57 items), **re-verified 2026-08-01**
against master `c9ae378` (136 commits later) by 4 parallel read-only explorers
over 16 sections, **targeted re-audit 2026-08-03** (4 parallel explorers —
opcode gap, unstarted systems, slash commands, fix-first shortlist re-verify)
which added §23-25, **spot re-verify 2026-08-04** of 10 §1-2 / shortlist
claims against live code, and **spot re-verify 2026-08-05** against master
`b54ee36` (38 entries sampled across all 25 sections), and **full re-verify
2026-08-12** against master `646d159` (14 commits later) by 4 parallel read-only
explorers — which added §26 GUILD and §27 PETS and recounted §23-25. Compares
the emulator against full retail v19.

**Status legend**
- ✅ DONE — implemented + passing on this device's checks (NOT user-confirmed)
- 🟡 PARTIAL — core path works, sub-features/edge-cases stubbed
- 🟥 STUB — code exists but does nothing meaningful (charge consumed, no effect)
- ❌ MISSING — no code path at all

**Override rule:** ✅ here = "passes my checks", never "fixed". Only the user
declares a feature fixed by testing on a real v19 client.

**Companion signal:** there are **179 `ponytail:` markers across 94 files**
(re-counted 2026-08-12) — a denser, line-level gap inventory than this
checklist. When a line here says PARTIAL, the ponytail at the cited file:line
usually names exactly what is missing. `grep -rn "ponytail:" packages/*/src` is
the authoritative sweep.

**Tally at this refresh** (27 sections). Sections 1-22 carry
✅ 145 · 🟡 40 · ❌ 21 · 🟥 6 · 🚫 2 — the 2026-08-05 mechanical count adjusted for
three 2026-08-12 status changes: §1 arrow/ammo 🚫→✅ (`AmmoService` exists), §15
guild ❌→✅ (moved to §26), §16 blocklist 🟡→✅ (`friend.service.ts:305
toggleBlock`, dispatched `clientServer.ts:291`). §23-25 add ~163 unrouted
opcodes + ~23 absent systems + 119 missing slash commands as cross-cutting
audits. **§26 GUILD** and **§27 PETS** (new 2026-08-12) are tracked outside the
1-22 tally.

---

## 1. COMBAT

### Melee
*All `formulas.ts` citations re-read from the file 2026-08-12; the previous set
pointed at pre-refactor lines. Path is `combat/src/combat/formulas.ts`.*
- [x] ✅ Hit-rate roll (player→NPC, NPC→player, PvP branches) — `combat/formulas.ts:238 getAttackResult` (helpers `getHR:171`, `getAdjHitRate:183`)
- [x] ✅ Crit (flat 2.3×) + DST_CHR_CHANCECRITICAL — `formulas.ts:194 getCriticalProb`, applied `:355`
- [x] ✅ Block factor (NPC + player defender) — `formulas.ts:400 getBlockFactor`, parry `:188`
- [x] ✅ DEF subtract, element factor, level-diff falloff — `formulas.ts:261 calcDefense`, element `:348`, level-diff `:310 getDamageMultiplier`
- [x] ✅ ATK from weapon + DST_CHR_DMG/ATKPOWER/ATKPOWER_RATE + refine — `formulas.ts:100 getWeaponATK` + `:134 getHitMinMax`, refine via `:122 getPlusWeaponATK`
- [x] ✅ Equip→stat projection — element string→enum, refine→option decode, jewelry HR/ER, atkSpeed — `combat/equipStats.ts`
- [x] ✅ Targeting policy — `MI_CHAOGUARDIAN` inverse (`m_bChaoGuard`) + `RANK_GUARD` — `combat.policy.ts`. Flying-mismatch reject now lives here too (first branch of `isPlayerAttackableBy`), since `FlightService` shipped — see §13
- [x] ✅ NPC→player min-damage floor (10% of ATK) — `formulas.ts:385-388`
- [x] ✅ NPC→player swings read the defender's **gear** — the monster attack path
  resolves equipped items so armour DEF and `DST_ADJ_HITRATE`/`DST_ADJ_PARRY`
  reach the roll — `combat/systems/ai.system.ts:288` (`501b21c`). The old "drops
  `getItem`, gear never read" note is retired
- [ ] 🟡 Unmodelled melee terms — new row 2026-08-12, each a live ponytail:
  rare weapon types (staff/wand/stick) have no DST mapping in `getWeaponATK`
  (`formulas.ts:116`); item expiry-flag + durability are not checked when reading
  weapon ATK (`:152`); `m_fDefence_Rate` (NPC server-config defence multiplier)
  and armour-penetrate skills are absent from `calcDefense` (`:291`); the monster
  **rank** exemption in the level-diff falloff is stubbed pending monster ranks
  (`:305`); `DST_BLOCK_RANGE` / `DST_BLOCK_MELEE` are unread because the
  range-attack flag never reaches `Combatant` (`:420`)

### Ranged / bow
- [x] ✅ Bow damage curve (STR/DEX) — `formulas.ts:112` (`WT_RANGE_BOW` branch of `getWeaponATK`)
- [x] ✅ NPC ranged attack (RANGE_ATTACK emit, re-attack delay) — `ai.system.ts:222`
- [x] ✅ Player ranged auto-attack as a distinct path — `rangeAttack.handler.ts`, `rangeAttack.service.ts`
- [x] ✅ Ammo / arrow consumption — shipped. `AmmoService` (`inventory/src/services/ammo.service.ts`)
  wired at `compose.ts:432,1007`; `rangeAttack.service.ts` gates the swing on
  `hasArrow` and burns via `arrowDown`, rejecting `'no_arrow'` (port of
  `_Common/Mover.cpp:8690`). The old "N/A by design, v19 bows are ammo-less"
  note was wrong and is retired
- [ ] 🟡 Ammo gate on **skill** casts — new row 2026-08-12. `AmmoService` covers only
  the auto-attack path; `skills/skill.service.ts` takes no `hasArrow`/`arrowDown`
  dependency at all, so a bow/yoyo skill fires with an empty quiver.
  `TID_TIP_NEEDSKILLITEM = 2400` is exported at
  `inventory/src/services/ammo.service.ts:44` and read by **no** call site — the
  constant was added for this gate and never wired

### Magic / skill damage
- [x] ✅ Single-target skill damage (melee + magic, element, magic-factor) — `skillFormulas.ts:268` `resolveSkillCast`
- [x] 🚫 Skill crit — **the old line was semantically wrong and is retired**: skills *never* crit in v19 by design (`MoverAttack.cpp:800` `if (IsSkillAttack(dwAtkFlags)) return FALSE`). The TS states this explicitly at `skillFormulas.ts:294`. Nothing to implement
- [x] ✅ Debuff/secondary-effect **application** — damage-skill tail calls `applyBuffToMover` on the target — `skills/skill.service.ts:382` (pure-debuff branch) and `:391` (damage+debuff tail); cites re-read 2026-08-12
- [x] ✅ Debuff proc roll **is** enforced — the gate reads the rolled
  `effectProc` from `skillFormulas.ts:321` (`prob === undefined || rng.int(100) <
  prob`), surfaced via `combat.service.ts:330,357` and consumed at
  `skill.service.ts:389` (`&& outcome.effectProc !== false`; cites re-read
  2026-08-12). A debuff whose
  `nProbability` roll failed no longer lands. Fixed in `812bf3f`
- [ ] 🟥 AoE (area skills) — no runtime consumer of `skillRange`/`spellRegion` in
  `combat/` or `skills/`. Re-verified 2026-08-04: the only hits are a comment
  (`skill.service.ts:329`), an admin field label, YAML data, and a test asserting
  `skillRange` is *deliberately* ignored by the cast-range gate
  (`skill.service.test.ts:422`). Needs `ApplySkillRegion`/`Around`/`Line` ports
  (`_Common/Ctrl.cpp:255,420,1675`) — `skillRange` is their radius input
- [x] ✅ DoT (damage-over-time) — `entities/params/BuffManager.ts:222 tickDots`, `world-server/systems/buff.system.ts:59` (players), `ai.system.ts:139` (monsters); seeded via `dotFromSkill()` `skill.service.ts:802`. Cites re-read 2026-08-12
- [ ] 🟡 **DoT death is not a real death** — re-verified 2026-08-12, both halves
  still true. Monster DoT death sets `m_bDead` and `continue`s with no MOVERDEATH
  broadcast, no exp, no drops (`ai.system.ts:144-147`, ponytail at `:137`). Player
  DoT death subtracts HP and sends only SETPOINTPARAM DST_HP — no DAMAGE
  snapshot, no killer attribution, never triggers `onPlayerDeath`
  (`buff.system.ts:67-77`, ponytail at `:75`)
- [x] ✅ Multi-hit skills (`nSkillCount` chain: N rolls + N DAMAGE snapshots, stops on death) — `combat.service.ts:234-262` (`hits`/`hitDivisor` loop, PvP branch `:242`, PvE `:254`); cite re-read 2026-08-12
- [ ] 🟥 Projectile skills — no server-side projectile path in `combat/` or
  `skills/` (re-verified 2026-08-04: only ponytail comments at
  `skillFormulas.ts:10,264`, `skill.service.ts:178`). Ranged auto-attack ships,
  but its projectile is client-side visual only — no flight time, no travel
  interception (`rangeAttack.service.ts:14`)
- [x] ✅ Heal skills (RT_HEAL → DST_HP restore, self/other target) — `skill.service.ts` `applyHeal`
- [x] ✅ Buff skills — **UPGRADE 🟥→✅**: `effectKind` returns `'buff'` on `RT_TIME` in `referTargets[0|1]` (`skill.service.ts:419`), effects built data-driven by `buffEffects()` (`:775`). The old `dwDestParam=0` special-case is gone. Cites re-read 2026-08-12
- [x] ✅ PvP + PvE skill damage vars (PvP 0.60 + NPC level-diff cosine) — `skillFormulas.ts:310`
- [ ] 🟡 Unmodelled skill-damage terms — new row 2026-08-12, each a live ponytail:
  `ST_*` resource element values have no shared conversion table to the 1..5
  internal index, so only fire/water/electric/wind/earth resolve
  (`skillFormulas.ts:37-38`); the `DST_MASTRY_<elem>` element-mastery table is
  reduced to a flat `DST_ADDMAGIC` add because skills do not carry element+level
  (`:140`); non-`RT_DAMAGE` refer types fall back to a flat
  `dwReferValue*skillLvl` curve (`:100`); and the `GetATKMultiplier` PvP/`SM_*`
  mode adjustments are skipped inside the skill path (`:288`) even though the
  shared `getDamageMultiplier` tail applies the 0.60 PvP factor

---

## 2. SKILLS

*All §2 citations re-read 2026-08-12; the previous set predated the queue/combo
refactor.*

- [x] ✅ USESKILL cast handler — `skills/handlers/useSkill.handler.ts`
- [x] ✅ DOUSESKILLPOINT learn handler — `skills/handlers/doUseSkillPoint.handler.ts`
- [x] ✅ Cooldowns (`m_tmReUseDelay[45]`) — read `skill.service.ts:312`, written `:365-366`
- [x] ✅ Skill learning (SP spend, tier cost, prereqs, no-decrease) — `skill.service.ts:657 learnSkills`
- [x] ✅ Skill points granted on level-up — `combat.service.ts:285`
- [x] ✅ MP/FP consume on cast (routed by KT; gated before spend) — `skill.service.ts:432 resourceNeed`, `:442 spendResource`
- [x] ✅ Damage + heal + **buff** cast — `effectKind` routes all three (`skill.service.ts:419`). AoE still missing (§1); auto-attack-type skills return `'unsupported'`
- [x] ✅ Job-match gate on learn (isJobMatch lineage) — `entities/tables/jobLineage.ts`, gated `skill.service.ts:690`
- [x] ✅ WAL `SKILL_LEARN` journal type + replayer — `skill.service.ts:711`, `journalReplayers.ts:98`
- [x] ✅ Action-slot / skill-queue combo progression — server-driven `SetNextSkill` + tick-spaced advance + `ENDSKILLQUEUE` on exhaust — `skill.service.ts:229 scheduleQueueStep`, `:259 advanceQueue`, `:283 endQueue`
- [x] ✅ NPC buff casting with conflict table — `skill.service.ts:543 applyNpcBuff`, `NPC_BUFF_CONFLICT:67`
- [ ] ❌ `RT_TIME` stat-scaling bonus (`SubReferTime`) on buff magnitude — ponytail `skill.service.ts:620`; buff values are flat, unscaled by caster stats
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

*All §3 citations re-read 2026-08-12 against `BuffManager.ts` / `buff.system.ts`
/ `join.service.ts` / `revival.service.ts` / `useItem.service.ts` at HEAD.*

- [x] ✅ Buff container + expiry (BuffManager over ParamModel + 1s BuffSystem sweep + SETSKILLSTATE/REMOVESKILLINFULENCE) — `entities/params/BuffManager.ts:118 addSkillBuff`, `:191 remove`, `:203 tick`, `:240 clear`, `world-server/systems/buff.system.ts`
- [x] ✅ Skill buff apply/expire (RT_TIME → applyBuff; refresh/replace/ignore, 28-cap, per-effect SETDESTPARAM sync) — `skill.service.ts:593 applyBuffToPlayer` / `:632 applyBuffToMover`, `BuffManager.ts:118` (refresh/ignore/upgrade branches `:128-138`, cap eviction `:139`)
- [x] ✅ Buff clear on death (clear + REMOVESKILLINFULENCE + RESETDESTPARAM per buff) — `revival.service.ts:96-107`, `buff.system.ts:79 onExpired`
- [x] ✅ Buff persistence across relog — `join.service.ts:433 loadBuffs` / `:482 collectPersistedBuffs` (save at `:350`) + `character_buffs` (migrations 015/016/018, absolute `expiresAtMs`)
- [x] ✅ Stun/sleep gate type fix — `entities/src/constants/dst.ts:121` now carries
  `SLEEP: 0x00200000` (`CHS_SLEEPING`) and `player.ts:676` masks
  `CHRSTATE_BITS.STUN | CHRSTATE_BITS.SLEEP`, so sleep gates as well as stun.
  Re-verified 2026-08-05; the old `8 | undefined` row is retired
- [x] ✅ Stun gate coverage on movement — all 6 move paths check `m_bDead` **then**
  `isStunned()` — `world-server/services/movement.service.ts:100,119,131,153,173,189`.
  Re-verified 2026-08-05
- [x] ✅ Poison DoT tick system — `BuffManager.ts:222 tickDots`, `buff.system.ts:67 onDots`, `ai.system.ts:139` (see the DoT-death caveat in §1)
- [x] ✅ Buff-grant consumable items (IK2_BUFF/IK2_BUFF2 → addItemBuff + SETSKILLSTATE + SETDESTPARAM) — `inventory/services/useItem.service.ts:149`, `BuffManager.ts:163 addItemBuff`
- [x] ✅ Peer buff list on the wire — `writeEmptyBuffs` deleted in `1c39895`;
  `writeBuffs(w, p, nowMs)` writes count then per-buff WORD type / WORD id /
  DWORD level / DWORD remaining-ms, used by **both** `writeMoverSerialize` and
  `writeMoverExcludeItem` — `world-server/net/snapshot/mover.serializer.ts:75-83`.
  Other players now show buff icons on first sight, not only on the next
  SETSKILLSTATE
- [ ] 🟥 `IK3_TEXT_DISGUISE` buff check in AI aggro — `combat/systems/ai.system.ts:469-471 isHidden()` still tests only `MODE.TRANSPARENT`. The ponytail said "when buffs ship" — **buffs have shipped, so this is now actionable**
- [ ] 🟡 Monster debuff icons never clear — `applyBuffToMover` broadcasts SETSKILLSTATE but `ai.system.ts:122` deliberately skips REMOVESKILLINFULENCE for movers, so a debuff icon appears on a monster and stays forever

---

## 4. MONSTER AI

*All §4 citations re-read 2026-08-13 against `ai.system.ts` (474 lines) /
`spawn.manager.ts` / `entities/mover.ts` / `mover.schema.ts` at HEAD. Two rows
were wrong and are corrected below; one duplicate row is dropped.*

- [x] ✅ FSM idle/wander/aggro(RAGE)/pursue/return-home — `ai.system.ts:160 idleOrAcquire`, `:184 acquireBySight`, `:203 wander`, `:221 pursue`, `:335 acquire`, `:347 startReturn`, `:393 stepReturnHome`
- [x] ✅ Leashing (RAGE_LEASH 150m + damage-pos 120m) — `ai.system.ts:267-270` (both bounds in one gate)
- [x] ✅ Retaliation on hit (triggerRage) — `combat.service.ts:327` (call site), impl `:440 triggerRage` *(cite corrected 2026-08-13; the old `:353` is not the call)*
- [x] ✅ Spawn + respawn timers (static NPC never respawns) — `world-core/managers/spawn.manager.ts`
- [ ] 🟡 Aggro — single-slot target (`m_idTarget`) — `entities/mover.ts:334`; `m_idEnemies` (`:358`) tallies hit-share for exp only, never target selection. No aggro table *(both cites corrected 2026-08-13 — `:320` is `isStunned`, `:344` is `m_vDestPos`)*
- [x] ✅ Flee / low-HP retreat — **code ✅, data ✅ (re-verified 2026-08-13).**
  Gate `ai.system.ts:225-234` (threshold + live-target check → `startFlee`),
  `:356 startFlee` (50 m, `FLEE_SPEED_FACTOR`, `m_tmRunawayEnd`), `:380 stepFlee`
  (clears `m_bRunaway` at `:385`), driven from the tick at `:151`;
  `spawn.manager.ts:208-209,369-370` pass `fleeHpPct`/`runawayDelay`, assigned
  `mover.ts:416-417`, data present via `converters/movers.ts:100,221`.
  Test-covered at `ai.system.test.ts:574`. Monsters with no `SetRunAway` never
  flee — faithful
- [x] ✅ Ranged monster AI (holds at range, RANGE_ATTACK, re-attack cadence) — hold-at-range at `ai.system.ts:274-279` (steps only while `dist > m_nAttackRange`), cadence branch `:282 m_bRangeAttack ? RANGE_REATTACK_DELAY_MS`, animation pick `:295`
- [ ] 🟡 Healer monster AI — **self-heal code ✅, cadence data ❌, ally-heal ❌.**
  Re-verified 2026-08-13: `spawn.manager.ts:210-213,371-374` pass
  `healHpPct`/`healAmount` (the amount derived as `healPct * hp`), so the
  self-heal branch at `ai.system.ts:259-265` fires inside `pursue` — healers stay
  in combat, unlike fleers, and there is deliberately no S→C broadcast. What
  remains is (a) `healCadenceMs` — **zero occurrences** in either
  `mover.schema.ts` or `converters/movers.ts`, so `mover.ts:420` always resolves
  the 1000 ms default, and (b) healing *other* monsters, entirely absent. Source
  is `propMoverEx.inc` `Recovery 10 50 100 m`, whose 3rd/4th columns are dropped
  by the converter (`converters/movers.ts:90` reads only `nums[1]`)
- [ ] ❌ Flight-capable monster AI — `flyable` reaches the entity (`spawn.manager.ts:197,358` → `mover.ts:402 m_bFlyable`) but **nothing in `ai.system.ts` reads `m_bFlyable`**, so a flying mob pursues along the ground plane
- [ ] ❌ Collision-aware stuck-teleport — return-home has a 20 s time cap only, no pathing: `ai.system.ts:394-395` snaps to `m_vPosBegin` on either arrival OR `RETURN_STUCK_MS`. The HP restore on arrival **is** ported (`m_nHitPoint = m_nMaxHitPoint` `:408` + `m_idEnemies.clear()` `:414`), faithful to `DoReturnToBegin(FALSE)` (`AIMonster.cpp:305-306`); only the optional DEL_OBJ/ADD_OBJ re-broadcast that would resync the client's stale HP bar is missing (ponytail `:407`). *The separate "return-home HP restore deviation" row that used to sit below this one was a duplicate of this same ponytail and is dropped 2026-08-13*
- [x] ✅ Per-mover `dwReAttackDelay` — `re_attack_delay` in the schema (`resources/schemas/mover.schema.ts:140`), emitted from `dwReAttackDelay` (`resources/scripts/converters/movers.ts:177`), preferred over `attack_speed` at `spawn.manager.ts:207,368`, present in data (`resources/data/movers/monsters.yml:20`), consumed `entities/mover.ts:415` → `ai.system.ts:283`
- [ ] 🟥 `IK3_TEXT_DISGUISE` aggro check — the sight filter (`ai.system.ts:186`) and
  both pursue drop-gates (`:231`, `:236`) all route through `isHidden()`
  (`:472`), which tests **only** `MODE.TRANSPARENT`; the disguise buff is
  ponytail'd at `:470` with "when buffs ship" — and buffs have shipped, so this
  is actionable (same gap as the §3 row, recorded here because the three call
  sites are AI-side)
- [ ] 🟡 Monster debuff icons never clear — `ai.system.ts:132` deliberately skips
  REMOVESKILLINFULENCE for movers (ponytail), so a SETSKILLSTATE icon applied to
  a monster stays until it despawns
- [ ] 🟡 DoT on movers cannot credit a killer — the mover DoT tick
  (`ai.system.ts:137-147`) is ponytail'd at `:137` as lacking the DAMAGE snapshot
  and killer attribution, so a poison kill lands without a normal death round-trip

---

## 5. PARTY / EXP-SHARE

Shipped 2026-07-30 → 08-01 as `@flyff/party` (solo-party MVP). **Parties are
now durable** across restarts — migration `022_parties.ts` + `party.repo.ts`,
hydrated at boot (`party/managers/party.manager.ts:189-213`, persist calls
`:249,267,287,290,311,343`), landed in `b3c4e41`. This is an emulator-side
divergence from C++, which keeps party state on the Core server, not in the DB.

*All §5 line numbers re-verified 2026-08-12 against `party.service.ts` /
`party.manager.ts` at HEAD; **every citation in this section was stale** and has
been replaced with a method-declaration line read directly from the file.*

- [x] ✅ Party invite / accept / decline / leave / kick — `party/services/party.service.ts:121,157,177,193` (`invite`/`accept`/`decline`/`leaveOrKick`), handlers `party/handlers/party.handler.ts:52,73,94,109`, dispatch `world-server/clientServer.ts:167-170`
- [x] ✅ Party member-list snapshot (`PARTYMEMBER` 0x0082 + `CParty::Serialize`) — `world-core/serializers/party.serializer.ts:151`
- [x] ✅ Party EXP sharing — `party.service.ts:462` `distributeExp` (64 m proximity, 20-level band, 0.2/member bonus); hit-share pooling over `m_idEnemies` at `combat/services/combat.service.ts:423-473`. **`m_idEnemies` is now consumed, not dead**
- [x] ✅ Party loot-share + FFA timeout — `inventory/services/loot.service.ts:301-304` (`IsLoot` + `sameParty` seam `:86` + `LOOT_FFA_MS`), receiver pick `party.service.ts:585 pickItemReceiver` *(cite corrected 2026-08-12; the file is 313 lines, so the old `:350-358` could not exist)*
- [ ] 🟡 ACTMSG (manual click-to-loot) path skips the share rules — the auto-loot
  arrival path enforces `IsLoot`, but the ACTMSG handler has no same-`m_idparty`
  share, no invalid-owner FFA (C++ `MoverActEvent.cpp:2206-2211`), and swallows
  bag-full with no `TID_GAME_LACKSPACE` notice — ponytails
  `inventory/handlers/actMsg.handler.ts:20,108,132` (row added 2026-08-12)
- [x] ✅ Item-share modes (0 finder / 1 sequential / 2 leader / 3 random) — `party.service.ts:269 changeItemMode`, `:585`, 32 m `PARTY_ITEM_PROXIMITY`
- [x] ✅ Gold split (mode-independent; floor + remainder to one random member) — `party.service.ts:636 splitGold`
- [x] ✅ CHANGETROUP "advance party" (`m_nKindTroup=1` + name) — `party.service.ts:291 changeTroup`
- [x] ✅ Loot-received notice to peers — `party.service.ts:681 itemNoticePeers`, consumed `loot.service.ts:303`
- [x] ✅ SETNAVIPOINT party navigator ping — `party.service.ts:325 naviPoint`
- [x] ✅ Disconnect teardown (auto-promote leader, disband under 2) — `party.service.ts:357 onDisconnect`
- [x] ✅ Party chat via the `PARTYCHAT` opcode (0xffffff59) — `party.service.ts:306 chat`, dispatch `clientServer.ts:176`
- [ ] ❌ `/p` slash alias for party chat (the opcode path works; only the `/cmd` alias is absent) — `world-server/services/command.service.ts:37`
- [x] ✅ Party persistence across restart — `022_parties.ts`, `database/repositories/party.repo.ts`, `party.manager.ts:176 constructor(repo?)` + `:189-213 hydrate` (`b3c4e41`)
- [x] ✅ Party level / exp bar — `party.manager.ts:77-79,103,376-379` (`e88927f`)
- [ ] 🟡 Contribution exp mode — the `m_nTroupsShareExp` toggle is stored + echoed (`party.service.ts:252 changeExpMode`) but the contribution split itself is ponytail'd — `party.service.ts:457`
- [ ] ❌ Leader transfer is present, not missing — `party.service.ts:233 changeLeader` (row added 2026-08-12; the method had no checklist line)
- [ ] ❌ Party-chat mute check — ponytail at `party.service.ts:305`; needs the mute/freeze pipeline from §25
- [ ] ❌ `bSuperLeader` exp x2 (`II_SYS_SYS_SCR_SUPERLEADERPARTY` buff) — ponytail `party.manager.ts:393`
- [ ] ❌ Guild-party — party skills, party finder, party-duel (`m_idDuelParty`) — ponytail `party.service.ts:15`, `party.manager.ts:28`

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
- [x] ✅ Duel bypasses the PK-consent gate — `combat/services/combat.policy.ts` `isPlayerAttackableBy`: fly-mismatch reject first, then the duel override (`attacker.m_nDuel === 1 && attacker.m_idDuelTarget === target.m_idPlayer`, plus the mirror), then the mutual `m_bPKMode` gate. Re-verified 2026-08-05; the old "duel damage cannot land" row is retired
- [ ] 🟡 Duel disconnect clears only **pending** proposals — `DuelManager.onDisconnect` (`combat/managers/duel.manager.ts:60`) drops a pending request either way round, but does not clear ACTIVE duel flags through the service, so `m_nDuel`/`m_idDuelTarget` can survive a mid-duel drop — ponytail `duel.manager.ts:58`; ACTIVE state deliberately lives on the players, not the manager (`:9`) (row added 2026-08-12)
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

*All §7 citations re-read 2026-08-12 against `revival.service.ts` /
`combat.service.ts` / `exp.ts` at HEAD.*

- [x] ✅ Monster death (MOVERDEATH, exp, drops, quest, remove) — `combat.service.ts:392` (victim hand-off), NPC fast-path `:458 OnDied`
- [x] ✅ Player death (dead flag, MOVERDEATH, ACTMSG STOP+DIE) — `revival.service.ts:89 onPlayerDeath`
- [x] ✅ Revival (scroll in-place, lodestar town + exp penalty) — `revival.service.ts:122 revive`, `:131 reviveScroll`, `:160 reviveLodestar`
- [x] ✅ Buff clear on death (REMOVESKILLINFLUENCE + RESETDESTPARAM per buff) — `revival.service.ts:96-107`
- [x] ✅ Chaotic/PK revive HP rate (`REVIVE_HP_RATE` 0.2 / `_CHAOTIC` 0.1) — `revival.service.ts:208 restoreVitals`
- [ ] 🟡 Other-player resurrection skill (45 `SI_ASS_HEAL_RESURRECTION`) — **implemented, not yet user-tested.** Cast stamps the offer on the dead target + prompts (`skills/services/skill.service.ts:511 resolveResurrectionTarget`, `:546 offerResurrection`); accept/cancel revive in place with the caster-INT DST_HP grant + `nAdjParamVal2`-scaled exp penalty (`revival.service.ts:278 acceptResurrection`, `:256 cancelResurrection`); `RESURRECTION_OK`/`RESURRECTION_CANCEL` dispatched (`clientServer.ts:169-171`). Ponytails: `nProbability` roll, 35 s second-offer suppression, guild-war/school refusals, caster overheal credit
- [ ] ❌ DiePenalty.inc real table loader — hardcoded brackets; **no loader exists** (11 loaders in `resources/src/loaders`, none for penalty) and no data file — `entities/math/exp.ts:135` (ponytail), penalty fn `:138 subDieDecExp`
- [ ] ❌ `SM_REVIVAL` penalty modifiers — chaotic 0.9× and non-chaotic zero-penalty branches are both ponytails (`exp.ts:132-133,152`); no SM tracking exists (row added 2026-08-12)

- [ ] 🟡 5s dead lockout (`m_nDead`) — movement lockout done: all 4 move paths early-return `reason:'dead'`; attack + cast gated on the same flag — `world-core/services/movement.service.ts`. Remaining: the real `m_nDead` 5 s countdown (today `m_bDead` clears only on explicit revive — `revival.service.ts:198 clearDeadState`, ponytail `:200`)
- [ ] ❌ Cross-world revive REPLACE teleport snapshot — `teleportToRevival` is SETPOS-only, and `GetNearRevivalPos` nearest-point tables are unported (zone default only) — ponytail `revival.service.ts:225-226`, impl `:228`
- [ ] ❌ Guild-war revive — full HP + no scroll consume; ponytail `revival.service.ts:20`

---

## 8. INVENTORY / ITEMS

*All §8 citations re-read 2026-08-12 against `inventory.service.ts` /
`equip.service.ts` / `useItem.service.ts` / `equipStats.ts` / `formulas.ts` at
HEAD.*

- [x] ✅ Add/stack/remove/move (swap)/consume/drop — `inventory.service.ts`
- [x] ✅ Gold spend/add/drop (MAX_GOLD clamp) — `inventory.service.ts:295 spendGold`, `:307 addGold` (clamp `:310`)
- [x] ✅ Equip/unequip (server-authoritative slot, swap, level_req) — `equip.service.ts`
- [x] ✅ DST stat-bonus apply/remove on equip/unequip — `equip.service.ts:279` (removeEffects), apply path in the same service
- [x] ✅ **Set-item bonuses** — **UPGRADE ❌→✅**: `recomputeSetBonuses` full-recompute over `MAX_HUMAN_PARTS` with an `avails[].equipped` threshold walk, `m_setEffects` diffed through `m_params.applyEffects/removeEffects` — exported fn `equip.service.ts:86`, method `:290`, called on equip `:204` / unequip `:237`, seeded on login `join.service.ts:228`. The old "field exists, no logic" claim was stale
- [x] ✅ Potion / food consumables — `useItem.service.ts:125` (`IK2_POTION`/`IK2_FOOD`)
- [x] ✅ Blinkwing teleport scrolls — `inventory/services/blinkwing.service.ts` (259 lines, `12eb53b`): two-pass channel (arm, then complete), 10 s blinkwing / 300 s Return, `IK3_BLINKWING` fixed destination, `IK3_TOWNBLINKWING` to the zone revival point, cancel on move/damage. Paired `blinkwing.system.ts`, `stateMode.handler.ts`, `stateMode.serializer.ts`. Cross-world destinations are refused — no REPLACE re-send exists (§12)
- [x] ✅ DOUSEITEM routing — `useItem.service.ts:102` dispatches `IK3_PET` (requires `link_kind`) and `:116` `IK2_BLINKWING` alongside potion/food `:125`; `:138` handles the IK2_BUFF/BUFF2/SKILL/TEXT/WARP group (`891f68d`)
- [x] ✅ Double-click unequip — `inventory/handlers/doUseItem.handler.ts:104-108` routes an equipped item's DOUSEITEM through `buildDoEquipVicinity(..., !r.unequip, ...)` (`891f68d`)
- [x] ✅ Looter pet — `world-server/systems/pet.system.ts` (352 lines, `439c52f`): port of `AIPet.cpp` `DoUseEatPet`/`ActivateEatPet`/`InactivateEatPet`; states IDLE/TRACE/LOOT, `TICK_MS = 100`, `SCAN_INTERVAL_MS = 1072`, loot through `LootService.pickup(owner, pile)`. **This is the EatPet/looter only** — see the system-pet row below
- [ ] ❌ System pet (`IK3_EGG` → D-C-B-A-S levels) — the egg hatch, pet level/exp, feeding, naming, and release paths are all absent; `dwPetId` is still written as `NULL_ID` (`mover.serializer.ts:136`) and `SNAPSHOTTYPE_PET_*` stays unused. Distinct from the shipped looter pet above; `PET_RELEASE`/`USE_PET_FEED`/`MAKE_PET_FEED`/`CLEAR_PET_NAME` are not even declared (§23)
- [ ] 🟡 Buff-grant usable items — **UPGRADE 🟥→🟡**: `IK2_BUFF`/`IK2_BUFF2` → `addItemBuff` + vicinity SETSKILLSTATE + per-effect SETDESTPARAM (`useItem.service.ts:144-165`). Skill / warp / text items are still charge-only no-ops — ponytail `:166-167` (cites corrected 2026-08-12)
- [x] ✅ Jewelry HR/parry — `hit_rate`/`parry` summed `combat/equipStats.ts:106-107` (returned `:113`), consumed `formulas.ts:184 getAdjHitRate`, `:190 getParrying`
- [ ] ❌ Weight / overweight enforcement — `weight: z.number().int().min(0).default(1)` is parsed with **zero consumers** (grep hits only test fixtures) — `resources/schemas/item.schema.ts:143`
- [ ] ❌ **Durability decay** — *new line, was missing from this checklist.* Nothing anywhere decrements `slot.durability`, which makes the shipped `RepairService` unreachable in practice — a no-op economy sink — ponytail `combat/src/combat/formulas.ts:152-153`
- [ ] ❌ `IsUndestructable` / `IsUsing` drop-guard on REMOVEINVENITEM — right-click delete rejects only non-positive count, equipped slot, and short stack; the two item-flag gates (and the DEFINEDTEXT success text) are unported because propItem flags are not tracked — ponytail `inventory.service.ts:250-252`, impl `:254 removeItem` (row added 2026-08-12)
- [ ] ❌ Repair `dwCost` per-item multiplier — every item repairs at the same rate; the propItem column is not exposed on the item view — ponytail `inventory/services/repair.service.ts:17`, service `:54` (row added 2026-08-12)
- [ ] ❌ Blinkwing server-side cancel-on-attack — the client-side cancel path ships, but `CMover::IsAttackAble`'s server gate is unported, and the C++ consults the blink gate at **eight** sites of which this port covers a subset — ponytails `blinkwing.service.ts:28,43,120` (row added 2026-08-12)

### Item enhancement
- [x] ✅ Refine level storage + combat read + ACTION — storage, `UI_AO` echo, and combat read all live — `enchant.service.ts`, `equipStats.ts:106-113`, consumed `formulas.ts:154-160` (`GetItemMultiplier` + `pow(option,1.5)`)
- [ ] 🟡 Refine / upgrade scroll (`IK3_ENCHANT`) — `ItemUpgrade.lua` tGeneral roll, non-KOR ×0.9 at +3+, fail `<3` keep / `>=3` destroy. **No anvil-NPC action path** (player-driven scroll only) — `enchant.service.ts`
- [x] ✅ Enchant element card (`IK3_ELECARD`) — sets `m_bItemResist` + `m_nResistAbilityOption`, `UI_IR`+`UI_RAO` echo, 2nd-element reject — `enchant.service.ts`
- [ ] ❌ Element-card `eItemType` restriction — a card can be applied to any equip because the card's target-type column is never parsed by the converter — ponytail `inventory/upgrade/upgradeTables.ts:70` (row added 2026-08-12)
- [ ] ❌ Piercing / sockets — zero-placeholder writes only — `world-core/serializers/itemElemBody.serializer.ts:70-71`, `inventory/net/snapshot/itemSnapshot.serializer.ts:40,48`
- [x] ✅ Elements stored + combat-read + persisted + on wire — `012_item_element.ts`, `join.service.ts` load path, `itemElemBody.serializer.ts`

---

## 9. NPC / SHOP / BANK

*All §9 citations re-read 2026-08-12 against `shop.service.ts` /
`bank.service.ts` / `scriptDlg.service.ts` at HEAD.*

- [x] ✅ Shop open/close/buy/sell (gold-clamped, anti-cheat) — `shop.service.ts:64 open`, `:90 close`, `:108 buy`, `:149 sell`
- [x] ✅ Bank/warehouse open + pin + changepass (account-shared, 3 tabs) — `bank.service.ts:83 open`, `:102 confirmBankPass`, `:115 changeBankPass`
- [x] ✅ Bank item deposit/withdraw — `bank.service.ts:132 deposit`, `:165 withdraw`
- [x] ✅ Bank per-tab gold — **UPGRADE 🟡→✅**: `getGold/setGold` tab-indexed, wire `BYTE nSlot` honored, JOIN hydrates + checkpoint flushes all 3 pools — `bank.service.ts:204 depositGold`, `:225 withdrawGold`, `:238 persistGold`, `011_bank_per_tab_gold.ts`
- [ ] ❌ Bank-to-bank gold transfer — ponytail `bank.service.ts:16` (row added 2026-08-12)
- [x] ✅ NPC dialog `source:` bodies — **UPGRADE 🟡→✅ for the interpreter**: real recursive-descent evaluator with C++ int-truthiness, 19-method bindings / 13-method sink — `npc/services/dialogInterpreter.ts` (397 lines)
- [ ] 🟡 Dialog *bindings* completeness — the interpreter is real, and the **guild** predicates are now real lookups (`isGuild`/`isGuildMaster`/`isGuildQuest`/`guildQuestState` hit `GuildManager` — `scriptDlg.service.ts:812-815`, dispatch `dialogInterpreter.ts:345-348`, bound `compose.ts:922`). Still constants: `getItemNum: () => 0`, `emptyInventoryNum: () => 32`, `partySize: () => 1`, `isParty: () => 0`, `isPartyMaster: () => 1` — `scriptDlg.service.ts:805-807` (line + guild verdict corrected 2026-08-12; the old `:742-748` citation and the "`isGuild: () => 0`" claim are both stale)
- [x] ✅ Shop cost multiplier — `unitCost = max(1, floor((shopCostRate ?? 1) * rawPrice))` (`shop.service.ts:123`, dep declared `:57`) **and** the ctor is now wired: `compose.ts:942` passes `config.world.shopCostRate`. Perin fixed-price still ❌ (ponytail `shop.service.ts:105`), as are the event-LUA `GetShopBuyFactor` (ponytail `:55`), the sealed-char / perin-by-id sell blocks (ponytail `:146`), and the one-interaction-at-a-time `m_idOther` lock (ponytail `:10`) — sub-gaps enumerated 2026-08-12

---

## 10. TRADE / VENDING

- [x] ✅ Player-to-player trade — `inventory/services/trade.service.ts` (650 lines, full `CVTInfo` state machine), handler `inventory/handlers/trade.handler.ts:36-116` (10 opcodes), dispatch `clientServer.ts:214-223`. Gold escrowed at stake; items re-validated against the live bag at commit; WAL `INVENTORY_SLOT` + `CHAR_GOLD` both sides
- [ ] 🟡 Non-tradeable flags — guild-cloak (`m_idGuild != 0`), quest-item, bound-item, vagrant-ride — ponytail `trade.service.ts:621`, gate fn `:625 checkStakeable`; C++ `MoverItem.cpp:210-236`. **The guild half is now actionable** — `m_idGuild` is real since §26 shipped (cite + note corrected 2026-08-13)
- [ ] 🟡 Vendor `IsFly()` gates are stale ponytails — `vendor.service.ts:106`
  (open) and `:214` (query) both say "no flight state yet", but
  `player.isFly()` has shipped (§13) and five other subsystems already call it.
  Two one-line gates close it; the chaotic-`Propensity.nVendor` and
  guild-war/miniroom/quiz-world halves of those same ponytails remain genuinely
  unportable (row added 2026-08-13)
- [ ] 🟡 Vending / private shop — **UPGRADE ❌→🟡**: full 6-opcode PVENDOR port — `inventory/services/vendor.service.ts` (CVTInfo vendor half, sibling of trade), `inventory/handlers/vendor.handler.ts`, `inventory/net/snapshot/vendor.serializer.ts`, dispatch `clientServer.ts:225-232`, compose `:774-783`. Open/register/unregister/query/buy/close + onDisconnect; buy re-validates the listing against the live bag (dupe-safe) and WAL-journals `INVENTORY_SLOT`+`CHAR_GOLD` both sides via `InventoryService`. Peer ADD_OBJ title field populated from `m_vtInfo.title` (`mover.serializer.ts:91`). 12 service tests green. **Ponytail'd C++ guards not enforced**: chaotic-Propensity.nVendor gate (no PK penalty table), guild-war/miniroom/quiz-world rejects (no worlds), bound/guild-cloak/vagrant-ride item flags (`:367` — not on `InventorySlot`; only quest IK3 + equipped are enforced, same surface trade stubs), chatting-room integration (bState hardcoded 1), CNPC-radius 3m reject (no NPC spatial index). In-memory only — faithful, C++ closes the shop on disconnect

---

## 11. QUEST

*All §11 citations re-read 2026-08-12 against `quest.service.ts` /
`questConditions.ts` at HEAD.*

- [x] ✅ Accept/begin + canBegin — `quest.service.ts:203 beginQuest`
- [x] ✅ Tracking (kill/patrol/time) — `questTracker.system.ts`
- [x] ✅ Cancel / removeAll / removeComplete / check — `quest.service.ts:282 cancelQuest`, `:300 removeAllQuests`, `:313 removeCompleteQuests`
- [ ] 🟡 Begin conditions — **the party branch is written but inert** (corrected 2026-08-12). `SetBeginCondParty` checks membership / leader / size at `questConditions.ts:186-192`, fed from `quest.service.ts:155-162` — but `partyQuery` is an **optional dep that `compose.ts` never passes** (`quest.service.ts:96`; construction at `compose.ts:461-493` has no `partyQuery` key), so `isInParty`/`partySize`/`isPartyLeader` keep their defaults and mode 2 ("must be in party") always fails. One constructor key closes it. Guild is separately stubbed — ponytail `questConditions.ts:197-201`, mode 2 hard-fails
- [ ] 🟡 End conditions — party/guild/state/completeQuest stubbed permissive — ponytail `questConditions.ts:270`
- [ ] 🟡 Rewards — gold/exp/item done; PK/Teleport/Hide/PetLevelup still no-op — `questRewards.ts:149-152`
- [x] ✅ Level-up SETEXPERIENCE/SETLEVEL broadcast on quest reward — **UPGRADE 🟡→✅**: the `onExpGain` sink always sends SETEXPERIENCE and broadcasts SETLEVEL when `leveled` — `compose.ts:471-484`, fired `questRewards.ts:189`
- [x] ✅ Dialog-driven turn-in — **UPGRADE 🟡→✅**: `QUEST_END_COMPLETE` (`scriptDlg.service.ts:472`) → `applyEnd:549` → `questService.endQuest`; `questEndConfirm:510` uses the real `isComplete`; `questInv:608` is a live-bag `InventoryOps`
- [x] ✅ Quest inventory adapter (real item grant/remove on reward) — `quest/services/questInventory.adapter.ts` (101 lines) `bindQuestInventory`; add → CREATEITEM/UPDATE_ITEM, remove → per-slot consume + UPDATE_ITEM. The `PERMISSIVE_INV` comment in `questRewards.ts:193` is itself stale — the bound bag is the live path
- [x] ✅ Quest offer scan (`FUNCTYPE_NEWQUEST` / `FUNCTYPE_CURRQUEST`, round-trip via `nGlobal2`) — `scriptDlg.service.ts`

---

## 12. MOVEMENT / ZONES / WORLD

- [x] ✅ Walk/run apply + broadcast + anti-teleport guard — `world-server/services/movement.service.ts:100,119,131,153,173,189` (moved from `world-core` in the carve-out); `ANTI_TELEPORT_SQ = 1_000_000`; every path calls `visibilityService?.refresh()` and `lootService?.checkArrival(player)` (`:111,140,162`)
- [x] ✅ GM teleport `/te` (same-world SETPOS) — `command.service.ts:374` (re-cited
  2026-08-12; `cfe1520` rewrote the shape). Coords are now **floats**, not ints, in
  both forms: 3-arg Navigator `<worldId> <x> <z>` and 2-arg `<x> <z>`, with the
  `x>0 && z>0` guard retained. `worldId` is still parsed and discarded — see the
  cross-world row below; there is no notice to the GM when the requested world is
  not the current one (`command.service.ts:388-402`)

- [x] ✅ PLAYERANGLE applied — `applyAngle` is real: rejects when `!player.isFly()` with `reason:'not_flying'`, otherwise sets `m_fAngleX` and broadcasts — `movement.service.ts:188-193`, `playerAngle.handler.ts`. Shipped with FlightService (`438b248`); the old accepted-and-discarded row is retired
- [ ] ❌ Collision / terrain check — only the distance anti-cheat
- [ ] ❌ **`.lnd` heightmap parser — no server-side terrain Y at all** (row added
  2026-08-12). Three subsystems each carry their own proxy because
  `GetFullHeight`/`GetLandHeight` (`WorldFile.cpp:832`, `World.cpp:982`) are
  unported: `/te`-family teleports approximate ground Y from the nearest
  authored spawn/NPC y in the zone (ponytail `command.service.ts:127-133`), drop
  piles reuse the killer's client-reported y (ponytail `drop.service.ts:94`,
  fn `:98 groundY`), and flight has the same gap (`flight.service.ts:24`). Until
  the `.lnd` files under `game/client/World/` are parsed, mover Y is never
  server-authoritative — this one parser closes all three
- [ ] ❌ Player run/walk speed enforcement — no speed clamp anywhere in `movement.service.ts`
- [ ] 🟡 Multi-zone — buckets are real (`Map<number, Set<CPlayer>>`, `broadcastAround` frames once and reuses) but `resources/data/worlds/zones/flaris.yml` is the **only** zone file, so one zone ships — `world-core/managers/zone.manager.ts:17`
- [ ] ❌ Zone transitions / cross-world transfer — REPLACE handoff not wired; `/su` and admin teleport deliberately SETPOS (`command.service.ts:406`, `adminCommand.service.ts:208`) *(cites refreshed 2026-08-12)*
- [ ] 🟡 World map — **UPGRADE ❌→🟡**: SETNAVIPOINT map-ping works and the Navigator double-click `/teleport worldId x z` path is end-to-end (`command.service.ts:374`). Still no world-map/region data model
- [ ] 🟡 Map key accept-all (no manifest) — `npc/services/mapKey.service.ts:40,44`
- [x] ✅ Vicinity radius streaming (`CLinkMap::ModifyView` port) — per-player `m_known` objid set diffed against a live radius query, streaming ADD_OBJ/DEL_OBJ deltas — `world-core/services/visibility.service.ts:110,140,152,175`. Wired into MAP_KEY, all 5 movement paths, DESTPOS, `/te` `/su` `/teleport`, admin teleport, revival, disconnect
- [ ] 🟡 Vicinity does not re-link on **monster** movement — only player moves, teleport, and spawn/despawn drive a diff; the 30 m leash bounds the error — `visibility.service.ts:27`
- [x] ✅ Player-to-player ADD_OBJ (`METHOD_EXCLUDE_ITEM` PLAYER branch) — peers appear/disappear as either side walks — `visibility.service.ts:175 diffPeers`, `world-server/net/snapshot/peerSnapshot.serializer.ts`
- [x] ✅ Peer frame carries the real buff list — see §3; `mover.serializer.ts:75-83 writeBuffs`

---

## 13. FLYING / MOUNTS (signature Flyff)

*§13 citations re-read 2026-08-13 against `flight.service.ts` /
`equip.service.ts` / `pet.system.ts` at HEAD.*

- [ ] 🟡 Flying (board/broom) — **UPGRADE 🟥→🟡 (2026-08-05).** `FlightService`
  ships (`world-core/services/flight.service.ts`, added `438b248`): mount sets
  `player.m_dwStateFlag |= OBJSTAF.FLY` (`:137`), dismount clears
  `OBJSTAF.FLY | OBJSTAF.ACC | OBJSTAF.TURBO` (`:149`); reject TIDs are the real
  ones (`USEAIRCRAFT` 612, `NOFLY` 2405, `CHAOTIC_NOT_FLY` 3135,
  `MODIFY_FLIGHT_SPEED` 3457). Entry is the equip path —
  `inventory/services/equip.service.ts:158 canMount`, `:199 flight?.mount`,
  `:232 flight?.dismount` on `PARTS_RIDE`. Wired `world-server/compose.ts:760,770,775,821`.
  `m_dwStateFlag` reaches the client at `mover.serializer.ts:149`; `player.ts:706
  isFly()` + `getFlightLv()` are the read side, consumed by the movement gates
  (`movement.service.ts:104,121,133,155,175`), the skill-cast reject
  (`skill.service.ts:301`), the fly-mismatch combat policy
  (`combat.policy.ts:30,79`) and the blinkwing gate
  (`blinkwing.service.ts:150`). **Of C++'s eight mount gates, 5 are enforced and
  3 are ponytail'd** (`flight.service.ts:22-28`, checks at `:86-110`): the
  zone-permission (`:90`), idle/able-to-act subset (`:98`) and chaotic (`:105`)
  gates are live; `HATTR_NOFLY` terrain and `IK3_TEXT_DISGUISE` are ponytail'd
  together at `:94`, the pet conflict at `:108`
- [ ] ❌ Flight fuel / turbo — `m_nFuel` is seeded on mount and never decremented
  (faithful: v19's own decrement site is commented out at
  `ActionMoverMsg2.cpp:262`), but turbo fuel **does** drain in C++
  (`ActionMoverState2.cpp:360-374`, 1/60 s under `TURBO|ACC`) and neither the
  turbo state machine nor `SETFUEL` / `IK2_AIRFUEL` refuelling is ported —
  ponytail `flight.service.ts:29-33` (row split out 2026-08-13; the old row
  lumped fuel in with the three unportable gates, which understates it — fuel is
  portable today, the other three are not)
- [ ] ❌ Pet↔flight gate is **one-directional** — `pet.system.ts:86` refuses to
  summon a pet while flying (`TID_CANNOT_CALL_PET_ON_FLYING` 3210), but the
  reverse check is the ponytail at `flight.service.ts:108`
  (`TID_GAME_CANNOT_FLY_WITH_PET` 3209), so a player with a pet already out can
  mount and fly with it. Now actionable — the looter pet **has** shipped, so the
  "no pet system" rationale in the module doc (`:28`) is stale (row added
  2026-08-13)
- [ ] ❌ Mounts / ride — `PARTS_RIDE` routes into `FlightService`, but there is no
  distinct ground-mount state, no mount speed model, and no `MOVERDESTPOS` mount
  handling

---

## 14. CHARACTER PROGRESSION

- [x] ✅ Create (name/slot/dupe guards) — `charCreate.service.ts`
- [x] ✅ Select / enter-world (PRE_JOIN) — `charSelect.service.ts`
- [x] ✅ Stats allocation (MODIFY_STATUS, WAL) — `stat.service.ts`
- [x] ✅ Level / exp (cascade, WAL, SETLEVEL/SETEXPERIENCE) — `entities/math/exp.ts`, `combat.service.ts:211`
- [ ] 🟡 Delete — the **second factor arrives on the wire and is thrown away**: `char.handler.ts:125 handleDeletePlayer` reads two strings at `:128-129` (password, delete-key) into nothing at all — they are now bare `reader.readString();` calls with no binding, so even the `_password`/`_deleteKey` breadcrumbs are gone; `charCreate.service.ts:126 delete()` checks account ownership only *(cite re-read 2026-08-13)*
- [x] ✅ Job / class change 1st→2nd — full port of `DPSrvr.cpp:4685-4721` + `CMover::AddChangeJob` — entry `changeJob.service.ts:64 changeJob`, vagrant-only `:67`, exact-level-15 `:75`, range 1..15 `:78-79`, `seedRoster` `:87`, WAL `CHAR_JOB` `:94` (replayer `journalReplayers.ts:110`), SET_JOB_SKILL self + SET_NEAR_JOB_SKILL vicinity `:101,108`, `updateClass` `:117`, `initStat` `:126`. **There is no packet handler because the C++ path is itself dialog-driven**: entry is `npc/services/dialogInterpreter.ts:346 case 'ChangeJob'`, wired `scriptDlg.service.ts:318`, composed `compose.ts:612`
- [ ] 🟡 Job change caps at 15 — Master/Hero/Legend (16-39) are rejected by `changeJob.service.ts:78-79` (`MIN_JOB_CHANGE`/`MAX_JOB_CHANGE`), but `admin/lib/job-change.ts:21` models all five tiers. **Server and admin panel disagree**

---

## 15. SOCIAL

*§15 citations re-read 2026-08-13 against `command.service.ts` /
`friend.service.ts` / `campus.service.ts` at HEAD.*

- [x] ✅ Normal/say chat (vicinity) — `chat.service.ts`
- [x] ✅ Shout (server-wide via PlayerManager.all) — registered `command.service.ts:227`, impl `:340 shout`
- [x] ✅ Whisper (direct to target) — registered `command.service.ts:225-226` (`/w`, `/whisper`, `/say`), impl `:296 whisper`
- [ ] 🟡 Party / guild / trade chat channels — party works via the `PARTYCHAT` **opcode** (`party.service.ts:306 chat`) and guild chat has both the opcode and the `/g` alias (registered `command.service.ts:229`, impl `:326 guildChat` → `guildService.chat`); the `/p` alias and the trade channel remain absent. **The header ponytail is stale** — `command.service.ts:40` still reads "`/p` `/g` need party/guild" although `/g` shipped and party shipped (correct it to `/p` only)
- [x] ✅ Guild system — **UPGRADE ❌→✅ (untested in client)**: shipped as `packages/guild` — 5 services (`guild`, `guildBank`, `guildContribution`, `guildQuest`, `guildWar`), 3 managers, `handlers/guild.handler.ts`, migrations `023_guild`→`026_guild_quest`, 26 dispatched opcodes (`clientServer.ts:198-228`). Full breakdown in **§26 GUILD**. The old "largest unstarted system / no `guild*` tables" note is retired
- [x] ✅ Friend list — `social/services/friend.service.ts` (**383** lines, 7 opcodes — was cited as 348), handler `social/handlers/friend.handler.ts:44-141`, dispatch `clientServer.ts:226-230`; both-direction inserts, presence relay, actor resolved from session not packet
- [x] ✅ Blocklist — write path landed: `friend.handler.ts:157` → `friend.service.ts:289 toggleBlock` → `friend.repo.ts:97 setBlocked`, dispatched `clientServer.ts:291`; the roster ships blocked-aware (`friend.service.ts:251-257 sendRoster`). Was "dead storage" through 2026-08-05 *(cites re-read 2026-08-13)*
- [ ] 🟡 Friend presence states — `FRS_AUTOABSENT` deliberately not emitted (no idle timer) — `friend.service.ts:263` (doc), enforced `:275`
- [ ] 🟥 Peer data reply (QUERY_PLAYER_DATA — what the friend/guild/party windows ask for) — always returns `{ reply: null }`; needs per-player `nVer` + the `sPlayerData` layout — `world-server/services/queryPlayerData.service.ts:46`
- [ ] 🟡 Motion / emote broadcast (verbatim, no `OBJMSG_*` validation, and no `AddMotionError` reply on reject) — ponytail `motion.service.ts:9-11`
- [ ] 🟡 Sit / rest — behavior frame accepted; still no sit state and no Stretching 1.8×/1.5× multiplier. **The in-code rationale is stale** — `recovery.system.ts:12-13` says "no sit state or party system yet", but party shipped in §5, so only the sit state blocks it now (row + stale-comment note 2026-08-13)
- [ ] 🟡 Taskbar — F1-F9 grid **and** the skill-queue grid now persist (v2 `{items,queue}` JSON, SKILLTASKBAR at `clientServer.ts:207`); the applet grid is still absent — `taskbar.service.ts`
- [x] ✅ Campus / master-pupil mentoring — `social/services/campus.service.ts` (**507** lines — was cited as 506), handler `social/handlers/campus.handler.ts:36,50,65,79`, dispatch `clientServer.ts:232-236`; level-91 master gate, `IK3_TS_BUFF` campus buff, point recovery on JOIN, level-up reward, boot bootstrap (`compose.ts:516,751-769,777,785`)
- [x] ✅ Cheering (CHEERING 0xffffff7c) — `world-server/services/cheer.service.ts:82`, dispatch `clientServer.ts:213`; point spend + regen tick + `II_CHEERUP` buff + motion/SFX fan-out. Points not persisted (matches C++)
- [x] ✅ MOVERFOCOUS GM target-inspect — `world-server/services/moverFocus.service.ts`, dispatch `clientServer.ts:208`; adds an `AUTH_GAMEMASTER` check C++ lacks
- [x] ✅ QUERYEQUIP / QUERYEQUIPSETTING peer-equipment inspect — dispatch `clientServer.ts:211-212`

---

## 16. INFRA / PERSISTENCE (mostly done — listed for completeness)

- [x] ✅ Login/auth (argon2id, ban, session token) — `auth.service.ts`
- [x] ✅ Char-select → world handoff (HMAC IPC) — `handoffPublisher.ts` / `clusterListener.ts`
- [x] ✅ Server / world list — `serverList.service.ts` / `worldList.service.ts`
- [x] ✅ **WAL journal + boot replay — hole closed 2026-08-02.** 10 types registered (`CHAR_EXP`, `CHAR_GOLD`, `INVENTORY_SLOT`, `BANK_PASS`, `CHAR_STATS`, `SKILL_LEARN`, `CHAR_JOB`, `BANK_SLOT`, `BANK_GOLD`, `PK_KILL` — `journalReplayers.ts`) and **every type any service emits now has one**, guarded by a test that appends one row per emitted type and asserts `summary.skipped === 0`. Five delta-shaped types that had no replayer were rewritten as absolute end-state rows per rule 04: `ITEM_MOVE`/`ITEM_DROP`/`ITEM_CONSUME` → paired `INVENTORY_SLOT`, `GOLD_DROP` → `CHAR_GOLD`, `BANK_DEPOSIT`/`BANK_WITHDRAW` → `BANK_SLOT` + `INVENTORY_SLOT`. `BANK_GOLD` and `PK_KILL` are new replayers
- [x] ✅ 30s checkpoint DB sync + dirty flags — `checkpoint.system.ts:28` `FLUSH_INTERVAL_MS=30_000`, idempotent `:40 start()`, interval armed `:48`, try/catch, fire-and-forget; per-player flush `join.service.ts:319`, loop + `presenceRepo.touch` `:355-364`
- [ ] 🟡 argon2id ships a fallback — argon2id primary via dynamic `require('argon2')`; fallback is a deterministic scrypt PHC-ish hash embedding its own salt. `argon2 ^0.40.1` **is** a declared dep in login-server + world-server, so prod can be real — ponytail `core/utils/password.ts:15-16`
- [x] ✅ Draining shutdown — stops listener then `adminCommandService.kickAll('shutdown:'+signal)`; `process.on('message',{cmd:'shutdown'})` is the real Windows stop path; `uncaughtException` drains, `unhandledRejection` deliberately does not — `world-server/index.ts:196,206,232-233,238,247,253`
- [x] ✅ Forced-logout kick (SEALCHARGET_REQ) — `adminCommand.service.ts:101 kick`, `:140 kickAll` (awaited flush); `buildKickNotice` + `KICK_CLOSE_DELAY_MS` — needed because C++ sends nothing and the v19 client silently freezes on a bare close
- [x] ✅ Boot presence cleanup — `presenceRepo.clearByServer(config.server.id)` so the admin panel shows no ghosts after a crash — `compose.ts:300`

---

## 17. ADMIN PANEL / LIVE-OPS *(new section 2026-08-01)*

No C++ analogue — grade against its own contract, not v19 fidelity.
*Counts + cites re-verified 2026-08-13.*

- [x] ✅ Auth-gated Next.js 15 panel — `admin/middleware.ts:1` `export { auth as middleware } from '@/lib/auth'`, matcher excludes only `login`, `api/auth`, `_next/*`, favicon
- [x] ✅ 27 pages / 18 API routes (`find app -name page.tsx | wc -l` = 27, `route.ts` = 18 — the route count was 17 when written) — accounts, characters, bank, inventory, servers, settings + 10 resource-editor groups
- [x] ✅ Live-ops command channel — `world-server/ipc/adminListener.ts:21 ADMIN_COMMAND_CHANNEL = 'admin:command'` (rule 07 naming), subscribe `:141`, composed `compose.ts:1310`
- [x] ✅ Admin audit log — `admin/lib/audit.ts:34 writeAudit`, `admin_audit_log` table `admin/lib/migrate.ts:575-577`
- [x] ✅ Admin teleport is SETPOS-safe (never REPLACE); no-coords falls back to the zone's `revival.position` — `adminCommand.service.ts:208`
- [ ] 🟡 EXP edited as percent — 0-100% ↔ raw via `EXP_TABLE[level+1].nExp1`; admin depends on `@flyff/entities` for the table — `admin/lib/exp-percent.ts`
- [ ] 🟡 Job-change autofill disagrees with the server (see §14)
- [ ] 🟡 `@flyff/admin` is the one package `pnpm -r build` cannot build without `next` installed — it is a Next app, not a tsup bundle

---

## 18. SUPERVISOR DAEMON *(new section 2026-08-01)*

*All §18 citations re-read 2026-08-13 against `supervisor-daemon.ts` (468 lines)
and `supervisor-shared.ts` (291 lines) at HEAD. Every cite resolved; the two
🟡 rows had drifted by a few lines and are corrected.*

- [x] ✅ Detached daemon owns login/cluster/world children — loopback HTTP API, all seven routes dispatched in one handler: `/health` `:335`, `/status` `:339`, `/logs` `:343`, `/logs/clear` `:366`, `/start` `:378`, `/stop` `:383`, `/shutdown` `:394`; every route gated by `tokensMatch(req.headers[AUTH_HEADER], TOKEN)` at `:329` before the dispatch — `admin/lib/supervisor-daemon.ts:12-22`
- [x] ✅ Shared constants — `DAEMON_ENTRY:30`, `DEFAULT_PORT=28900:31`, `AUTH_HEADER:32`, `LOG_RING=500:33`, `ENTRY: Record<ServerType,string>:39` — `admin/lib/supervisor-shared.ts`
- [x] ✅ Constant-time token compare — `supervisor-shared.ts:191 tokensMatch` length-checks then `timingSafeEqual`, so a wrong-length token cannot be distinguished by timing
- [x] ✅ Token file `data/supervisor.token`, shared by the panel and `pnpm sv:*`
- [ ] 🟡 Single-host, no auto-restart of crashed children and no daemon restart on host reboot — ponytail `supervisor-daemon.ts:22` (was cited `:23`)
- [ ] 🟡 Windows stop is IPC not signal — child stop goes through `{cmd:'shutdown'}` over the stdio channel because a Windows SIGTERM handler never runs; the receiving end is `world-server/index.ts:262` (`msg.cmd === 'shutdown'` → `shutdown('ipc:shutdown')`) and the reason is documented at `:204-205` and `:257-258` (was cited `:238`)

---

## 19. LOG HUB / SERVER CONSOLE *(new section 2026-08-01)*

*All §19 citations re-read 2026-08-13. `LogHub` moved from `:125` to `:128`; the
20 s hold constant is now cited at its declaration. One new ✅ row (on-disk log
files) and one new 🟡 row (no download/rotation) added.*

- [x] ✅ Ring-buffer log hub (500 lines) — `admin/lib/supervisor-shared.ts:128 class LogHub`, `:136 push`, `:151 since`, `:156 clear`, `:165 wait` (was cited `:125`/`:133`)
- [x] ✅ Long-poll streaming — `/logs?id&since&wait=1`; the daemon holds the reader on `hub.wait(id, LOG_WAIT_MS, …)` at `supervisor-daemon.ts:356` with `LOG_WAIT_MS = 20_000` at `:69`, cancelled by `res.on('close')`; SSE route `admin/app/api/servers/[id]/logs/route.ts` (first read non-waiting `:50`, then `wait = true` `:63`)
- [x] ✅ Level parsing + filtering — `admin/lib/log-line.ts:46 parseLogLine`, `:75 FILTERABLE`, `:82 passesLevel` (was cited `:48`/`:74`/`:81`)
- [x] ✅ Persistent clear — `DELETE` → `/logs/clear` (`supervisor-daemon.ts:366`); the ring is cleared server-side because a browser-only clear replays from seq 0 on the next read (documented `supervisor-shared.ts:121-123`)
- [x] ✅ On-disk log files — each child also streams to `logs/<id>.log` in append mode (`supervisor-daemon.ts:114`, `:200`), so history survives a daemon restart even though the ring does not
- [ ] 🟡 No log download, search, or rotation in the panel — the on-disk `logs/<id>.log` files grow unbounded (append-only `createWriteStream`, no size cap or rollover) and the UI can only read the 500-line in-memory ring, never the file (row added 2026-08-13)

---

## 20. MAIL / POST *(new section 2026-08-01)* — **USER-CONFIRMED 2026-08-02**

Every line below was tested on a real v19 client by the user and confirmed
working. This is the one section where ✅ means *fixed*, not "passes my checks".

- [x] ✅ Read path (5 opcodes: QUERYMAILBOX, READMAIL, QUERYGETMAILITEM, QUERYGETMAILGOLD, QUERYREMOVEMAIL) — `mail/handlers/mail.handler.ts:56-78`, dispatch `clientServer.ts:305-309` (was cited `:244-248`; re-read 2026-08-13)
- [x] ✅ Mailbox-state sync (`CUser::AdjustMailboxState` port; MODE_MAILBOX is the only new-mail indicator) — `mail/services/mail.service.ts:150 syncMailboxMode` (was `:143`)
- [x] ✅ Schema — `017_presence_and_mail.ts`, `mail` table with the full C++ `CMail` field mapping
- [ ] 🚫 Player→player send — `QUERYPOSTMAIL` 0x1a **deliberately** unwired; `SNAPSHOTTYPE_POSTMAIL` intentionally absent. Admin-originated mail only. Postage/custody fees and stamped mail also out of scope by choice
- [x] ✅ Attachment fidelity — refine / element / flags dropped on attachments. **User-confirmed acceptable** — admin-originated mail is the only sender and the admin form does not set those fields — `mail.service.ts:90`

---

## 21. ONLINE PRESENCE *(new section 2026-08-01)*

Emulator infrastructure with no C++ analogue.

*All §21 citations re-read 2026-08-13; three of four had drifted and are
corrected.*

- [x] ✅ `online_players` table (character_id PK, account_id, world_id, zone_id, server_id, last_seen_ms) — `017_presence_and_mail.ts:40 createTable` (rationale comment `:6`)
- [x] ✅ Upsert / remove / touch — the world server owns the rows via an optional `Pick<PresenceRepository,'upsert'|'remove'|'touch'>` (`join.service.ts:81`): upsert on join `:152`, remove on leave `:280`, touch in the checkpoint loop `:377`. All three are fire-and-forget with a `logger.warn` catch, so a presence write can never fail a join (was cited `:149`/`:267`/`:355-364`)
- [x] ✅ Staleness window — `PRESENCE_STALE_MS = 60_000` `admin/lib/presence.ts:20`, `isOnline:23`, `getOnlineCharacterIds:29`
- [x] ✅ Boot cleanup — a hard crash leaves this process's rows behind, so they are cleared at startup — `compose.ts:355-360` (was cited `:300`)

---

## 22. GATEWAY (unified WebSocket) — recommend delete-or-document

- [ ] 🟥 **Orphaned prototype**, 968 lines across 8 files (`packages/gateway/src/*`, re-measured 2026-08-13 — count holds). Two dead-code signals hold: zero external references to `@flyff/gateway` (grep across all `packages/**/*.ts|json` outside the package itself returns nothing); absent from the supervisor `ENTRY` map (`supervisor-shared.ts:39`). The third is now **false** — it was touched by a real security fix, `29c8c58 fix(security): close gateway pass-the-hash`, so deleting it silently discards that fix's target. Decide delete-vs-document explicitly
- [ ] 🟥 **Divergent duplicate of the real world path** — handles only PRE_JOIN, JOIN, PLAYERMOVED, MOVERDESTPOS, PLAYERANGLE, CHAT, PING, LEAVE (`gateway/src/worldHandlers.ts:20-158`) and hand-rolls its own accounts/characters DDL instead of using `@flyff/database` migrations (`main.ts:14-60 ensureSchema`). A second JOIN/movement implementation that no longer tracks the primary one is a fidelity liability, not just dead weight
- **Recommendation:** delete it, or add a header stating it is an unshipped experiment and exclude it from fidelity audits

---

## 23. C→S OPCODE GAP *(new section 2026-08-03)*

Full audit of v19 C++ `DPSrvr.cpp:122-579` `OnMsg` table (+`USESKILL` in
`DPSrvrLux.cpp:32`) vs emulator dispatch. **Recounted 2026-08-12** against
`646d159`: 145 `dispatcher.register` calls / **144 unique opcodes** across three
dispatchers — `world-server/src/clientServer.ts:149-309` (137),
`cluster-server/src/clientServer.ts:41-64` (6), `login-server/src/clientServer.ts:34-37` (2).

Two baselines, since the C++ `ON_MSG` table and the client's send sites do not
agree:

| Baseline | Total | Handled | Unhandled |
|---|---|---|---|
| C++ `ON_MSG` (`DPSrvr.cpp` + `DPSrvrLux.cpp`), unique | 300 | 110 | **190** |
| Client send sites (`Neuz/DPClient.cpp` `BEFORESEND*`), unique | 307 | 120 | **187** |

The old "~228 C++ opcodes, routes 112, misses ~156" line understated the
denominator on both sides. 34 of the 144 handled names have no `ON_MSG` twin
because v19 routes them through the core server instead
(`PACKETTYPE_ADDFRIEND` → `CORESERVER/DPCacheSrvr.cpp:40`, and the rest of the
friend/party/guild cache codes) — those are real coverage, not phantoms.

**Closed since the 08-05 count** (26 opcodes, all guild — see §26):
`GUILD_INVITE` `IGNORE_GUILD_INVITE` `ADD_GUILD_MEMBER` `REMOVE_GUILD_MEMBER`
`DESTROY_GUILD` `GUILD_MEMBER_LEVEL` `GUILD_CLASS` `GUILD_NICKNAME` `CHG_MASTER`
`NW_GUILDLOGO` `NW_GUILDNOTICE` `NW_GUILDCONTRIBUTION` `GUILD_AUTHORITY`
`GUILD_PENYA` `GUILD_SETNAME` `GUILD_BANK_WND` `GUILD_BANK_WND_CLOSE`
`PUTITEMGUILDBANK` `GETITEMGUILDBANK` `GUILD_BANK_MOVEITEM` `DECL_GUILD_WAR`
`ACPT_GUILD_WAR` `SURRENDER` `QUERY_TRUCE` `ACPT_TRUCE` `STATEMODE`
(`clientServer.ts:171,198-228`). This retires the "Guild core 6" and
"Guild bank 5" cluster rows below.

### Declared-but-undispatched (cheapest — opcode value already pinned in `opcodes.ts`)

| Opcode | hex | C++ handler | Purpose |
|---|---|---|---|
| `MAGIC_ATTACK` | `0x00ff0011` | `DPSrvr.cpp:223 OnMagicAttack` | Magic/spell attack swing — the one remaining combat path |
| `PROPOSE` | `0x8FFFF000` | `DPSrvr.cpp:511 OnPropose` | Couple propose (string target) |
| `REFUSE` | `0x8FFFF001` | `DPSrvr.cpp:512 OnRefuse` | Couple refuse |
| `COUPLE` | `0x8FFFF002` | `DPSrvr.cpp:513 OnCouple` | Couple accept |
| `DECOUPLE` | `0x8FFFF003` | `DPSrvr.cpp:514 OnDecouple` | Break couple |

Snapshots `COUPLE_PROPOSE_RESULT/COUPLE_RESULT/DECOUPLE_RESULT/ADD_COUPLE_EXPERIENCE` (`0x9701-5`) are also already declared at `opcodes.ts:399-402` — someone pre-stubbed Couple for build but never wired dispatch.

**Re-verified 2026-08-13**: the three dispatch counts still sum to 145
(`world-server` 137 + `cluster-server` 6 + `login-server` 2), and none of
`MAGIC_ATTACK` / `PROPOSE` / `REFUSE` / `COUPLE` / `DECOUPLE` appears in
`world-server/clientServer.ts` — all five remain declared-only.

### Guild bank log (added 2026-08-13)

`GUILDLOG_VIEW` is a **real** C→S request, not a phantom: `ON_MSG` at
`WORLDSERVER/DPSrvr.cpp:424 OnQueryGuildBankLogList`, the client sends it at
`Neuz/DPClient.cpp:17074`, and it round-trips through the DB server
(`DPDatabaseClient.cpp:137`, `databaseserver/dptrans.cpp:146`). The emulator has
**no `GUILDLOG_VIEW` constant at all** — it is not even declared in
`opcodes.ts` — so the guild-bank log window has no server side. §26 lists it
under "unhandled/undeclared"; this is the C++ evidence for that row.

### Core holes (not subsystem-clustered, newly identified)

`MELEE_ATTACK2` · `SFX_CLEAR` · `TELESKILL` (blink) ·
`RETURNSCROLL` (use return scroll) · `MODIFYMODE` ·
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
`USE_PET_FEED`/`MAKE_PET_FEED`/`CLEAR_PET_NAME`/`TRANSFORM_ITEM` (system pet — §8)
· `AVAIL_POCKET`/`MOVE_ITEM_POCKET` (pocket tabs).

**Closed since the 08-03 audit** (removed from the list above): `STATEMODE`
(`clientServer.ts:169`, drives the blinkwing channel), `SFX_ID` + `SFX_HIT`
(registered as no-op acks), `PLAYERBEHAVIOR2`, `BLOCK`, and the 6 `PVENDOR`
codes (§10).

### Subsystem clusters (count of undeclared opcodes)

Guild combat 13 · 1v1 guild combat 9 · Secret room 9 ·
Rainbow race 5 · Housing 5 · Guild house 7 · Ultimate weapon 6 · Minigames 8 ·
Pet/feed 8 ·
Lord/election 5 · Honor 2 · Collecting 2 · Wanted-list 4 · Chatting-room 4 ·
Summon-friend/party 5 · Arena (enter/exit) 2 · `QUERYPOSTMAIL` (deliberate skip,
opcodes.ts:18).

*(Guild bank 5 and Guild core 6 removed 2026-08-12 — both dispatched, see §26.
The guild-quest boss arena shipped, but `ARENA_ENTER`/`ARENA_EXIT`/`COLOSSEUM`
are still unrouted, so the Arena row stays.)*

> **`MOVEBANKITEM` caveat:** the `opcodes.ts` comment claims it is an unregistered
> C++ stub, but `ON_MSG` at `DPSrvr.cpp:169` does register `OnMoveBankItem`.
> Re-check the handler body before trusting either claim.

---

## 24. UNSTARTED FEATURE SYSTEMS *(new section 2026-08-03)*

Whole systems entirely absent from the emulator (zero code path) or stubbed at
the protocol layer only. Decomposes the existing biggest-gap ranks 1, 6, 10 into
separable subsystems and adds systems never previously tracked.

*"Stubbed / partial" citations re-read 2026-08-13. One row (BeautyShop) was
**wrong about the cause** and is corrected in place; the pocket, marking, guild-bank,
system-pet, and Tax (`shop.service.ts:106`, a comment only) cites all resolved.*

### Player-facing / signature (ranked by blocking + visibility)

| System | C++ source | Emulator | Blocks |
|---|---|---|---|
| **Guild sub-tree** (9 subsystems) | `guild.cpp` + 8 siblings | **7 of 9 shipped** (roster, `/g` chat, bank, contribution, war, quest arena, dialog predicates) — see §26. Still absent: **1v1 guild combat**, **Guild House** | guild-cloak non-tradeable flag (now *actionable*, `m_idGuild` is real — `trade.service.ts:621`), guild-party mute check, guild ranking |
| **Lord / Election / Lord skills** | `lord.cpp`, `slord.cpp`, `lordskill.cpp`, `election.inc`, `lordevent.inc` | absent | Lord-controlled Tax rate, lord-skill server-wide buffs, lordevent |
| **Couple / Marriage** | `couple.cpp`, `couplehelper.cpp`, `couple.inc` | **protocol-stubbed** (opcodes declared, undispatched — see §23) | couple quest conditions, `IK3_COUPLE_BUFF` items, propKarma branch |
| **Instance / Party Dungeon** | `InstanceDungeonBase.cpp`, `InstanceDungeonParty.cpp`, `PartyDungeon.lua` | absent | `propQuest-DungeonandPK.inc` (unprocessed), `propQuest-Scenario.inc`, endgame PvE |
| **Event / Live-ops** | `EventLua.cpp`, `flyffevent.cpp`, `EventMonster.cpp`, `spevent.cpp` + 4 lua + `propEvent.inc`/`propDropEvent.inc`/`randomeventmonster.inc` | absent | every data-driven drop/spawn/exp event — core live-ops tool |
| **System pet** (5 subsystems) | `pet.h` `PETLEVEL` enum, egg→D-C-B-A-S | absent — **the looter/EatPet half shipped** (`world-server/systems/pet.system.ts`, `439c52f`); egg hatch / pet level+exp / feed / name / release are the missing five | `dwPetId` still hardcoded `NULL_ID` in the vicinity snapshot (`mover.serializer.ts:135`, layout doc `:105`) — corrected from `:136` 2026-08-13; pet-level buffs |
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
| **Pocket (extra inv tabs)** | `pocket.cpp`, `CPocketController` | stub — `mover.serializer.ts:47 writeEmptyPocketController` writes `MAX_POCKET_TABS` zero availability bytes for the absent CPocketController | bank overflow, premium-bag economy |
| **BeautyShop / SkinChange / LookChange** | `character.inc` `MMI_BEAUTYSHOP` (13) / `MMI_BEAUTYSHOP_SKIN` (42) / `MMI_LOOKCHANGE` (268) — `game/resource/defineNeuz.h:112,142,453` | absent **at the service layer only** — corrected 2026-08-13: the earlier claim that the loader "does not know these MMI constants → parse to undefined" is **false**. `characterInc.loader.ts:545` builds the full MMI map with `parseDefines(decode(mmiBuf),'MMI_')` from the real `defineNeuz.h`, and `:300` resolves any `AddMenu(MMI_*)` through it (`MMI_FALLBACK:32` is only the header-absent fallback), so these ids land in `menus` correctly. What is missing is any service that acts on them | cosmetic coupon economy |
| **NPC Marking (minimap markers)** | `character.inc` `MMI_MARKING` (8, `defineNeuz.h:107`) | parsed but unconsumed — `MMI_FALLBACK` entry at `characterInc.loader.ts:41`; a grep for `MMI_MARKING` across all of `packages/**/*.ts` returns **that one line and nothing else** | navigation UX |
| **Guild Banking** | `character.inc` `MMI_GUILDBANKING` | **shipped** — `guild/services/guildBank.service.ts`, migration `024_guild_bank`, 5 opcodes at `clientServer.ts:215-219` (all five re-check MMI_GUILDBANKING proximity in the service, not just on open — `:213-214`). Only the C++ bank LOG is ponytail'd (`guildBank.service.ts:31`) | — |

---

## 25. SLASH COMMANDS *(new section 2026-08-03)*

Full audit of `FuncTextCmd.cpp:5157-5522` ON_TEXTCMDFUNC table vs
`command.service.ts`. **Recounted 2026-08-12:** the C++ table has **220 active
rows, 162 of them server-side** (`TCM_SERVER`/`TCM_BOTH`) — the other 58 are
`TCM_CLIENT` display toggles and not gaps.

**TS side recounted 2026-08-13:** the router table is **43 entries carrying 75
names** (`command.service.ts:225-271`, array literal `:224-272`, dispatched by
`:283 route` → `:292 lookup` which matches any name in `names[]`). The earlier
"47 entries / 75 aliases" was wrong on the entry count — 43 is the exact
`{ names: [` count; the 75 name figure holds. Matching by name *or* alias still
gives **43 ported, 119 missing**. `adminCommand.service.ts` is not a slash table
at all — it is 4 IPC methods (`kick`, `kickAll`, `teleport`, `mailPushed`).
Newest rows: `/g` guildchat (`:229`), `/cg` createguild (`:233`),
`/setguildquest` (`:271`) — all three cites re-confirmed.

### Player commands

- **Ported (4/25):** `/w` whisper, `/say`, `/s` shout, `/g` guild chat
- **Blocked only on a command shim** (the subsystem itself exists): `/p` party
  chat, `/partyinvite`, `/guildinvite`, `/campusinvite`
- **Client-only `TCM_CLIENT` (no server work):** 17 preference/display toggles — `/pos`, `/ti`, `/ta`+`/tr`, `/wa`+`/wr`, `/ma`+`/mr`, `/ga`+`/gr`, `/ca`+`/cr`, `/ha`+`/hr`, `/ig`+`/uig`+`/igl`. Not gaps

### Highest-value GM commands still missing (no new subsystem needed)

- `/cjob` changejob — needs `characterRepo.updateJob` (high test value)
- `/mute` `/talk` `/nota` `/freeze` `/nofr` — target-named mode pipeline
- `/slv` `/slvAll` `/InitSE` — skill level (skill system exists)
- `/setskilllevel`-family + `/ci2` secondary create-item

### Blocked GM commands (need their subsystem first)

Re-split 2026-08-12 now that guild + party exist:

**No longer subsystem-blocked** (the data is there; only a command row is missing):
`/dg` (disband — the service method exists but is named **`destroy`**, not
`disband`: `guild.service.ts:158 destroy` over `guild.manager.ts:448 destroy`;
corrected 2026-08-13), `/gstat` (roster read), `/ranking` (`guilds.win_point` is
computed and persisted — field `guild.manager.ts:95 winPoint`, war-result math
`:766-773`; corrected from `:92,760` — only the read path is missing), `/plv`
(party level).

**Still blocked on an unported subsystem:**
`/gcopen`/`gcclose`/`gcin`/`gcNext` (1v1 guild combat); `/pl` `/pe` `/mpf` `/cpn`
(system pet — §27); `/Propose`/`Couple`/`Decouple` (couple); `/SecretRoom*` (8);
`/BuyGuildHouse`/`/GuildHouseUpkeep` (guild house — compiled out server-side,
see §26); all Lord/Election; `/ritem` `/pier` `/gro`/`iro`/`sro` (item
random-option side-channel).

**Already ported:** `/cg` (`command.service.ts:233`), `/setguildquest` (`:271`).

---

## 26. GUILD

*New section 2026-08-12 — supersedes the old §15 "❌ Guild system" line and the
§24 "Guild sub-tree" row, both now stale.*

`packages/guild` ships 9 files / ~3.9k lines: 2 managers, 5 services, 1 handler,
index. Persistence: migrations `023_guild`, `024_guild_bank`, `025_guild_war`,
`026_guild_quest`. **Nothing in this section has been client-tested** — ✅ here
means "passes this device's checks", per the legend at the top of this file.

*All §26 citations re-read 2026-08-13 by grepping method declarations and
`ponytail:` markers out of `guild.service.ts` / `guild.manager.ts` /
`guildContribution.service.ts` (258 lines) / `guildBank.service.ts` (433) /
`guildWar.service.ts` (654) / `guildQuest.service.ts` (414) /
`guildWar.manager.ts` (294) / `guildQuest.manager.ts` (254). **Every cite in the
five body subsections resolved to the named construct** — the guild section had
not rotted the way §4/§15/§17 had. Method names are now attached to the lines so
a future refactor produces a detectable mismatch. Four cites are corrected below
and one row's construct name was wrong.*

### Core roster

- [x] ✅ Creation (`/cg` GM cmd + service path, name uniqueness, master row) — `guild/src/services/guild.service.ts:120 create`, `guild.manager.ts:373 create`, cmd `world-server/services/command.service.ts:333 createGuild` (was `:334`)
- [x] ✅ Disband — refused while at war (`TID_GAME_GUILDWARNODISMISS`). The method is named **`destroy`**, not `disband` — `guild.service.ts:158 destroy`, `guild.manager.ts:448 destroy`
- [x] ✅ Invite / accept / decline (cooldown stamp, war reject) — `guild.service.ts:192 invite`, `:247 accept`, `:292 decline`, `guild.manager.ts:872 stampCooldown`
- [x] ✅ Leave + expel (one opcode, actor-vs-target split) — `guild.service.ts:312 leaveOrKick`, `guild.manager.ts:430 removeMember`
- [x] ✅ Master transfer — `guild.service.ts:440 changeMaster`, `guild.manager.ts:495 changeMaster`
- [x] ✅ Rename / notice / logo (logo write-once) — `guild.service.ts:465 rename`, `:485 setNotice`, `:500 setLogo`, `guild.manager.ts:511 rename`, `:525 setNotice`, `:537 setLogo`
- [x] ✅ Ranks: member level, class flag, alias — `guild.service.ts:359 setMemberLevel`, `:393 setMemberClass`, `:417 setMemberAlias`, `guild.manager.ts:464/474/483`
- [x] ✅ Authority mask `m_adwPower[5]` (`PF_*`), master mask re-forced on every write — `guild.manager.ts:546 setAuthority`, service `:514 setAuthority`
- [x] ✅ Rank penya allowance — `guild.service.ts:529 setRankPenya`, `guild.manager.ts:564 setRankPenya`
- [x] ✅ Hydrate on boot + per-join fan-out `ALL_GUILDS` → `GUILD` (order matters: ALL_GUILDS seeds the client's `g_GuildMng` that every later guild id resolves against — `:562-569`) — `guild.manager.ts:268 hydrate`, `guild.service.ts:570 onJoin`
- [x] ✅ `m_idGuild` reaches the wire in ADD_OBJ (variable-length guild block: presence byte then the id) — `world-server/net/snapshot/mover.serializer.ts:181-183`
- [ ] 🟡 `m_idGuildCloak` hardcoded 0 — `mover.serializer.ts:188` (faithful to `Mover.cpp:381`'s init, but never updated); the trade/vendor guild-cloak non-tradeable flag is also still ponytail'd — `inventory/services/trade.service.ts:621`
- [ ] 🟡 `m_nGuildCombatState` hardcoded 0 (1v1 guild combat unported) — `mover.serializer.ts:221`
- [ ] ❌ Cluster player-list still writes `idGuild=0` — `cluster-server/net/playerList.serializer.ts:64`

### Contribution / payroll

- [x] ✅ Penya + gem (exp) contribution; the penya branch wins when both are sent — `guildContribution.service.ts:115 contribute`, `:134 contributePenya`, `:159 contributeGems`
- [x] ✅ Level-up consumes BOTH pools in one `if`, full GUILD resend on level change — `guild.manager.ts:614 addContribution`, announce `guildContribution.service.ts:183 announce`
- [x] ✅ 21:00 salary sweep + 22:00 latch reset (`m_bSendPay`), `GUILD_REAL_PENYA` per paid member — `guildContribution.service.ts:48 SALARY_PAY_HOUR`, `:49 SALARY_RESET_HOUR`, `:212 tickSalary`, `guild.manager.ts:673 paySalaries`, `:696 resetSalaryLatch`, system `world-server/systems/guildSalary.system.ts`
- [x] ✅ `DecrementMemberContribution` on penya withdrawal — `guild.manager.ts:651 decrementMemberContribution`, caller `guildBank.service.ts:278`

### Guild bank (42 slots)

- [x] ✅ Deposit — `mode 0` (penya) rejected as in C++; full-bank `TID_GAME_GUILDBANKFULL` — `guildBank.service.ts:201 putItem`, refusal `:219`
- [x] ✅ Withdraw penya (`PF_PENYA`) / item (`PF_ITEM`), bag-insert before bank mutation — `guildBank.service.ts:250 getItem` → `:266 withdrawPenya` / `:304 withdrawItem` (the `:266`/`:304` cites are the two private branches, not the entry point)
- [x] ✅ Item element columns — `refine`/`element`/`element_level`/`flags`/`durability` narrowed to REQUIRED so enchants survive a round trip — `guildBank.service.ts:69-78`, hydrate `:147`
- [x] ✅ In-bank move; `objid` re-stamped to follow the slot (else the client's `GetAtId` misses) — `guildBank.service.ts:353 moveItem`, re-stamp `:372`
- [x] ✅ NPC proximity re-checked per opcode (`MMI_GUILDBANKING`), not only on open — `guildBank.service.ts:413 nearBankNpc`, open `:173 open_`
- [x] ✅ Window-open set cleared on disconnect — `guildBank.service.ts:190 onDisconnect`, `world-server/index.ts:377`
- [ ] ❌ Bank LOG viewer — `deposited_by` IS recorded so the log is reconstructible; there is no opcode or read path — `guildBank.service.ts:31-35`. **`GUILDLOG_VIEW` is a real C→S opcode** (`DPSrvr.cpp:424 OnQueryGuildBankLogList`, client `DPClient.cpp:17074`) and the emulator has **no constant for it at all** — see §23

### Guild war

- [x] ✅ Declare — 9 gates, each TID-cited; runtime-gated on `EVE_GUILDWAR` (a deliberate divergence — C++ has no gate) — `guildWar.service.ts:144 declare_`
- [x] ✅ Accept — validated against the STORED proposal (C++ `// fixme - raiders` trusts the packet) — `guildWar.service.ts:207 accept`
- [x] ✅ Enter-war fan-out + `m_idWar` stamp, re-stamped on join and after hydrate — `guildWar.service.ts:266 enterWar`, `:566 onJoin`, `:580 relinkAfterHydrate`
- [x] ✅ Surrender (`> GUILD_WAR_SURRENDER_PERCENT`; master surrender ends the war) — `guildWar.service.ts:299 surrender`, `guildWar.manager.ts:203 addSurrender`
- [x] ✅ Truce query + accept (accept validated; no REJECT opcode exists by design) — `guildWar.service.ts:337 queryTruce`, `:370 acceptTruce`, handler `guild.handler.ts:403,420`
- [x] ✅ Scoring: deaths, absence rate-normalized to 1/s, frozen roster sizes, timeout resolve (absence → deaths → draw) — `guildWar.manager.ts:124 addWar`, `:213 addDead`, `:228 addAbsent`, `:252 resolveTimeout`, `:266 isScoring`
- [x] ✅ Win-point formula + cap, loser drop floored at 0, persisted (`025_guild_war.win_point`) — `guild.manager.ts:760 applyWarResult`
- [x] ✅ PvP targeting override wired — `guildWar.service.ts:537 isWarTarget`, `combat/services/combat.policy.ts:84`, `combat.service.ts:289,381`, compose `world-server/compose.ts:991`
- [ ] 🚫 War REWARDS — nothing to port: v19 records win/lose/winPoint only, no payout path — `guildWar.service.ts:481 result`
- [ ] ❌ `SetPKTargetLimit(10)` during war — ponytail `guildWar.service.ts:513` (+ module note `:31-33`)
- [ ] ❌ Guild-war revive branch — `revival.service.ts:20`
- [ ] 🟡 Guild-level surrender counter deliberately untouched (per-member only) — `guild.manager.ts:788 addMemberSurrender`

### Guild quest arena

- [x] ✅ `MonHuntStart` entry, bound through the dialog interpreter — `guildQuest.service.ts:140 start`, binding `npc/services/scriptDlg.service.ts:826`, compose `world-server/compose.ts:936`
- [x] ✅ Arena tick: 60-min boss deadline, 20-min loot window, 10-tick presence debounce, wipe close, world-exclusive per quest id — `guildQuest.service.ts:213 tick`, `:228 onDeadline`, `:240 onRunning`, `guildQuest.manager.ts:156 open`, `:185 toGetItem`, `:195 close`, `:212 bumpScan` (manager cites were `:52,55,66,156`; the four real methods are named above)
- [x] ✅ Boss-death transition credits the QUESTING guild (divergence — C++ credits the killer's) — `guildQuest.service.ts:181 onBossKilled`
- [x] ✅ Ejection paths (`ReplaceLodestar`, `AdjustGuildQuest`) + entry pull with the `z = (z*2+y2)/3` drop — `guildQuest.service.ts:310 adjustOnEnter`, `:354 ejectFromRect`, join hook `compose.ts:588`
- [x] ✅ Ledger writes + `SNAPSHOTTYPE_SETGUILDQUEST` fan-out; `/sgq` admin ledger-only write — `guildQuest.service.ts:276 setStateByGuildName`, `:395 setQuestState`, `command.service.ts:671 setGuildQuest` (was `:679`)
- [x] ✅ Start gated on master + level 70 server-side (divergence — C++ gates only in the dialog script) — `guildQuest.service.ts:64 GUILD_QUEST_MIN_LEVEL`, checks `:143-145`
- [ ] 🚫 Quest REWARDS — nothing to port: one boss, no reward field in `GUILDQUESTPROP`, the drop table is the only payout — `guildQuest.service.ts:12-15`
- [ ] 🟡 `IsGuildQuestRegion` suppression — implemented (`guildQuest.service.ts:295 isQuestRegion` over `guildQuest.manager.ts:242 isQuestRegion` / `:224 rectAt`) and wired to exactly ONE of the C++'s eight call sites (Return scroll); blink/summon/couple-warp/`IsTeleportable` sites unported or absent — `compose.ts:1090-1093`, `inventory/services/blinkwing.service.ts:158`
- [ ] ❌ `bMasterAround` proximity filter + ride unequip on the arena pull — every online member is pulled; the ponytail (`guildQuest.service.ts:330-333`) states both need seams this service lacks (a distance query and the ride state)
- [ ] 🚫 `REMOVEGUILDQUEST` (0x00b6) never sent — the C++ fan-out is dead code — `opcodes.ts:665`, `guild.manager.ts:850 removeQuest`

### Guild chat

- [x] ✅ `/g` — TCM_BOTH text command; no C→S opcode exists in v19 — `command.service.ts:229` (table row) → `:326 guildChat`, `guild.service.ts:550 chat`, dispatcher note `clientServer.ts:195-197`
- [ ] ❌ Mute check on guild chat — `guild.service.ts:550 chat`

### Guild votes

- [ ] ❌ Guild votes — `GUILD_ADDVOTE` (`opcodes.ts:671`) and `GUILD_MODIFYVOTE` (`:674`) are declared but referenced by no source file; `selectedVoteId` is declared (`guild.manager.ts:59-60`) and only ever initialised to 0 (`:944`), never written. **NOT compiled out**: `__GUILDVOTE` is defined at `WORLDSERVER/VersionCommon.h:253,352` and `CGuildVote`/`AddVote`/`FindVote`/`ModifyVote` live at `_Common/guild.h:104,320-322`. The "compiled out of v19" claim at `guild.service.ts:24` is **wrong** and should be corrected (also contradicts memory `v19-guild-vote-compiled-out`)

### Guild house / PvP-adjacent

- [ ] 🚫 Guild house — **genuinely compiled out server-side**: `__GUILD_HOUSE` is commented out at `WORLDSERVER/VersionCommon.h:230` (client-only, `Neuz/VersionCommon.h:240`), guards at `_Common/guild.h:43,332`, `GuildHouse.h:12`. Guild-house banks (which bypass NPC proximity) out of scope — `guildBank.service.ts:34`
- [ ] ❌ Guild combat 1v1 / Secret Room (guild-vs-guild arena, tax revenue) — no code; 9+9 undeclared opcodes (§23), state field `mover.serializer.ts:221`
- [ ] ❌ Guild-party flag (`isPartyGuild` predicate exists — `guild.service.ts:637 isPartyGuild` — but party guild skills/mute do not; the party side is ponytail'd at `party.service.ts:15` "guild-party (`m_nKindTroup=1` + party name + level/exp bar …)")

### Ladder / ranking

- [ ] 🟡 Ranking — `win_point` is computed, capped and persisted (`025_guild_war.ts:14`, field `guild.manager.ts:95 winPoint`, math `:760 applyWarResult`, repo `guild.repo.ts:85`) but there is NO ranking read path, no `/ranking` command, and no leaderboard packet. **There is also no `PACKETTYPE_RANKING` in the C++ `OnMsg` table** — the C++ path is a CoreServer/DB query (`DbManager.cpp:519`, referenced in the field's own doc comment at `guild.manager.ts:92`), so this is "no packet to port, build a read path" rather than "an opcode is missing" (reworded 2026-08-13)
- [ ] ❌ `/gstat`, `/ranking`, `/dg` GM commands — §25

### Packets wired vs unhandled

- [x] ✅ 21 C→S opcodes dispatched: 16 roster/bank + 5 war — `world-server/clientServer.ts:198-228`, handler `guild/handlers/guild.handler.ts:97-420`
- [x] ✅ S→C snapshot set complete for what is ported (`GUILD`, `ALL_GUILDS`, `SET_GUILD`, authority/penya/logo/notice/contribution/`GUILD_REAL_PENYA`, bank echoes, `SETGUILDQUEST`) — `world-core/serializers/guild.serializer.ts`
- [ ] ❌ Unhandled/undeclared: `GUILD_ADDVOTE`, `GUILD_MODIFYVOTE`, `GUILDLOG_VIEW`, guild-combat 13, 1v1 guild combat 9, guild-house 7, secret-room 9 — §23/§24
- [ ] 🟥 `QUERY_PLAYER_DATA` (what the guild window asks for) still returns `{ reply: null }` — the whole service is 54 lines and its `query()` always no-replies (`world-server/services/queryPlayerData.service.ts:52`, stub note `:16-18`, ponytail `:47-49` naming what a real reply needs: the `sPlayerData` layout + per-player `nVer` tracking). The client tolerates it by keeping its cache (`Neuz/DPClient.cpp:13445`)

### Stale in-code comments to correct (docs only)

- [ ] 🟡 `guild.manager.ts:21-22` still lists bank / war / quests / salary as future phases — all four shipped
- [ ] 🟡 `guild.service.ts:24-26` claims votes are "compiled out of v19" and quests unported — quests shipped, and votes are compiled **IN**

### Admin panel

- [ ] ❌ No admin pages for any of the 4 guild tables (roster, bank, war, quest ledger) — §17. Live-ops has no way to inspect or repair a guild.

---

## 27. PETS

*New section 2026-08-12 — replaces the two-line pet pair in §8.*

**Two distinct C++ features.** `IK3_PET` = the EatPet looter (`CAIPet`,
`AIPet.cpp`). `IK3_EGG` = the system/egg pet (`CPet`, `_Common/pet.cpp/h`). Only
the first is ported.

### Looter pet (`IK3_PET`)

*All §27 citations re-read 2026-08-13 against `pet.system.ts` (401 lines),
`useItem.service.ts`, `compose.ts`, `player.ts`, `questRewards.ts` and
`flight.service.ts` at HEAD. **Every existing cite resolved to the named
construct** — like §26, this section had not rotted. Two new rows added from the
flight-gate asymmetry.*

- [x] ✅ Summon / dismiss / toggle via DOUSEITEM (`link_kind` required), flying reject `TID_CANNOT_CALL_PET_ON_FLYING` — `world-server/systems/pet.system.ts:172 toggle`, `:185 summon`, `:218 dismiss`, TID constant `:86` (= 3210, `defineText.h:2241`), routing `inventory/services/useItem.service.ts:102-110` (the `prop.item_kind3 === 'IK3_PET'` branch; rejects with a `logger.warn` when `link_kind` is absent, `:104`), seam declared `useItem.service.ts:54 togglePet?`, wired `compose.ts:1100`
- [x] ✅ Follow behaviour IDLE/TRACE/LOOT at `TICK_MS=100` (`pet.system.ts:54`), `ARRIVAL_RADIUS=5` (`:80`), `FOLLOW_TRIGGER=1` (`:83`) — driven by `:253 tick` → `:288 stepFollow`
- [x] ✅ Leash resummon (teleport catch-up) — `OWNER_LEASH=64` (`pet.system.ts:70`), checked `:263`, executed `:277 resummon`
- [x] ✅ Pile scan (`SCAN_INTERVAL_MS=1072`, `pet.system.ts:61`) via `:320 scan` + loot routed through the owner's pickup so ownership/party rules apply — `:354 stepLoot` (C++ parity: `pOwner->DoLoot(pItem)`, `AIPet.cpp:317`, quoted `pet.system.ts:30-32`)
- [x] ✅ Despawn with DEL_OBJ; owner death / logout / zone-gone cleanup — `pet.system.ts:231 onOwnerGone` → `:236 forget` → `:246 removeMover`, called from `compose.ts:1307`
- [ ] 🟡 Documented QoL divergences: `OWNER_LEASH=64` vs C++ 32 (`pet.system.ts:70`), `SCAN_RADIUS=64` vs C++ 15 (`:77`)
- [ ] 🟡 **The flight↔pet gate is one-directional** (row added 2026-08-13): summoning a pet while flying is refused (`pet.system.ts:187`), but mounting a board with a pet already out is NOT — `flight.service.ts:108` leaves C++ gate 7 (`TID_GAME_CANNOT_FLY_WITH_PET` 3209) as a ponytail, so the player simply flies away and the leash at `pet.system.ts:263` teleports the pet along. One of the two halves of a single C++ mutual exclusion
- [ ] 🟡 **Stale blocker note** (row added 2026-08-13): the flight ponytail at `flight.service.ts:28` justifies the missing gate with "no pet system" — no longer true since the looter shipped. The gate is now implementable by checking `player.m_oiEatPet !== NULL_ID`
- [ ] ❌ Buff pets — `SetItem`/`ResetItem` (`AIPet.cpp:427-457`): the item's `dwActiveSkill` and its random-option DSTs are never applied — ponytail `pet.system.ts:34-35`
- [ ] ❌ VisPet (`PET_VIS` piercing + `SNAPSHOTTYPE_VISPET_ACTIVATE`) — ponytail `pet.system.ts:35-36`; C++ `MsgHdr.h:1315`
- [ ] 🚫 `m_lRespawn` skip — reclassified 2026-08-13 from ❌: the ponytail itself explains why it is a no-op here — "our ground piles never respawn, so that pet-only `IsLoot` filter has nothing to match" (`pet.system.ts:36-37`). Nothing to port unless respawning piles arrive
- [ ] 🚫 Persistence — correct as-is: the looter has no DB state, its whole footprint is the inventory item; `m_oiEatPet` is transient by design (C++ `InactivateEatPet()` on both `Replace` `Mover.cpp:2426` and logout `User.cpp:4004`, and it is absent from `CMover::Serialize`) — `entities/src/player.ts:247-257`

### System / egg pet (`IK3_EGG`) — wholly absent

- [ ] ❌ Egg hatch → D-C-B-A-S levels (`PETLEVEL`, `MAX_PET_AVAIL_LEVEL 9`) — no code; C++ `_Common/pet.h:18`
- [ ] ❌ Pet level / exp (`MAX_PET_EGG_EXP 50000`, `MAX_PET_EXP 100000`) — C++ `pet.h:86-87`
- [ ] ❌ Feeding / hunger / life (`MAX_PET_LIFE 99`, `MAX_ADD_LIFE 5`, `USE_PET_FEED`/`MAKE_PET_FEED`) — C++ `pet.h:19,85`, `MsgHdr.h:626,630`
- [ ] ❌ Pet skills / level buffs (`PF_PET*`) — C++ `pet.h:89-92`
- [ ] ❌ Naming (`CLEAR_PET_NAME`, `SNAPSHOTTYPE_SET_PET_NAME`) — C++ `MsgHdr.h:774,1276`
- [ ] ❌ Release / resurrection / tamer miracle-mistake (`PET_RELEASE`, `QUE_PETRESURRECTION`, `PET_TAMER_*`) — C++ `MsgHdr.h:625,627-628,680`
- [ ] ❌ Persistence + pet log (`PETLOGTYPE_CALL/LEVELUP/RELEASE/DEATH/FEED/MIRACLE/MISTAKE/LIFE`, `CALL_USP_PET_LOG`) — no table, no repo; C++ `pet.h:94-101`, `MsgHdr.h:631`
- [ ] ❌ `dwPetId` still `NULL_ID` on the wire; `SNAPSHOTTYPE_PET_*` 0x0110-0x0117 unused — `world-server/net/snapshot/mover.serializer.ts:135` (layout doc `:105`), and the item-container mirror `GetPetId` at `:296` is likewise `NULL_ID`, which is what makes the equipped-pet slot invisible (`:298` notes slot-0 items use objid 0); C++ `MsgHdr.h:1199-1206`
- [ ] ❌ **No pet opcode is even declared** — `grep -c PET packages/core/src/constants/opcodes.ts` returns **0** (re-confirmed 2026-08-13; §23)
- [ ] ❌ `PetLevelup` quest reward is a no-op — it shares one `default: break;` with `SetEndRewardPKValue`/`Teleport`/`Hide`, ponytail'd at `quest/src/services/questRewards.ts:149-150`
- **Not compiled out**: `_Common/pet.h` has no version guard around the core (only `__PET_1024` sub-blocks at `:103,141,161`), and `CPet` is referenced live from `WORLDSERVER/User.cpp`, `_Database/DbManager.cpp`, `_Interface/WndPetRes.cpp`

---

## Biggest gaps, ranked (re-ranked 2026-08-12, re-tallied 2026-08-13)

**Tally at HEAD `646d159` (2026-08-13):** 323 checklist rows — **192 ✅ / 62 🟡 /
11 🟥 / 65 ❌ / 9 🚫**. The ✅ count means "passes this device's checks", never
"user-confirmed"; §20 MAIL is the only section the user has actually tested.

The 2026-08-13 pass re-verified §18-§21 and §24-§27 against live source and did
**not** change the ranking below — every rank-1..10 item is still open. What it
changed was confidence: §26 GUILD and §27 PETS were the two sections whose cites
had **not** rotted (≈60 and ≈20 cites resolving to the named construct, 4 and 0
corrections respectively), whereas §4/§15/§17 needed wholesale rewrites. Newly
added rows this pass are all 🟡 wiring-level, not new subsystems — the largest
being unbounded `logs/<id>.log` growth (§19) and the one-directional flight↔pet
gate (§27), both listed under "wiring-only wins" below.

Re-ranked 2026-08-12: **the old rank 1 (Guild) shipped** — 7 of its 9 subsystems
are built (§26), leaving only 1v1 guild combat and Guild House, which are
standalone enough to sit with the other minigames. Everything below moves up one.
Flight stays at 8; the pets rank stays narrowed to the system pet only.

1. **Lord / Election / Tax** — v19 signature player-elected Lord; controls the
   Tax rate that gates every shop cost. Entirely absent, 4 C++ files + 2 inc.
2. **Event / Live-ops** — 4 C++ source + 4 lua + 3 `.inc` unparseable; without
   it, the server cannot run any temporary event (the primary live-ops tool).
3. **Skill effect breadth** — AoE and projectile remain 🟥 (DoT, multi-hit, and
   buff skills have since shipped). `MAGIC_ATTACK` opcode declared but still
   undispatched (§23).
4. **Couple / Marriage** — opcodes + snapshots already declared (pre-stubbed),
   only dispatch + service + DB missing; couple skills + `IK3_COUPLE_BUFF` items
   + propKarma branch downstream.
5. **System pet** (egg → D-C-B-A-S) — the looter/EatPet half shipped
   (`pet.system.ts`, `439c52f`, extended by `0402ffe`); hatch, level/exp, feed,
   name, and release are absent, and `PET_RELEASE`/`USE_PET_FEED` are not even
   declared. See §27.
6. **Instance / Party Dungeon** — v19 endgame PvE; blocks `propQuest-Scenario.inc`
   + `propQuest-DungeonandPK.inc` (both ship unprocessed).
7. **Guild client-test + the last 2 guild subsystems** — the shipped 7 have
   **never been exercised by a real client**, and war/arena ship behind flags
   that default OFF (faithful to vanilla). 1v1 guild combat (9+13 opcodes) and
   Guild House (7 opcodes) are unported. See §26.
8. **Flight completion + mounts** — `FlightService` ships 🟡 (§13); what remains
   is the `HATTR_NOFLY` terrain check, the disguise-buff reject, the summoned-pet
   gate, fuel/turbo, and a real ground-mount state with its own speed model.
9. **Zone transitions / world map** — one zone ships; no REPLACE cross-world
   handoff; no terrain or speed enforcement. Also blocks cross-world blinkwing
   (§8) and cross-world revive (§7).
10. **Weight + durability decay + piercing/sockets/awakening + BeautyShop** —
    parsed/stored and consumed by nothing; durability's absence makes the shipped
    `RepairService` a no-op sink. The full item-upgrade side-channel
    (awakening/piercing/attribute-change/smelt/baruna/transy) is ~10 undeclared
    opcodes (§23).

### Newly affordable "wiring-only" wins (small effort, no new subsystem)

Re-verified 2026-08-12; all still open. Cites refreshed for `646d159`.

1. **`MAGIC_ATTACK` dispatch** — opcode declared `opcodes.ts:50` `0x00ff0011`;
   `clientServer.ts` registers only MELEE_ATTACK + RANGE_ATTACK. No handler file
   exists. Closes the last combat-path hole.
2. **Couple 4-opcode dispatch** — opcodes + snapshots already declared; service
   + repo + dispatch missing (rank-4 above).
3. **`partyQuery` wiring** — `compose.ts:461-493` `new QuestService({...})` has
   no `partyQuery` key; consumer `quest.service.ts:96,155-156` stays falsy. One-line
   fix unblocks quest party conditions.
4. **`IK3_TEXT_DISGUISE` aggro buff check** — `ai.system.ts:472-474 isHidden()`
   tests only `MODE.TRANSPARENT`; buffs shipped long ago. Call sites `:186-187,231,236`.
5. **Flee/heal AI `healCadenceMs`** — the field is now real on the entity
   (`entities/mover.ts:180,420`), but the converter emits no cadence key and
   `spawn.manager.ts` never passes one, so it always defaults to 1000 ms.
6. **Guild-cloak non-tradeable flag** — `trade.service.ts:621` ponytails this as
   blocked on guild, but `m_idGuild` is now real (`mover.serializer.ts:181-183`).
   Newly actionable.
7. **Quest guild conditions** — `questConditions.ts:44-49` still returns
   permissive constants for guild predicates although `GuildManager` exists; the
   dialog interpreter already made this jump (`dialogInterpreter.ts:345-348`).
8. **Flight's summoned-pet gate** (added 2026-08-13) — `flight.service.ts:108`
   ponytails C++ mount gate 7 (`TID_GAME_CANNOT_FLY_WITH_PET` 3209) as blocked on
   "no pet system" (`:28`), but the looter shipped: the check is
   `player.m_oiEatPet !== NULL_ID`. Today the exclusion is one-directional — pet
   while flying is refused (`pet.system.ts:187`), flying while petted is not (§27).
9. **`GuildService.destroy` has no command** (added 2026-08-13) — the service
   method exists (`guild.service.ts:158 destroy` over `guild.manager.ts:448`); the
   only thing missing for `/dg` is a router row in `command.service.ts:225-271`
   (§25).
10. **Guild bank log has no opcode constant** (added 2026-08-13) — `GUILDLOG_VIEW`
    is a real C→S packet (`DPSrvr.cpp:424 OnQueryGuildBankLogList`, client
    `DPClient.cpp:17074`) and the ledger rows are already written; nothing is
    declared in `opcodes.ts` (§23/§26).

### Fix-first shortlist (small effort, disproportionate effect)

These are *implemented but inert*, so each is a wiring or data fix rather than a
feature build. **Re-verified 2026-08-04** — 7 of 10 fixed, #6 upgraded to
mostly-fixed (flee data now threaded; only `healCadenceMs` remains):

1. ~~`shopCostRate` omitted from the `ShopService` ctor~~ — **fixed** `compose.ts:855` passes `config.world.shopCostRate`
2. `partyQuery` never supplied, so quest party conditions fail closed — **STILL BROKEN** (re-verified 2026-08-12): `compose.ts:461-493` `new QuestService({...})` has no `partyQuery`; consumer `quest.service.ts:96,155-156` stays falsy
3. ~~`CHRSTATE_BITS.SLEEP` does not exist~~ — **fixed** `entities/src/constants/dst.ts:119` `SLEEP: 0x00200000` (`CHS_SLEEPING`)
4. ~~`BANK_DEPOSIT`/`BANK_WITHDRAW` have no replayer~~ — **fixed 2026-08-02** (§16); five delta types converted to absolute rows, `BANK_SLOT`/`BANK_GOLD`/`PK_KILL` replayers added, coverage now test-guarded
5. ~~Duel does not bypass the PK-consent gate~~ — **fixed** `combat.policy.ts:61-62` duel branch (`m_nDuel===1 && m_idDuelTarget===target`)
6. Flee + self-heal AI are fully coded — **flee fixed, heal-cadence PARTIAL** (re-verified 2026-08-04): `spawn.manager.ts:204-205,365-366` now pass `fleeHpPct`/`runawayDelay` and the flee branch fires (test `ai.system.test.ts:574`); only `healCadenceMs` is still unthreaded — `converters/movers.ts:223-224` emits no cadence field and `mover.ts:420` defaults to 1000 ms
7. ~~`dwReAttackDelay` reads propMover col 34 instead of col 35~~ — **fixed** `converters/movers.ts:177` reads `dwReAttackDelay` (col 35)
8. ~~Blocklist `setBlocked` has no calling opcode~~ — **fixed** `social/handlers/friend.handler.ts:157` → `friend.service.ts:305`
9. ~~Movement is not stun-gated~~ — **fixed** `movement.service.ts:92,111,123,145,165,181` all check `isStunned()`
10. `IK3_TEXT_DISGUISE` aggro check — **STILL BROKEN** (re-verified 2026-08-05): `combat/systems/ai.system.ts:469-471` `isHidden()` tests only `MODE.TRANSPARENT`, no buff check (the "when buffs ship" precondition was met long ago)
11. ~~USESKILL cast-range validation~~ — **fixed 2026-08-04** (§2): reads the base `attackRange` AR_* enum via `getAttackRange`, not the per-level AoE `skillRange`

---

## Re-verification changelog (2026-08-13)

Citation-hardening pass over `646d159`. **No production code changed, no files
created.** Method: grep each construct's declaration and every `ponytail:` marker
out of live source, then write the cite back with the construct name attached
(`:158 destroy`) so a future refactor produces a detectable mismatch instead of
silent drift. Sections covered: §4, §15, §17, §18, §19, §20, §21, §24, §25, §26,
§27, plus the ranked-gaps tally.

### Corrections of substance (a reader acting on the old row would have been misled)

- **§24 BeautyShop was a *wrong-cause* row** — it named the right gap but blamed
  `characterInc.loader.ts:32-45 MMI_FALLBACK` for parsing `MMI_BEAUTYSHOP` to
  `undefined`. False: `:545` builds the full map with
  `parseDefines(decode(mmiBuf),'MMI_')` from the real `defineNeuz.h` and `:300`
  resolves `AddMenu(MMI_*)` through it; `MMI_FALLBACK` is only the header-absent
  fallback. The ids land in `menus` correctly — what is missing is a **service**.
  Corrected in place, naming the false claim.
- **§25 slash-command entry count was wrong** — "47 entries" vs the actual **43**
  (exact `{ names: [` count, `command.service.ts:225-271`). The 75-name figure and
  the 43-ported/119-missing split were right.
- **`/dg` cited a method that does not exist** — `GuildService.disband`; the real
  name is **`destroy`** (`guild.service.ts:158` over `guild.manager.ts:448`).
  Corrected in §25 and §26.
- **§26 RANKING implied a missing opcode** — there is no `PACKETTYPE_RANKING` in
  the C++ `OnMsg` table at all; the C++ path is a CoreServer/DB query
  (`DbManager.cpp:519`). Reworded to "no packet to port, build a read path".
- **§27 `m_lRespawn` reclassified ❌ → 🚫** — the ponytail itself explains it is a
  no-op here ("our ground piles never respawn", `pet.system.ts:36-37`).

### New rows added

- ✅ Constant-time supervisor token compare — `supervisor-shared.ts:191 tokensMatch`
- ✅ On-disk child logs — `supervisor-daemon.ts:114`, `:200` stream to `logs/<id>.log`
- 🟡 Those files grow **unbounded** (append-only, no cap or rollover) and the UI can
  only read the 500-line in-memory ring, never the file (§19)
- 🟡 The flight↔pet exclusion is **one-directional** — pet-while-flying refused
  (`pet.system.ts:187`), flying-while-petted not (`flight.service.ts:108`) (§27)
- 🟡 Stale blocker note: `flight.service.ts:28` still says "no pet system" (§27)

### Confidence signal

**§26 GUILD and §27 PETS are the two sections whose cites had not rotted** — ≈60
and ≈20 cites resolved to the named construct, needing 4 and 0 corrections. Both
were written 2026-08-12. §4/§15/§17/§18/§19/§21/§24 (older) needed rewrites. Rule
of thumb: a section older than ~2 weeks of active development should be treated as
unverified until re-grepped.

### Cite drift corrected (mechanical, no meaning change)

§18: ponytail `:23`→`:22`; `world-server/index.ts:238`→`:262`. §19: `LogHub`
`:125`→`:128`; log-line `:48/:74/:81`→`:46 parseLogLine`/`:75 FILTERABLE`/`:82
passesLevel`. §20: dispatch `:244-248`→`:305-309`; `syncMailboxMode` `:143`→`:150`.
§21: `017_presence_and_mail.ts:39`→`:40`; presence `:149/:267/:355-364`→
`:152/:280/:377`; boot cleanup `compose.ts:300`→`:355-360`. §24: `dwPetId`
`:136`→`:135`. §26: `command.service.ts:334`→`:333 createGuild`; `:679`→`:671
setGuildQuest`; `guildQuest.manager.ts:52,55,66,156`→`:156 open`/`:185
toGetItem`/`:195 close`/`:212 bumpScan`; `guildQuest.service.ts:335`→`:354
ejectFromRect`.

### Still open after this pass

- Four **stale in-code comments** (docs-only, tracked as rows): `guild.manager.ts:21-22`
  (bank/war/quests/salary listed as future — all four shipped); `guild.service.ts:24-26`
  (claims votes compiled out — they are compiled **IN**); `recovery.system.ts:12-13`
  ("no party system yet"); `command.service.ts:40` ("`/g` needs guild").
- Memory `v19-guild-vote-compiled-out` is **wrong** and needs updating: `__GUILDVOTE`
  is defined at `WORLDSERVER/VersionCommon.h:253,352` and `CGuildVote`/`AddVote`/
  `FindVote`/`ModifyVote` live at `_Common/guild.h:104,320-322`.
- `docs/missing-features-audit.md` (218 lines) still unexamined — decide whether it
  is redundant with this file and `docs/FEATURE-STATUS.md`.
- Two stray gitignored `bash.exe.stackdump` files in `packages/guild/src/managers/`
  and `packages/database/src/migrations/`.

---

## Re-verification changelog (2026-08-12)

Full re-verify against master `646d159` (build 19/19 green, `pnpm -r test` green
at the time of the sweep). No production code changed — this pass corrects the
checklist and adds two sections for subsystems that shipped without tracking.

**New sections**
- **§26 GUILD** — `packages/guild` (9 files / ~3.9k lines, 2 managers, 5
  services, 1 handler; migrations 023-026; 21 C→S opcodes at
  `clientServer.ts:198-228`). 7 of 9 guild subsystems are built: roster, ranks +
  authority mask, contribution + guild level, the 21:00 salary sweep, the 42-slot
  bank, war, and the boss arena. Remaining: 1v1 guild combat and Guild House.
  **None of it has been client-tested.**
- **§27 PETS** — splits the two C++ features that the old §8 pair conflated:
  `IK3_PET` (EatPet looter, `CAIPet`) is ported; `IK3_EGG` (system pet, `CPet`)
  is wholly absent and **not a single pet opcode is declared**.

**Status changes**
- §1 arrow / ammunition consumption 🚫 N/A → ✅ (`AmmoService` exists and is wired)
- §15 guild ❌ "largest unstarted system" → ✅, body moved to §26
- §15 `/g` guild chat ❌ → ✅ (`command.service.ts:321-329`; no C→S opcode exists in v19)
- §16 blocklist 🟡 → ✅ (`friend.service.ts:305 toggleBlock`, dispatched `clientServer.ts:291`)
- §24 Guild Banking ❌ → ✅; the guild sub-tree is now 7 of 9

**Counts corrected**
- ponytail census **164 markers / 85 files → 179 / 94**
- dispatched C→S opcodes **112 → 144 unique** across the three dispatchers. The
  old "~228 C++ opcodes, ~156 missed" denominator was wrong on both baselines:
  C++ `ON_MSG` is 300 (110 login/cluster, 190 world) and client send sites are
  307 (120/187). ~163 remain unrouted.
- slash commands **43 of 162 server-side ported** (119 missing); the player tier
  is 4 of 25, not 3
- §1-22 tally **✅ 143 · 🟡 41 · ❌ 22 · 🟥 6 · 🚫 3 → ✅ 145 · 🟡 40 · ❌ 21 · 🟥 6 · 🚫 2**

**Re-ranked**
Guild leaves rank 1 (shipped); everything below moves up one. Lord/Election/Tax
is now rank 1, Event/live-ops rank 2. A new rank 7 tracks the guild client-test
plus the last two guild subsystems.

**Two C++ facts corrected**
- Guild **votes are NOT compiled out** of v19: `__GUILDVOTE` is defined at
  `WORLDSERVER/VersionCommon.h:253,352` and `CGuildVote`/`AddVote`/`FindVote`/
  `ModifyVote` are at `_Common/guild.h:104,320-322`. The comment at
  `guild.service.ts:24` and memory `v19-guild-vote-compiled-out` are both wrong.
- **Guild House IS compiled out** server-side: `__GUILD_HOUSE` is commented out
  at `WORLDSERVER/VersionCommon.h:230` (client-only at `Neuz/VersionCommon.h:240`).

**Re-confirmed still open** (each was checked at HEAD, not carried forward)
`MAGIC_ATTACK` declared (`opcodes.ts:50`) with no handler file · `partyQuery`
absent from the `QuestService` ctor (`compose.ts:461-493`) · `isHidden()` tests
only `MODE.TRANSPARENT` (`ai.system.ts:472-474`) · couple 4-opcode dispatch
absent · `healCadenceMs` never threaded from the converter.

**Stale in-code comments found (not yet edited)**
`guild.manager.ts:21-22` lists bank/war/quests/salary as future phases · 
`guild.service.ts:24-26` claims votes compiled out and quests unported ·
`recovery.system.ts:12-16` says "no sit state or party system yet" though party
shipped.

---

## Re-verification changelog (2026-08-05)

Spot re-verify against master `b54ee36` — **38 entries sampled** across all 25
sections (one read-only pass, `file:line` evidence per verdict), weighted toward
🟡/🟥/❌ rows plus ✅ rows in sections the last 15 commits touched. No code
changed; this pass only corrects the checklist.

**Claims that flipped ❌/🟥/🟡 → ✅ (8):**
- **Flying** 🟥→🟡 (§13). `world-core/services/flight.service.ts` shipped in
  `438b248`: `OBJSTAF.FLY` set/clear, real reject TIDs, `PARTS_RIDE` entry via
  `equip.service.ts:158,199,232`, wired `compose.ts:760-821`. Demoted from
  biggest-gaps rank 2 to rank 8.
- **PLAYERANGLE** 🟥→✅ (§12). `applyAngle` is real — rejects `!isFly()`, else
  sets `m_fAngleX` and broadcasts (`movement.service.ts:188-193`).
- **Peer buff list** 🟡→✅ (§3, §12). `writeEmptyBuffs` deleted in `1c39895`;
  `writeBuffs` (`mover.serializer.ts:75-83`) serves both mover paths.
- **`DST.SLEEP` type bug** 🟡→✅ (§3). `entities/src/constants/dst.ts:121`
  `SLEEP: 0x00200000`.
- **Movement stun gate** 🟡→✅ (§3). All 6 paths check `isStunned()`.
- **Duel bypasses the PK gate** ❌→✅ (§6). Duel branch present in
  `combat.policy.ts` `isPlayerAttackableBy`.
- **Party persistence** → ✅ (§5). Migration `022_parties.ts` + `party.repo.ts`
  + `party.manager.ts:189-213 hydrate` (`b3c4e41`); the "in-memory only" framing
  is gone.
- **Party level / exp bar** ❌→✅ (§5), `e88927f`.

**Shipped but previously untracked, now added (6):** `FlightService` (§13);
looter/EatPet pet system `pet.system.ts` (§8, `439c52f`) — split from the still-
absent egg→S system pet; blinkwing scrolls `blinkwing.service.ts` (§8,
`12eb53b`); DOUSEITEM pet/blinkwing routing + double-click unequip (§8,
`891f68d`); monster swings reading player gear (§4, `501b21c` — the contradicted
row is retired); `shopCostRate` ctor wiring (§9, now `compose.ts:942`).

**Narrowed, not flipped:** the §4 healer row — `healHpPct`/`healAmount` **are**
threaded now, so only `healCadenceMs` and ally-heal remain.

**Confirmed still open (17):** skill AoE 🟥, projectile skills 🟥, durability
decay, item weight, piercing/sockets, `DiePenalty.inc` loader, cross-world
REPLACE, `QUERY_PLAYER_DATA` 🟥, one-zone, map-key accept-all, monster-movement
vicinity relink, dialog binding constants, `partyQuery` unwired,
`IK3_TEXT_DISGUISE` aggro check, `@flyff/gateway` orphan, char-delete second
factor, job-tier server/panel disagreement.

**Counts corrected:** `ponytail:` markers 157/82 files → **164 across 85 files**;
routed C→S opcodes 101 → **112** (`grep -c "dispatcher.register"`), so §23's miss
count drops ~167 → ~156 — the 11 new registrations are 6 × PVENDOR, `BLOCK`,
`PLAYERBEHAVIOR2`, `STATEMODE`, `SFX_ID`, `SFX_HIT`. The §1-22 tally was also
**recounted mechanically** rather than adjusted by hand: ✅ 127→**143**,
🟡 45→**41**, ❌ 22→**22**, 🟥 8→**6**, 🚫 4→**3**. The ✅ jump is mostly the
recount catching rows the previous hand-tally missed, not 16 new features.

**Paths corrected (3, files moved in the world-server carve-out):**
`movement.service.ts` → `packages/world-server/src/services/`;
`combat.policy.ts` → `packages/combat/src/services/`;
the `scriptDlg.service.ts` binding-stub citation `:575` → `:742-748`.

**Still unresolved:** the `MOVEBANKITEM` caveat (§23) — the C++ handler body was
not inspected this pass, so neither claim is trustworthy yet.

**Nothing in this changelog is user-confirmed.** Every ✅ above means "passes
this device's checks"; the override rule stands.

---

## Re-verification changelog (2026-08-04)

Spot re-verify of 10 claims in §1-2 and the fix-first shortlist against live
code (one read-only explorer, file:line evidence per verdict), plus the
cast-range fix landed the same day.

**Upgrades ❌/🟡 → ✅ (3):**
- **Cast-range validation** ❌→✅ (§2). Ported `CMover::GetAttackRange`
  (`MoverMsg.cpp:140-166`) as `entities/constants/attackRange.ts`; gate at
  `skill.service.ts:350` (was `:326-340` when written; re-cited 2026-08-12). Note the intermediate bug: `812bf3f` gated on the
  per-level `skillRange`, which is the **AoE radius** (`Ctrl.cpp:268/432/752`),
  not cast reach — Heal was capped at 6 m instead of AR_WAND's 15 m. Both fields
  are now documented in `skill.schema.ts` to stop the confusion recurring.
- **Debuff proc roll** 🟡→✅ (§1). The `effectProc` roll from
  `skillFormulas.ts:321` is enforced at `skill.service.ts:389` (was `:376` when
  written; re-cited 2026-08-12); fixed in
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

