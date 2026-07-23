# Flyff v15 — Missing Features Checklist

Generated 2026-07-23 from a full-source sweep (3 parallel domain maps + every
`ponytail:` comment). Compares the current emulator against full retail v15
feature scope.

**Status legend**
- ✅ DONE — implemented + working on this device's checks (NOT user-confirmed)
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
- [ ] 🟡→impl Equip→stat projection — element string→enum (`elementFromName`) added; refine→option decode, jewelry HR/ER, atkSpeed (raw dwAttackSpeed; no per-type table in C++) already correct. Build+tests green, awaiting user test — `equipStats.ts`
- [ ] 🟡→impl Targeting policy — `MI_CHAOGUARDIAN` inverse (`m_bChaoGuard`) added alongside `RANK_GUARD`. Build+tests green, awaiting user test. (flying-mismatch deferred — no mount/flight subsystem exists) — `combat.policy.ts`

### Ranged / bow
- [x] ✅ Bow damage curve (STR/DEX) — `formulas.ts:109`
- [ ] 🟡 NPC ranged attack (RANGE_ATTACK emit, re-attack delay) — `ai.system.ts`
- [ ] 🟡→impl Player ranged auto-attack distinct path — `RANGE_ATTACK` (0x00ff0012) handler+service added; RANGE snapshot echo (idSfxHit from HIWORD nParam3), damage via shared `resolveAttack` (bow curve already keyed off `WT_RANGE_BOW`). Build+tests green (combat 102/0), awaiting user test — `rangeAttack.handler.ts`, `rangeAttack.service.ts`
- [x] N/A Ammo / arrow consumption — v15 retail bows are ammo-less; no arrow item kind in propItem. Documented in `rangeAttack.service.ts`, nothing to consume.

### Magic / skill damage
- [x] ✅ Single-target skill damage (melee + magic, element, magic-factor) — `skillFormulas.ts`
- [ ] 🟡→impl Skill crit (DEX×fCritical, 2.3×, AF_CRITICAL1) — reuses melee CalcDamage branch; build+tests green, awaiting user test — `skillFormulas.ts`
- [ ] 🟡→impl Debuff/secondary-effect gate (nProbability roll — stun/poison) — `effectProc` surfaced, not yet applied (needs status system) — `skillFormulas.ts`
- [ ] 🟥 AoE (area skills) — `skillFormulas.ts`
- [ ] 🟥 DoT (damage-over-time) — `skillFormulas.ts`
- [ ] 🟥 Multi-hit skills — `skillFormulas.ts`
- [ ] 🟥 Projectile skills — `skillFormulas.ts`
- [ ] 🟥 Heal / buff skills — `skillFormulas.ts`, `skill.service.ts`
- [ ] ❌ PvP skill damage vars — `skillFormulas.ts`

---

## 2. SKILLS

- [x] ✅ USESKILL cast handler — `skills/handlers/useSkill.handler.ts`
- [x] ✅ DOUSESKILLPOINT learn handler — `skills/handlers/doUseSkillPoint.handler.ts`
- [x] ✅ Cooldowns (`m_tmReUseDelay[45]`) — `skill.service.ts:137`
- [x] ✅ Skill learning (SP spend, tier cost, prereqs, no-decrease) — `skill.service.ts`
- [x] ✅ Skill points granted on level-up — `combat.service.ts:284`
- [ ] 🟡 Damage-cast only (EXT_MELEEATK / EXT_MAGICATKSHOT); heal/buff/AoE/auto-attack missing — `skill.service.ts:11`
- [ ] 🟡 MP/FP consume on cast; real FP regen/spend model missing — `player.ts:280`
- [ ] ❌ Job-match gate on learn — `skill.service.ts:11`
- [ ] ❌ WAL `SKILL_LEARN` journal type + replayer (crash-safe learn) — `skill.service.ts:304`

---

## 3. BUFF / DEBUFF / STATUS EFFECTS

- [ ] ❌ Timed buff container + expiry timers — no code anywhere
- [ ] ❌ DST buff apply/expire (skill buffs; equip DST exists, buffs don't) — `skill.service.ts:116`
- [ ] ❌ Buff-grant consumable items (charge consumed, no effect) — `useItem.service.ts:78`
- [ ] ❌ Status: stun (only `AF_STUN` flag constant exists)
- [ ] ❌ Status: poison
- [ ] ❌ Status: slow
- [ ] ❌ Status: sleep / stone / other CC
- [ ] ❌ Buff clear on death/revive — `revival.service.ts:173`
- [ ] ❌ `IK3_TEXT_DISGUISE` buff check in AI aggro — `ai.system.ts:355`

---

## 4. MONSTER AI

- [x] ✅ FSM idle/wander/aggro(RAGE)/pursue/return-home — `ai.system.ts`
- [x] ✅ Leashing (RAGE_LEASH 150m + damage-pos 120m) — `ai.system.ts`
- [x] ✅ Retaliation on hit (triggerRage) — `combat.service.ts:174`
- [x] ✅ Spawn + respawn timers (static NPC never respawns) — `spawn.manager.ts`
- [ ] 🟡 Aggro — single-slot target, no aggro table — `mover.ts:232`
- [ ] ❌ Flee / low-HP retreat state — `ai.system.ts`
- [ ] ❌ Ranged / healer monster AI — `ai.system.ts:28`
- [ ] ❌ Flight-capable monster AI
- [ ] ❌ Collision-aware stuck-teleport — `ai.system.ts:28`
- [ ] 🟡 Per-mover `dwReAttackDelay` — `aiConstants.ts:41`
- [ ] 🟡 Return-home HP restore deviation from C++ StateReturn — `ai.system.ts:290`

---

## 5. PARTY / EXP-SHARE

- [ ] ❌ Party invite / accept / leave / kick
- [ ] ❌ Party UI / member list snapshot
- [ ] ❌ Party EXP sharing (combat grantExp is single-attacker) — `mover.ts:249`
- [ ] ❌ Party loot-share + FFA timeout — `actMsg.handler.ts:125`, `loot.service.ts`
- [ ] ❌ `/p` party chat channel — `command.service.ts:37`

---

## 6. PvP / PK

- [ ] ❌ Player-vs-player targeting (explicitly out of scope) — `combat.policy.ts`
- [ ] ❌ `nChaotic` ever set (isChaotic() exists, never flips) — `player.ts:216`
- [ ] ❌ PvP damage vars / PK penalties — `skillFormulas.ts:230`
- [ ] ❌ Chaotic/PK revive (different HP rate + PK town) — `revival.service.ts:20`
- [ ] ❌ Guild-war revive — `revival.service.ts:20`

---

## 7. DEATH / REVIVAL

- [x] ✅ Monster death (MOVERDEATH, exp, drops, quest, remove) — `combat.service.ts:193`
- [x] ✅ Player death (dead flag, MOVERDEATH, ACTMSG STOP+DIE) — `revival.service.ts`
- [x] ✅ Revival (scroll in-place, lodestar town + exp penalty) — `revival.service.ts`
- [ ] ❌ Other-player resurrection skill — `revival.service.ts:20`
- [ ] ❌ DiePenalty.inc real table loader — `exp.ts:81`
- [ ] ❌ 5s dead lockout (`m_nDead`) — `revival.service.ts:20`
- [ ] ❌ Cross-world revive REPLACE teleport snapshot — `revival.service.ts:193`

---

## 8. INVENTORY / ITEMS

- [x] ✅ Add/stack/remove/move (swap)/consume/drop — `inventory.service.ts`
- [x] ✅ Gold spend/add/drop (MAX_GOLD clamp) — `inventory.service.ts:187`
- [x] ✅ Equip/unequip (server-authoritative slot, swap, level_req) — `equip.service.ts`
- [x] ✅ DST stat-bonus apply/remove on equip/unequip — `equip.service.ts:145`
- [ ] ❌ Weight / overweight enforcement (field exists, unused) — `item.schema.ts:134`
- [ ] 🟡 Jewelry HR/parry (partial; effects via DST) — `equipStats.ts:86`
- [ ] 🟥 Buff/skill/warp/text usable items (charge consumed, no effect) — `useItem.service.ts:78`
- [ ] ❌ Set-item bonuses (`set_id` field exists, no logic) — `item.schema.ts:212`

### Item enhancement
- [ ] 🟡 Refine level storage + combat read (no refine ACTION) — `player.ts:107`
- [ ] ❌ Refine / upgrade scroll + anvil action + opcode — none
- [ ] ❌ Enchant action + opcode
- [ ] ❌ Piercing / sockets (data + action) — `itemSnapshot.serializer.ts:48`
- [ ] 🟡 Elements stored + combat-read; no element-apply action, string→enum unfinished — `equipStats.ts:13`

---

## 9. NPC / SHOP / BANK

- [x] ✅ Shop open/close/buy/sell (gold-clamped, anti-cheat) — `shop.service.ts`
- [x] ✅ Bank/warehouse open + pin + changepass (account-shared, 3 tabs) — `bank.service.ts`
- [x] ✅ Bank item deposit/withdraw — `bank.service.ts:108`
- [ ] 🟡 Bank gold tab 0 only; per-tab gold (tabs 1/2) — `bank.service.ts:14`
- [ ] 🟡 NPC dialog — Speak/LaunchQuest + menu; advanced `source` bodies not ported — `scriptDlg.service.ts:168`
- [ ] 🟡 Shop cost multiplier / event buy factor / perin fixed-price — `shop.service.ts:89`

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
- [ ] 🟥 PLAYERANGLE accepted + dropped (no effect) — `movement.service.ts:127`
- [ ] ❌ Collision / terrain check (only distance anti-cheat)
- [ ] ❌ Player run/walk speed enforcement
- [ ] 🟡 Multi-zone (buckets exist; ships one zone per world) — `zone.manager.ts`
- [ ] ❌ Zone transitions / cross-world transfer (REPLACE handoff not wired)
- [ ] ❌ World map
- [ ] 🟡 Map key accept-all (no manifest) — `mapKey.service.ts:44`

### Vicinity / AoI
- [ ] 🟡 who-sees-whom radius query (whole-zone burst, not per-radius stream) — `zone.manager.ts`
- [ ] 🟡 NPC/mob ADD_OBJ one-shot full-zone on MAP_KEY; no enter/leave streaming — `vicinity.service.ts`
- [ ] ❌ Player-to-player ADD_OBJ on join (broadcastEnter) — `join.handler.ts:109`

---

## 13. FLYING / MOUNTS (signature Flyff)

- [ ] 🟥 Flying (board/broom) — no flight state model; move/angle broadcast unconditionally — `movement.service.ts:109`
- [ ] ❌ Mounts / ride

---

## 14. CHARACTER PROGRESSION

- [x] ✅ Create (name/slot/dupe guards) — `charCreate.service.ts`
- [x] ✅ Select / enter-world (PRE_JOIN) — `charSelect.service.ts`
- [x] ✅ Stats allocation (MODIFY_STATUS, WAL) — `stat.service.ts`
- [x] ✅ Level / exp (cascade, WAL, SETLEVEL/SETEXPERIENCE) — `exp.ts`, `combat.service.ts:211`
- [ ] 🟡 Delete — account-ownership, not 2nd-factor delete key — `charCreate.service.ts`
- [ ] ❌ Job / class change 1st→2nd (JOB_TABLE data exists, no CHANGEJOB handler) — `job.ts`

---

## 15. SOCIAL

- [x] ✅ Normal/say chat (vicinity) — `chat.service.ts`
- [ ] 🟡 Shout — serializer exists, not wired in router — `shout.serializer.ts`
- [ ] 🟡 Whisper — serializer + opcode exist, no handler routing — `whisper.serializer.ts`
- [ ] ❌ Party / guild / trade chat channels — `command.service.ts:37`
- [ ] ❌ Guild system (opcode defined, no handler; mover writes zero guild fields)
- [ ] ❌ Friend list / blocklist (client opens windows, reply is stub) — `queryPlayerData.handler.ts:8`
- [ ] 🟡 Motion / emote broadcast (verbatim, no OBJMSG validation) — `motion.service.ts`
- [ ] 🟡 Sit / rest (behavior frame only; no recovery multiplier) — `recovery.system.ts:13`
- [ ] 🟡 Taskbar bindings stored; applet + skill-queue grids no handlers — `taskbar.service.ts`

---

## 16. INFRA / PERSISTENCE (mostly done — listed for completeness)

- [x] ✅ Login/auth (argon2id, ban, session token) — `auth.service.ts`
- [x] ✅ Char-select → world handoff (HMAC IPC) — `handoffPublisher.ts` / `clusterListener.ts`
- [x] ✅ Server / world list — `serverList.service.ts` / `worldList.service.ts`
- [x] ✅ WAL journal + boot replay (idempotent) — `journalReplayer.ts`
- [x] ✅ 30s checkpoint DB sync + dirty flags — `checkpoint.system.ts`, `player.ts:339`
- [ ] 🟡 argon2id ships stub hash in dev (ceiling: real argon2 in prod) — `password.ts:15`

---

## Biggest gaps, ranked (net-new systems, not sub-features)

1. **Buff/debuff + status-effect system** — blocks: buff skills, buff items,
   CC (stun/poison/slow/sleep), disguise, buff-clear-on-death. Foundational.
2. **Party system** — blocks: party EXP, party loot, party chat, party quests.
3. **Skill effect breadth** — heal/buff/AoE/DoT/multi-hit/projectile/skill-crit.
4. **Social** — guild, friend/block, whisper/shout routing.
5. **Flying + mounts** — signature Flyff mechanic, entirely absent.
6. **Player trade + vending** — core economy loop.
7. **Item enhancement actions** — refine/upgrade/enchant/socket (storage exists,
   no action opcodes).
8. **Job change (1st→2nd)** — data exists, no handler.
9. **Zone transitions / collision / world map.**
10. **Set-item bonuses, weight, ammo.**
