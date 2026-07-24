# Flyff v15 — Missing Features Checklist

Generated 2026-07-23 from a full-source sweep (3 parallel domain maps + every
`ponytail:` comment). Re-verified 2026-07-24 against live code (3 parallel
explorers, 57 items audited). Compares the emulator against full retail v15.

**Status legend**
- ✅ DONE — implemented + passing on this device's checks (NOT user-confirmed)
- 🟡 PARTIAL — core path works, sub-features/edge-cases stubbed
- 🟥 STUB — code exists but does nothing meaningful (charge consumed, no effect)
- ❌ MISSING — no code path at all

**Override rule:** ✅ here = "passes my checks", never "fixed". Only the user
declares a feature fixed by testing on a real v15 client.

---

## 1. COMBAT

### Melee
- [x] ✅ Hit-rate roll (player→NPC, NPC→player, PvP branches) — `combat/formulas.ts:183`
- [x] ✅ Crit (flat 2.3×) + DST_CHR_CHANCECRITICAL — `formulas.ts:150,256`
- [x] ✅ Block factor (NPC + player defender) — `formulas.ts:285`
- [x] ✅ DEF subtract, element factor, level-diff falloff — `formulas.ts:200,252,212`
- [x] ✅ ATK from weapon + DST_CHR_DMG/ATKPOWER/ATKPOWER_RATE + refine — `formulas.ts:115`
- [ ] 🟡→impl Equip→stat projection — element string→enum (`elementFromName`), refine→option decode, jewelry HR/ER, atkSpeed. Build+tests green, awaiting user test — `equipStats.ts`
- [ ] 🟡→impl Targeting policy — `MI_CHAOGUARDIAN` inverse (`m_bChaoGuard`) + `RANK_GUARD`. Build+tests green, awaiting user test. (flying-mismatch deferred — no mount/flight subsystem) — `combat.policy.ts`

### Ranged / bow
- [x] ✅ Bow damage curve (STR/DEX) — `formulas.ts:109`
- [x] ✅ NPC ranged attack (RANGE_ATTACK emit, re-attack delay) — `ai.system.ts:222` (re-verified 2026-07-24)
- [x] ✅ Player ranged auto-attack as a distinct path — `rangeAttack.handler.ts`, `rangeAttack.service.ts` (re-verified 2026-07-24)
- [ ] ❌ Ammo / arrow consumption — v15 retail bows are ammo-less by design; no arrow item kind in propItem. Only relevant for later-version quivers.

### Magic / skill damage
- [x] ✅ Single-target skill damage (melee + magic, element, magic-factor) — `skillFormulas.ts`
- [ ] 🟡→impl Skill crit (DEX×fCritical, 2.3×, AF_CRITICAL1) — reuses melee CalcDamage branch; build+tests green, awaiting user test — `skillFormulas.ts` (re-verified 2026-07-24)
- [ ] 🟡→impl Debuff/secondary-effect gate (nProbability roll — stun/poison) — `effectProc` surfaced, not yet applied (needs status system) — `skillFormulas.ts` (re-verified 2026-07-24)
- [ ] 🟥 AoE (area skills) — `skillFormulas.ts`
- [ ] 🟥 DoT (damage-over-time) — `skillFormulas.ts`
- [ ] 🟥 Multi-hit skills — `skillFormulas.ts`
- [ ] 🟥 Projectile skills — `skillFormulas.ts`
- [x] ✅ Heal skills (RT_HEAL → DST_HP restore, self/other target) — `skill.service.ts:232` (re-verified 2026-07-24)
- [ ] 🟥 Buff skills (DST buff apply — dwDestParam=0 special-case, not data-driven) — `skill.service.ts:181`
- [ ] ❌ PvP skill damage vars (skill path skips `getDamageMultiplier`) — `skillFormulas.ts`

---

## 2. SKILLS

- [x] ✅ USESKILL cast handler — `skills/handlers/useSkill.handler.ts`
- [x] ✅ DOUSESKILLPOINT learn handler — `skills/handlers/doUseSkillPoint.handler.ts`
- [x] ✅ Cooldowns (`m_tmReUseDelay[45]`) — `skill.service.ts:137`
- [x] ✅ Skill learning (SP spend, tier cost, prereqs, no-decrease) — `skill.service.ts:260`
- [x] ✅ Skill points granted on level-up — `combat.service.ts:285`
- [x] ✅ MP/FP consume on cast (routed by KT; gated before spend) — `skill.service.ts:154,191` (re-verified 2026-07-24)
- [ ] 🟡 Damage + heal cast (EXT_MELEEATK / EXT_MAGICATKSHOT / RT_HEAL); buff/AoE/auto-attack missing — `skill.service.ts:179`
- [ ] ❌ Job-match gate on learn — `skill.service.ts:260`
- [ ] ❌ WAL `SKILL_LEARN` journal type + replayer (crash-safe learn) — `skill.service.ts:304`

---

## 3. BUFF / DEBUFF / STATUS EFFECTS

- [ ] ❌ Timed buff container + expiry timers — no code anywhere
- [ ] ❌ DST buff apply/expire (skill buffs; equip DST exists, buffs don't) — `skill.service.ts:181`
- [ ] 🟥 Buff-grant consumable items (charge consumed, no effect) — `useItem.service.ts:78`
- [ ] ❌ Status: stun (only `AF_STUN` flag constant exists)
- [ ] ❌ Status: poison
- [ ] ❌ Status: slow
- [ ] ❌ Status: sleep / stone / other CC
- [ ] ❌ Buff clear on death/revive — `revival.service.ts:171`
- [ ] ❌ `IK3_TEXT_DISGUISE` buff check in AI aggro — `ai.system.ts:355`

---

## 4. MONSTER AI

- [x] ✅ FSM idle/wander/aggro(RAGE)/pursue/return-home — `ai.system.ts`
- [x] ✅ Leashing (RAGE_LEASH 150m + damage-pos 120m) — `ai.system.ts`
- [x] ✅ Retaliation on hit (triggerRage) — `combat.service.ts:174`
- [x] ✅ Spawn + respawn timers (static NPC never respawns) — `spawn.manager.ts`
- [ ] 🟡 Aggro — single-slot target (`m_idTarget`), no aggro table — `mover.ts:232`
- [ ] ❌ Flee / low-HP retreat state — `ai.system.ts`
- [x] ✅ Ranged monster AI (holds at range, RANGE_ATTACK, re-attack cadence) — `ai.system.ts:209` (re-verified 2026-07-24)
- [ ] ❌ Healer monster AI — `ai.system.ts`
- [ ] ❌ Flight-capable monster AI
- [ ] ❌ Collision-aware stuck-teleport (return-home has a 20s time cap only, no pathing) — `ai.system.ts:285`
- [ ] 🟡 Per-mover `dwReAttackDelay` (field read; default 2000ms until resource col 35 exports) — `entities/constants/aiConstants.ts:42`
- [ ] 🟡 Return-home HP restore deviation from C++ StateReturn (deliberate: no S→C monster-HP-sync packet) — `ai.system.ts:290`

---

## 5. PARTY / EXP-SHARE

- [ ] ❌ Party invite / accept / leave / kick
- [ ] ❌ Party UI / member list snapshot
- [ ] 🟥 Party EXP sharing (combat grantExp is single-attacker; `m_idEnemies` tallies damage but unused) — `mover.ts:249`
- [ ] ❌ Party loot-share + FFA timeout — `loot.service.ts:172`
- [ ] ❌ `/p` party chat channel — `command.service.ts:37`

---

## 6. PvP / PK

- [ ] ❌ Player-vs-player targeting (explicitly out of scope) — `combat.policy.ts:27`
- [ ] 🟡 `nChaotic`/isChaotic (isChaotic() exists, `m_dwPKPropensity` defaults 0, never set) — `player.ts:219,411`
- [ ] 🟡 PvP damage vars (melee branch 0.60 factor exists; skill path + PK penalties missing) — `skillFormulas.ts:255`
- [ ] ❌ Chaotic/PK revive (different HP rate + PK town) — `revival.service.ts:20`
- [ ] ❌ Guild-war revive — `revival.service.ts:21`

---

## 7. DEATH / REVIVAL

- [x] ✅ Monster death (MOVERDEATH, exp, drops, quest, remove) — `combat.service.ts:193`
- [x] ✅ Player death (dead flag, MOVERDEATH, ACTMSG STOP+DIE) — `revival.service.ts`
- [x] ✅ Revival (scroll in-place, lodestar town + exp penalty) — `revival.service.ts`
- [ ] ❌ Other-player resurrection skill — `revival.service.ts:22`
- [ ] ❌ DiePenalty.inc real table loader (hardcoded bracket) — `entities/math/exp.ts:81`
- [ ] ❌ 5s dead lockout (`m_nDead`) — `revival.service.ts:22`
- [ ] ❌ Cross-world revive REPLACE teleport snapshot — `revival.service.ts:193`

---

## 8. INVENTORY / ITEMS

- [x] ✅ Add/stack/remove/move (swap)/consume/drop — `inventory.service.ts`
- [x] ✅ Gold spend/add/drop (MAX_GOLD clamp) — `inventory.service.ts:187`
- [x] ✅ Equip/unequip (server-authoritarian slot, swap, level_req) — `equip.service.ts`
- [x] ✅ DST stat-bonus apply/remove on equip/unequip — `equip.service.ts:89`
- [ ] ❌ Weight / overweight enforcement (field exists, unused) — `resources/schemas/item.schema.ts:134`
- [ ] 🟡 Jewelry HR/parry (partial; effects via DST) — `equipStats.ts:86`
- [x] ✅ Potion / food consumables (full effect via consumableService) — `useItem.service.ts:65`
- [ ] 🟥 Buff/skill/warp/text usable items (charge consumed, no effect) — `useItem.service.ts:78`
- [ ] ❌ Set-item bonuses (`set_id` field exists, no logic) — `resources/schemas/item.schema.ts:212`

### Item enhancement
- [ ] 🟡 Refine level storage + combat read (no refine ACTION) — `equipStats.ts:87`
- [ ] ❌ Refine / upgrade scroll + anvil action + opcode — none
- [ ] ❌ Enchant action + opcode (element fields exist, no apply path)
- [ ] ❌ Piercing / sockets (zero-placeholder writes only) — `inventory/net/snapshot/itemSnapshot.serializer.ts:40`
- [ ] 🟡 Elements stored + combat-read; no element-apply action — `equipStats.ts:74`

---

## 9. NPC / SHOP / BANK

- [x] ✅ Shop open/close/buy/sell (gold-clamped, anti-cheat) — `shop.service.ts`
- [x] ✅ Bank/warehouse open + pin + changepass (account-shared, 3 tabs) — `bank.service.ts`
- [x] ✅ Bank item deposit/withdraw — `bank.service.ts:108`
- [ ] 🟡 Bank gold tab 0 only; per-tab gold (tabs 1/2) — `bank.service.ts:161`
- [ ] 🟡 NPC dialog — Speak/LaunchQuest + menu; advanced `source` bodies not ported — `scriptDlg.service.ts:13`
- [ ] ❌ Shop cost multiplier / event buy factor / perin fixed-price — `shop.service.ts:89`

---

## 10. TRADE / VENDING

- [ ] ❌ Player-to-player trade (no TRADE/EXCHANGE opcode/handler)
- [ ] ❌ Vending / private shop (no OPENSTORE/VENDING opcode/handler)

---

## 11. QUEST

- [x] ✅ Accept/begin + canBegin — `quest.service.ts:152`
- [x] ✅ Tracking (kill/patrol/time) — `questTracker.system.ts`
- [x] ✅ Cancel / removeAll / removeComplete / check — `quest.service.ts:209`
- [ ] 🟡 Begin conditions — party/guild stubbed permissive — `questConditions.ts:133`
- [ ] 🟡 End conditions — party/guild/state/completeQuest stubbed permissive — `questConditions.ts:196`
- [ ] 🟡 Rewards — gold/exp/item done; PK/Teleport/Hide/PetLevelup no-op — `questRewards.ts:134`
- [ ] 🟡 No level-up SETEXPERIENCE/SETLEVEL broadcast on quest reward — `questRewards.ts:170`
- [ ] 🟡 Dialog-driven turn-in — sweep exists, real EndQuest `source` body not ported — `scriptDlg.service.ts`

---

## 12. MOVEMENT / ZONES / WORLD

- [x] ✅ Walk/run apply + broadcast + anti-teleport guard — `movement.service.ts`
- [x] ✅ GM teleport `/te` (same-world SETPOS) — `command.service.ts:254`
- [ ] 🟥 PLAYERANGLE accepted + dropped (no effect; flight-dependent) — `movement.service.ts:128`
- [ ] ❌ Collision / terrain check (only distance anti-cheat)
- [ ] ❌ Player run/walk speed enforcement
- [ ] 🟡 Multi-zone (buckets exist; ships one zone per world) — `zone.manager.ts:17`
- [ ] ❌ Zone transitions / cross-world transfer (REPLACE handoff not wired)
- [ ] ❌ World map
- [ ] 🟡 Map key accept-all (no manifest) — `mapKey.service.ts:40`
- [ ] 🟡 Vicinity radius query (`playersNear` exists; not used for streaming — whole-zone burst) — `zone.manager.ts:91`
- [ ] 🟡 NPC/mob ADD_OBJ one-shot full-zone on MAP_KEY; no enter/leave streaming — `vicinity.service.ts:46`
- [ ] ❌ Player-to-player ADD_OBJ on join (broadcastEnter) — `join.handler.ts:109`

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
- [ ] 🟡 Delete — account-ownership only, not 2nd-factor delete key — `charCreate.service.ts:126`
- [ ] ❌ Job / class change 1st→2nd (JOB_TABLE data exists, no CHANGEJOB handler) — `entities/tables/job.ts`

---

## 15. SOCIAL

- [x] ✅ Normal/say chat (vicinity) — `chat.service.ts`
- [x] ✅ Shout (server-wide via PlayerManager.all) — `command.service.ts:231` (re-verified 2026-07-24)
- [x] ✅ Whisper (direct to target) — `command.service.ts:205` (re-verified 2026-07-24)
- [ ] ❌ Party / guild / trade chat channels — `command.service.ts:37`
- [ ] ❌ Guild system (opcode defined, no handler; mover writes zero guild fields)
- [ ] ❌ Friend list / blocklist (client opens windows, reply is stub) — `queryPlayerData.handler.ts:8`
- [ ] 🟡 Motion / emote broadcast (verbatim, no OBJMSG validation) — `motion.service.ts`
- [ ] 🟡 Sit / rest (behavior frame accepted; no recovery multiplier, no sit state) — `recovery.system.ts:12`
- [ ] 🟡 Taskbar bindings stored; applet + skill-queue grids no handlers — `taskbar.service.ts`

---

## 16. INFRA / PERSISTENCE (mostly done — listed for completeness)

- [x] ✅ Login/auth (argon2id, ban, session token) — `auth.service.ts`
- [x] ✅ Char-select → world handoff (HMAC IPC) — `handoffPublisher.ts` / `clusterListener.ts`
- [x] ✅ Server / world list — `serverList.service.ts` / `worldList.service.ts`
- [x] ✅ WAL journal + boot replay (idempotent; BANK_DEPOSIT/WITHDRAW journaled but no replayer registered) — `journalReplayer.ts:52`
- [x] ✅ 30s checkpoint DB sync + dirty flags — `checkpoint.system.ts:42`
- [ ] 🟡 argon2id ships stub hash in dev (ceiling: real argon2 in prod) — `password.ts:15`

---

## Biggest gaps, ranked (net-new systems, not sub-features)

1. **Buff/debuff + status-effect system** — blocks: buff skills, buff items,
   CC (stun/poison/slow/sleep), disguise, buff-clear-on-death, debuff-skill
   `effectProc` application. Foundational — the magic debuff gate already
   computes the proc, it just has nowhere to fire.
2. **Party system** — blocks: party EXP, party loot, party chat, party quests.
3. **Skill effect breadth** — AoE/DoT/multi-hit/projectile + buff skills.
4. **Social** — guild, friend/block, party/guild/trade chat.
5. **Flying + mounts** — signature Flyff mechanic, entirely absent.
6. **Player trade + vending** — core economy loop.
7. **Item enhancement actions** — refine/upgrade/enchant/socket (storage exists,
   no action opcodes).
8. **Job change (1st→2nd)** — data exists, no handler.
9. **Zone transitions / collision / world map.**
10. **Set-item bonuses, weight, PvP loop.**

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
