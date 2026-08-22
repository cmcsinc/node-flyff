# Feature Dependency Order

Companion to `MISSING-FEATURES.md` (what is missing) and `docs/FEATURE-STATUS.md`
(readable summary). **This file answers a different question: in what order.**

Built 2026-08-22 against master `8792943`. Recounted at HEAD: **147**
`dispatcher.register` calls (139 world + 8 cluster/login), **183** `ponytail:`
markers, **26** migrations. Every claim below carries a `file:line` verified this
pass; where it corrects an older doc the correction is named.

**Method.** Nine *dependency roots* were identified — single pieces of missing
infrastructure that multiple unrelated checklist rows all wait on. Ordering below
is by how many downstream rows a root releases, not by feature glamour.

---

## Wave 0 — inert, not missing (no dependency at all)

Each is already built and unreachable, or built and unwired. No new subsystem, no
research. Do these first because they change the shape of Wave 1's estimates.

| # | Item | The one change | Releases |
|---|---|---|---|
| 0.1 | **Monster rank exemption** — *stale ponytail, newly found* | `formulas.ts:366` says "re-add the rank exemption when monster ranks ship". Ranks **have** shipped: `spawn.manager.ts:198 rank: def.rank` → `mover.ts:428 m_dwClass` → `combatants.ts:63 rank`, and a *different* function already consumes it (`formulas.ts:409-410 canFlyByAttack` filters `RANK_SUPER`/`RANK_MATERIAL`/`RANK_MIDBOSS`). `getDamageMultiplier` still applies the cosine falloff to guards and super bosses that C++ exempts (nDelta forced 0) | §1 unmodelled-melee row |
| 0.2 | **`level_req` never emitted** — *newly found, high blast radius* | `item.schema.ts:275` defaults it to 1 and the converter never writes it (0 hits in `data/items/weapons.yml`), so the equip level gate at `equip.service.ts:178` is **inert for every item in the game**. One converter line in `resources/scripts/converters/items.ts` | equip level gating (currently an anti-cheat hole) |
| 0.3 | **Durability never decremented** | Nothing in the codebase writes `slot.durability` except `repair.service.ts:80` (which sets it to max). `RepairService` is therefore a no-op sink. One decrement hook at the combat swing; the ponytail is at `formulas.ts:199-200` | §8 durability, makes `RepairService` reachable |
| 0.4 | `partyQuery` never passed | One ctor key at `compose.ts:461-493`; consumer `quest.service.ts:96` stays falsy so quest party mode 2 always fails | §11 begin conditions |
| 0.5 | `IK3_TEXT_DISGUISE` aggro | `ai.system.ts isHidden()` tests only `MODE.TRANSPARENT`; buffs shipped long ago. 3 call sites | §3 + §4 (same gap, twice) |
| 0.6 | Flight↔pet gate one-directional | `flight.service.ts:108` ponytail'd on "no pet system"; the looter shipped. Check `player.m_oiEatPet !== NULL_ID` | §13 + §27 |
| 0.7 | Vendor `IsFly()` gates | `vendor.service.ts:106,214` both say "no flight state yet"; `player.isFly()` has 5 other callers | §10 |
| 0.8 | Guild-cloak non-tradeable | `trade.service.ts:621` ponytail'd on guild; `m_idGuild` reaches the wire (`mover.serializer.ts:181-183`) | §10 + §26 |
| 0.9 | Quest guild predicates | `questConditions.ts:44-49` returns permissive constants; the dialog interpreter already made this jump (`dialogInterpreter.ts:345-348`) | §11 end conditions |
| 0.10 | `MAGIC_ATTACK` dispatch | Declared `opcodes.ts:50`, no handler file. Closes the last combat path | §1, §23 |
| 0.11 | `/dg`, `/p` command rows | Services exist (`guild.service.ts:158 destroy`, `party.service.ts:306 chat`); only router rows missing at `command.service.ts:225-271` | §25 |
| 0.12 | **Guild is untestable as shipped** | `config/world-server.json:33,35` ship `guildWarEnabled:false` + `guildQuestEnabled:false`. Faithful to vanilla, but the 7 shipped guild subsystems cannot be client-tested until these flip in a dev config | §26 rank-7 gap |
| 0.13 | 4 stale in-code comments | `guild.manager.ts:21-22`, `guild.service.ts:24-26`, `recovery.system.ts:12-13`, `command.service.ts:40` — each names a blocker that shipped | doc hygiene |
| 0.14 | **`expRate` + `spawnMultiplier` are dead config** — *newly found, operator-visible bug* | Both live in `config/world-server.json:27,31` **and** are editable in the admin panel (`packages/admin/lib/config-fields.ts:205,208`), but grep across `packages/*/src` finds **zero runtime readers** — only the schema declaration (`world.schema.ts:29,47`). An operator who sets EXP rate gets silence. `partyExpRate` and `shopCostRate` *are* wired (`compose.ts:661,1256`), so this reads as an oversight, not a decision. Fix for exp is one `* rate()` inside the single choke point `combat.service.ts:699 grantExpAmount` | closes a live live-ops bug **and** is 80% of R8 |
| 0.15 | `m_dwMute` hardcoded 0 on the wire | `mover.serializer.ts:300 writeDword(0)` where C++ writes `m_dwMute` (`ObjSerializeOpt.cpp:264`). Harmless today (no mute state exists) — listed so R5 does not miss the wire slot | R5 |
| 0.16 | 5 dead `MODE` bits | `ITEM`, `NO_ATTACK`, `COMMUNITY`, `OBSERVE` (`command.service.ts:252-259`) and `EXPUP_STOP` (`:701-703`) are settable by GM command and read by **nobody**. They ride the wire (`mover.serializer.ts:207`) so the client re-renders — server-side the toggles are cosmetic | R5 |

Wave 0 has **no internal ordering** — all 16 are independent and parallel-safe.

---

## The nine dependency roots

Everything left in the checklist funnels through nine pieces of missing
infrastructure. Build a root and its whole downstream column becomes ordinary
feature work; skip it and every row in that column stays blocked or ships as a
guess.

| Root | What it is | Blocks |
|---|---|---|
| **R1. `.lnd` heightmap parser** | No server-side terrain Y exists anywhere. **3660 `.lnd` files ship** under `game/client/World/` (49 worlds), unparsed. Three subsystems each carry a private proxy: `/te` approximates from nearest authored spawn y (`command.service.ts:925-932`), drop piles reuse the killer's client y (`drop.service.ts:91-95`), flight has the same hole (`flight.service.ts:24`) | terrain collision, `HATTR_NOFLY`, movement speed enforcement, mount state, correct drop/teleport/revive Y, `GetFullHeight` sentinel resolution |
| **R2. Multi-world runtime + REPLACE** | `ZoneManager` buckets by `m_nZoneId` and is genuinely multi-zone-capable (`zone.manager.ts:17`, its own doc says "the bucket model holds when real zones land"); `zone.loader.ts:47` already `readdir`s the directory and indexes `byWorld`. **Only one zone file exists** (`flaris.yml`, `_id_numeric:1`, `world_id: madrigal`) against 48 `.dyo`/`.rgn` world pairs on disk. `ReplaceSerializer` is **fully written, tested, and has zero callers** (`replace.serializer.ts:21`) — every teleport deliberately uses SETPOS instead because REPLACE nulls the client's `g_pPlayer` (`DPClient.cpp:2352`) and needs a following **self ADD_OBJ re-send that does not exist**. Slug→WI_* mapping is a 1-entry literal (`blinkwing.service.ts:87`) | cross-world teleport, zone transitions, cross-world blinkwing (§8 — actively *refused* today, `blinkwing.service.ts:264`), cross-world revive (§7), instance dungeons, every instanced system (Colosseum, Secret Room, Guild 1v1, Housing, arenas, minigame rooms) |
| **R3. Region/AoE spatial query** | One reusable primitive exists and it is **players-only**: `zone.manager.ts:91 playersNear(pos, zoneId, radius, except?): CPlayer[]` (squared distance, 2D x/z, y ignored). **Movers have no radius query at all** — `spawn.manager.ts` offers only `get(id)`, `inZone(zoneId): CMover[]`, `*all()`, `findByCharacterKey()`. A skill AoE hitting monsters has nothing to call. Rect geometry exists but is bound to the guild-quest prop table (`guildQuest.manager.ts:224 rectAt`, `:252 ptInRect` — Win32 PtInRect semantics, and the only spatial helper in the repo that accepts a worldId). No quadtree or spatial index anywhere; every query is a linear scan | skill AoE (`ApplySkillRegion`/`Around`/`Line`), projectile skills, `bMasterAround` guild-arena filter (§26), CNPC-radius vendor reject (§10), aggro tables |
| **R4. Item flag + prop columns** | The **converter** is the bottleneck, not the schema. `resources/scripts/converters/items.ts` hardcodes `weight:1` (`:144`), `tradeable/dropable/destroyable: true` (`:147-149`), never emits `level_req`, `bankable`, static `element`, `set_id`, `rarity`, `two_handed`. propItem flag columns (undestructable/using/bound) and `eItemType` are **not in the schema at all** | item weight system, `IsUndestructable`/`IsUsing` drop guard (§8), element-card type restriction (§8), non-tradeable flags (§10), sell/bank gating (`shop.service.ts:171` can never fire) |
| **R5. Mode/state enforcement pipeline** | `m_dwMode` exists (`player.ts:224`) with 11 bits (`entities/constants/mode.ts`), but **no `m_dwState` bitfield exists at all** (`m_bDead` stands in, ponytail `player.ts:157`) and there is no mute/freeze/talk field anywhere. Absent bits: `DONMOVE`, `SAYTALK`, `TALK`, `SHOUTTALK`, `RECOVERCHAO`, `FREEPK`, `PVPCONFIRM`. `chat.service.ts:12-13` states the gap outright; `guild.service.ts:548` + `party.service.ts:305` both carry `ponytail: mute check`. DB has `accounts.banned`/`banned_until` but no mute column | `/mute` `/talk` `/nota` GM commands (§25), party-chat mute (§5), guild-chat mute (§26), `MODIFYMODE` opcode, Wave 0.15/0.16 |
| **R6. `sPlayerData` + `nVer`** | `queryPlayerData.service.ts` is a 54-line stub returning `{reply:null}`; **everything around it is already wired** (dispatch `clientServer.ts:151`, construct `compose.ts:632`, handler parses `idPlayer`+`nVer` at `:40-41` and forwards `result.reply` at `:50`). The 12-byte layout is documented in the stub's own header. `m_szName`/`m_nJob`/`m_nLevel`/`m_nSex` all exist (`player.ts:144-147`) | 🟥 `QUERY_PLAYER_DATA` (§15/§26 — friend, guild AND party windows all ask), `QUERY_PLAYER_DATA2`, guild ranking read path |
| **R7. `.inc`/`.lua` data pipeline breadth** | 12 loaders exist (`packages/resources/src/loaders/`), 7 converters wired at `scripts/convert.ts:37-43`. `defines.loader.ts:49` auto-globs `raw/define*.h`, so **any define header dropped into `raw/` is picked up free**. Unloaded files that ship on disk: `DiePenalty.inc`, `propEvent.inc`, `propDropEvent.inc`, `randomeventmonster.inc`, `election.inc`, `lordevent.inc`, `collecting.inc`, `pet.inc`, `couple.inc`, `PKSetting.inc`, `randomoption.inc`, `transformitem.inc`, `accessory.inc`, `propGuildQuest.inc`, `propPartyQuest.inc`. **Two corrections vs older notes:** (a) `propKarma` is `.txt` and `#if __VER < 8` only (`Project.cpp:511-514`) — **dead in v19, do not port**; live PK data is `PKSetting.inc`. (b) `propQuest-Scenario.inc`/`-DungeonandPK.inc` are **never server-loaded in C++ either** (`Project.cpp:495-499` handles only the `propQuest` token) — they are client preload files, so "blocks two quest .inc files" overstates it | `DiePenalty` real table (§7), PK item-drop (§6 — via `PKSetting.inc`, not KarmaProp), Event/live-ops, Lord/Election, collecting, system pet, couple, item random-options |
| **R7b. `propMoverEx.inc` dropped columns** | The file **is** in `raw/` but is read by two partial scanners, not a loader: `converters/drops.ts:139-161` takes `Maxitem`/`DropGold`/`DropItem`; `converters/movers.ts:66-96` takes `m_dwRunawayDelay`/`SetRunAway` arg1/`Recovery` args 1-2. **Dropped: `DropKind(IK3_*, min, max)` — 7,526 occurrences**, the level-scaled generic-equipment drop table and by far the largest unported data block in the repo. Also dropped: `QuestItem`/`DropQuestItem` (explicitly skipped `drops.ts:162`), `SetCallHelper` (64×), `AddSummonMonster` (2×), `SetRunAway` args 2-3, `m_dwAttackMoveDelay`, `m_nAttackFirstRange`, `Recovery` arg 3 + target letter, and **every `AI { }` block except `#battle`** (Scan, Attack cunning, Summon, Rangeattack, Keeprangeattack, Evade, Helper, Berserk, Randomtarget, teleport, Loot) | monster loot breadth (most mobs drop far less than retail), healer ally-heal + `healCadenceMs` (§4), summon/helper AI (§4), the whole advanced-AI row set |
| **R8. Rate/multiplier hook (Event seam)** | **Drops already have the seam and it is already a thunk, deliberately**: `drop.service.ts:68 deps.rates?: () => DropRates`, comment at `:63-66` ("A function, not a value, for exactly that reason"), bound `compose.ts:954`, applied `:160`/`:195`. An Event system hooks drops by swapping that one closure. **Exp has one choke point** — `combat.service.ts:699 grantExpAmount`, documented at `:692-698` as "ONE exp-application path"; solo and party both funnel through it (quest exp bypasses, `questRewards.ts:122,166`). **Temp spawns need no new plumbing**: `spawn.manager.ts:251 spawnMonster(moverId, pos, zoneId, activeAttack)` is the seam, already fires `onSpawn` → ADD_OBJ, already reachable from the command layer (`compose.ts:795`); teardown is `kill(id,{despawn})` | Event/live-ops. Missing: a spawn-*group* concept to tear down as a unit, and Wave 0.14 (`expRate` unread) |
| **R9. Guild client-test + dev flags** | Wave 0.12. Not code — 7 shipped guild subsystems (~3.9k lines) have **never met a client**, and two of them ship OFF by config | de-risks §26 entirely; blocks nothing technically, but every hour spent on guild 1v1 / Guild House before this test is spent on an unvalidated base |

### Root → root dependencies

Only three edges exist between roots. Everything else is parallel.

```
R1 (.lnd terrain) ──► R2 (multi-world/REPLACE)   ; a new world needs ground Y
R7 (.inc pipeline) ─► R8 (rate hook)             ; events are data-driven
R3 (spatial query) ─► R2                          ; instanced regions need rect queries
```

R1 is the only root with no prerequisite that unblocks two others. **R1 first.**

### R2's ordering traps (recorded because they are easy to get wrong)

Wiring `ReplaceSerializer` is not the whole job. In order:

1. Send REPLACE, **then immediately re-send the player's own ADD_OBJ** — REPLACE
   nulls the client's `g_pPlayer` (`DPClient.cpp:2352`). This is the load-bearing
   step and the reason every current teleport uses SETPOS instead
   (`setPos.serializer.ts:11-17`, ponytail `revival.service.ts:361`).
2. Call `zone.manager.ts:30 remove(player)` **before** mutating `m_nZoneId` — it
   reads that field to find the bucket — then `place()` after. No existing code
   does this; `applyReplace` (`command.service.ts:897`) never touches zone id.
3. Tear down and rebuild `m_known` in full. `VisibilityService.refresh` only
   diffs within one zone bucket, so cross-world objids would linger.
4. `player._dirty.add(...)` the new zone/world — `applyReplace` dirties only
   x/y/z.
5. For a world in a *different process*, additionally an IPC transfer channel +
   Zod schema carrying position and worldId. Today `packages/ipc/src/schemas/`
   holds **one** file and the only live channel is `player:handoff`
   (cluster→world login handoff, no position, single-use token).


---

## Build order

### Wave 1 — the roots that unblock the most (do in this order)

1. **R1 `.lnd` heightmap parser** → `world.getLandHeight(x, z)`.
   The three existing proxies (`command.service.ts:925`, `drop.service.ts:98
   groundY`, `flight.service.ts:24`) all name this exact function as their
   replacement, so one parser closes three ponytails and is a prerequisite for
   R2. 3660 files on disk; format is documented in C++ at `WorldFile.cpp:832` +
   `World.cpp:982 GetLandHeight` (bilinear sample). Highest leverage in the
   project.
2. **R4 item converter columns** → cheap (one converter file), and 0.2/0.3 in
   Wave 0 are already inside it. Fixes a live anti-cheat hole.
3. **R3 spatial query API** → the concrete gap is one function:
   `moversNear(pos, zoneId, radius)` on `SpawnManager`, mirroring
   `zone.manager.ts:91 playersNear`. Movers have **no** radius query today, so an
   AoE has nothing to call. `guildQuest.manager.ts:252 ptInRect` is the rect
   geometry to generalize. Prerequisite for all AoE.
4. **R6 `sPlayerData`** → smallest root by far, and the *only* thing missing is
   `nVer`: dispatch, construct, handler, and parse are all already wired
   (`clientServer.ts:151`, `compose.ts:632`, handler `:40-50`), and the 12-byte
   layout is written in the stub's own header. Add `m_nDataVer` to `CPlayer`, bump
   on job/level/sex change, build the 0x0141 reply. Note two scope limits: only
   *online* peers resolve (no `CPlayerDataCenter` equivalent — C++ caches offline
   players), and the handler flags a missing rate limiter at `:11`.
5. **R5 mode pipeline** → `m_dwMute: number` on CPlayer + a **decrementing tick**
   (C++ `m_dwMute--` once per `CMover::Process`, `Mover.cpp:3970` — the unit is
   process-ticks, not seconds) + gates at the 4 chat sites + the wire slot
   (Wave 0.15). Unlocks `/mute` `/talk` `/nota` and two ponytails. **Note: there
   is no GM freeze command in v19** — `DONMOVE_MODE` is set only by
   `StartCollecting`/`StopCollecting` and enforced client-side, so `/freeze`
   `/nofr` are not part of this root.

R1..R5 are **mutually independent** and can run in parallel across agents. The
numbering is priority, not sequence.

### Wave 2 — needs a Wave 1 root

| Feature | Waits on | Note |
|---|---|---|
| Skill **AoE** (`ApplySkillRegion`/`Around`/`Line`) | R3 | 🟥 today; `skillRange` is the radius input and is already parsed (`skill.schema.ts:56`) |
| **Projectile** skills | R3 | flight time + travel interception |
| Terrain collision, speed enforcement, `HATTR_NOFLY`, mount state | R1 | all four are the same missing sample |
| **Multi-world + REPLACE** (R2) | R1, R3 | `ReplaceSerializer` already written, zero callers — wire it |
| **Weight / durability / drop-guard / element-card type** | R4 | data now real |
| `/mute` `/talk` `/freeze` family, party+guild chat mute | R5 | |
| Guild **ranking** read path | R6 | no packet to port; it is a read path |

### Wave 3 — needs Wave 2

| Feature | Waits on | Why |
|---|---|---|
| **Instance / Party Dungeon** (rank 6) | R2 | an instance *is* a private world |
| **Colosseum, Secret Room, Guild 1v1, Housing, Guild House, minigame rooms, Quiz World, Rainbow Race** | R2 (+R3) | every one is an instanced region. Eight systems, one prerequisite |
| **Cross-world blinkwing** (§8), **cross-world revive** (§7) | R2 | both explicitly refuse today pending REPLACE |
| **Mounts** | R1 | ground-mount needs a speed model over real terrain |

### Wave 4 — data-pipeline chain

1. **R7 `.inc` loader breadth** — pick per consumer, cheapest first:
   `DiePenalty.inc` (closes §7 — brackets hardcoded at `exp.ts:166-175`, and note
   `revival.service.ts:342` wants a REVIVAL_PENALTY table that is **not ported at
   all**), then `PKSetting.inc` (closes §6 PK item-drop — **not** KarmaProp, which
   is `__VER < 8` dead code), then `randomoption.inc`, `pet.inc`, `couple.inc`.
   Files must land in `raw/` to be seen; `defineHonor.h` is missing from `raw/`,
   which is the only reason the `define*.h` auto-glob misses it.
2. **R7b `propMoverEx.inc` full scanner** — `DropKind` alone is 7,526 rows of
   missing loot. Arguably higher player-visible value than any single system in
   Wave 5, and it is a converter change, not a subsystem.
3. **R8 dynamic rate hook** — drops already have the thunk; exp needs one
   `* rate()` at `combat.service.ts:699` (which also fixes Wave 0.14); spawns need
   a group concept for teardown.
4. **Event / live-ops** — needs R7 (`propEvent.inc`, `propDropEvent.inc`,
   `randomeventmonster.inc`) **and** R8. The guild-quest arena is already this
   exact shape and is the precedent to copy (`compose.ts:496`).
5. **Lord / Election / Tax** — needs R7 (`election.inc`, `lordevent.inc`) and R8.
   ⚠ `election.inc` is loaded by `databaseserver/tlord.cpp:38` — **a process this
   port does not have**, so Lord needs an architectural decision about where
   election state lives before any code is written. Tax is the shop cost
   multiplier (`shop.service.ts:123`), which is why the checklist ranks this #1 —
   but it is Wave 4, not Wave 1, because it cannot start before its data loads.

### Wave 5 — genuinely standalone (any time, no prerequisite)

These block nothing and are blocked by nothing. Schedule by desire, not by order.

**Couple/marriage** (opcodes + 4 snapshots already declared `opcodes.ts:401-404,
575-578` — needs dispatch + service + one migration) · **System pet** (egg →
D-C-B-A-S; **not one pet opcode is declared** — declare first) · **Fishing** ·
**Auction House** · **Wanted List** · **Honor/Titles** · **Ultimate Weapon** ·
**Collecting** · **Rangda** · **Weather/day-night** · **Pocket tabs** ·
**BeautyShop/look-change** (the MMI ids parse correctly — only a service is
missing) · **NPC minimap markers** · **Funny Coin** · **7 minigames** (the
*games* are standalone; their *rooms* are Wave 3) · **guild admin pages** ·
**log rotation/download** (§19) · **`@flyff/gateway` delete-or-document** (§22).

---

## Reverse index — "what blocks feature X?"

| Feature | Blocked by |
|---|---|
| Skill AoE / projectile | R3 (specifically: `moversNear` does not exist) |
| Mounts, terrain, speed, no-fly | R1 |
| Any instanced content (8 systems) | R2 ← R1, R3 |
| Item weight/durability/flags/level gate | R4 (Wave 0.2, 0.3) |
| GM mute + chat mute | R5 (`/freeze` is **not** a v19 command — do not port) |
| Peer-data windows, guild ranking | R6 (only `nVer` is missing) |
| Monster loot breadth, summon/helper AI | R7b (`DropKind`, 7,526 rows) |
| Events, Lord, Tax, DiePenalty, PK item-drop | R7 (+R8) |
| Guild 1v1, Guild House | R2, **and R9 first** (test what shipped) |
| Couple, system pet, fishing, auction, honor, … | *nothing* — Wave 5 |

### Rows that are NOT blocked by what the docs claim

| Row | Older doc says | Actually |
|---|---|---|
| PK item-drop penalty (§6) | blocked on "KarmaProp table" | `propKarma` is `__VER < 8` **dead code**; the live data is `PKSetting.inc` |
| Instance dungeons | "blocks `propQuest-Scenario.inc` + `-DungeonandPK.inc`" | C++ never server-loads either (`Project.cpp:495-499`); they are **client** preload files |
| Monster rank exemption (§1) | "when monster ranks ship" | ranks ship end-to-end; a sibling fn already reads them |
| `expRate` config | implied working | **read by nothing at runtime** |

## Recommended sequence

```
now      Wave 0  (16 inert fixes, parallel, ~no research)
         R9      (flip dev flags, client-test guild)
next     R1  R4  R3  R6  R5   (parallel, 5 agents)
then     Wave 2  (AoE, projectile, REPLACE wiring, terrain gates, mute cmds)
then     R7 → R7b → R8 → Events → Lord/Tax
then     Wave 3  (instances; unlocks 8 systems at once)
anytime  Wave 5  (Couple is the cheapest — it is pre-stubbed)
```

**Do not** start Lord/Tax (checklist rank 1) or Events (rank 2) first. Both are
data-gated behind R7, neither can be validated without the loaders, and Lord
additionally needs an architecture decision (its C++ data loads in a
`databaseserver` process this port does not have).

The highest-leverage single task is **R1, the `.lnd` parser** — it closes three
ponytails directly and gates eight systems transitively. The highest
player-visible-value-per-hour task is **R7b `DropKind`** — one converter change
worth 7,526 rows of missing monster loot.

---

## Doc overlap verdict

- `.claude/state/MISSING-FEATURES.md` — **authoritative**, 323 rows, keep.
- `docs/FEATURE-STATUS.md` — readable summary of the same rows, keep.
- `docs/missing-features-audit.md` — **self-marked HISTORICAL** (snapshot of
  2026-07-21, before combat/skills/inventory/quests/party/trade/mail shipped).
  Its own header says use `MISSING-FEATURES.md` instead. Only its C++ citations
  and opcode hex values retain value. **Recommend: delete or fold the surviving
  citations into §23.**
- This file — the ordering layer none of the three had.

## Counts at `8792943` (recounted 2026-08-22, correcting older docs)

| Metric | Older docs say | Actual |
|---|---|---|
| `dispatcher.register` calls | 145 | **147** (139 world + 8 cluster/login) |
| `ponytail:` markers | 179 | **183** |
| Migrations | 22 | **26** |
| Resource loaders | 11 | **12** |
| Unparsed `.inc` on disk | (not counted) | **~15** server-relevant |
| `DropKind` rows unported | (not tracked) | **7,526** |
| `.lnd` files on disk, unparsed | (not counted) | **3,660** across 49 worlds |

## Provenance

Built by three parallel read-only probes over live source plus direct
verification of every load-bearing claim. Confidence notes:

- **First-hand verified this pass** (grepped or read at HEAD): all of Wave 0, the
  9 root summaries, both count tables, and every "actually" row above.
- **Corrections this file makes to `MISSING-FEATURES.md`**: 5 rows are blocked by
  something other than what they claim (see the "NOT blocked" table); 3 counts
  were stale; the #1 and #2 ranked gaps are misordered relative to their data
  dependencies.
- **Not verified**: nothing in this file is user-confirmed. Per the override rule
  in `CLAUDE.md`, ✅/"shipped" language here means "passes this device's checks".
  §20 MAIL remains the only user-tested section in the project.

