# Feature Status

**What works, what partly works, and what is missing.**

Last verified: 2026-08-05 against `master` (`b54ee36`) — full build (19/19
packages) and test suite green at time of writing.

---

## How to read this

| Mark | Meaning |
| --- | --- |
| ✅ | Implemented, exercised by tests, believed working |
| 🟡 | Core path works; named sub-features or edge cases are missing |
| 🟥 | Code exists but does nothing meaningful (accepted and discarded) |
| ❌ | No code path at all |

**Important caveat.** ✅ means "the automated checks pass and it has been
exercised". It does **not** mean every mark has been confirmed by a human
playing on a retail client. A server emulator's real test is an unmodified game
client, and that cannot be mocked. Treat ✅ as "should work — tell us if it
doesn't", not as a warranty.

The authoritative, line-level version of this document is
[`.claude/state/MISSING-FEATURES.md`](../.claude/state/MISSING-FEATURES.md) —
25 sections, ~200 tracked items, each with a `file:line` citation. This page is
the readable summary. For known behavioural deviations from the original C++
server, see [`c++-fidelity-audit.md`](c++-fidelity-audit.md).

There are also **164 `ponytail:` markers across 85 source files**. Each one names
a deliberate simplification at the exact line it applies to:

```bash
grep -rn "ponytail:" packages/*/src
```

That sweep is the densest gap inventory in the project.

---

## Summary

Tracked items across sections 1–22: **143 ✅ · 41 🟡 · 6 🟥 · 22 ❌** (3 marked
not-applicable — faithful ports of C++ stubs).

A player can currently: create an account, log in, create and pick a character,
enter Flaris, walk and fly around, fight monsters with melee / ranged / skills,
level up and allocate stats, learn and cast skills with buffs and debuffs, loot
and manage a full inventory, equip gear with set bonuses,
trade with other players, run a private vendor stall, use shops and the bank,
take and complete quests through NPC dialog, change job at level 15, join a
party with exp and loot sharing, duel, PK, add friends, use campus mentoring,
summon a looter pet, use blinkwing teleport scrolls,
send and read mail, chat across several channels, and be administered live from
a web panel.

They cannot yet: ride a mount, marry, raise a system pet (the
looter pet works; the egg → D-C-B-A-S progression does not), enter an instance
dungeon, or participate in any minigame, event, or Lord election.

Guilds are built end to end — roster, bank, contribution, war, and the boss
arena — but **not yet client-tested**, and the two event-flag subsystems (war,
arena) ship OFF as vanilla v19 does.

---

## Working

### Networking and infrastructure ✅

- Authentic v19 binary TCP protocol — `0x5E` marker framing, CRC integrity,
  DWORD-length-prefixed strings, stream reassembly
- Three-server topology: login (`:23000`), cluster (`:38100`), world (`:38180`)
- **112 inbound opcodes** dispatched in the world server alone
- HMAC-SHA256-signed IPC over Redis pub/sub plus internal TLS TCP, with replay
  rejection and a circuit breaker
- Hybrid WAL persistence: local SQLite journal written before every
  acknowledgement, batched Knex flush every 30 s, replay-on-boot crash recovery
  with idempotent absolute-state payloads
- 22 Knex migrations; SQLite / PostgreSQL / MySQL via one adapter switch
- Resource pipeline: 11 loaders over `propItem` / `propMover` / `propSkill` /
  quests / dialog / zones, including `=`-inheritance and block-comment handling
- 50 ms world tick with zone-partitioned broadcasting and dirty-flag persistence

### Combat ✅

Hit-rate rolls for all four attacker/defender combinations, critical hits, block,
DEF subtraction, element factors, level-difference falloff, ATK derived from
weapon plus DST modifiers plus refine, the bow STR/DEX curve, NPC ranged attacks,
the NPC minimum-damage floor, monster swings that read player gear, death,
experience award, and drop generation.

### Skills ✅

Cast pipeline with cooldowns, cast time, SP and MP cost, cast-range gating off
the base `AR_*` attack range, skill learning and skill-point spend, damage-over-
time, multi-hit, buff and debuff skills, the action-slot combo chain with its
700 ms floor, and roster seeding on join.

### Buffs and status ✅

`CBuffMgr`-equivalent buff container normalized to `character_buffs`, expiry
ticking, `SETSKILLSTATE` broadcast, DST parameter application and removal, and
buff clearing on death.

### Monster AI ✅

Idle-wander finite state machine, aggro with belligerence classes, chase with a
30 m leash, flee below a health threshold, corpse despawn after 10 s, safe-zone
retaliation gating, and per-placement belligerence overrides read from `.dyo`.

### Flight ✅

Board and broom flight: mount and dismount via `PARTS_RIDE`, the `OBJSTAF_FLY`
state flag, the client notices for each transition, and fly-mismatch targeting
(a grounded player cannot hit a flying one). Terrain no-fly gating, fuel, and
turbo are not ported yet.

### Inventory and items ✅

Add / stack / remove / move-swap / consume / drop, gold with overflow clamping,
equip and unequip with server-authoritative slot resolution and level
requirements, DST stat projection, **set-item bonuses across 134 sets**, fashion
versus armour slot routing, consumable cooldown groups, ground items with
owner-locked anti-steal for 7 s, blinkwing teleport scrolls with channel and
cancel, and a looter pet that summons, follows, auto-loots, and dismisses.

### NPC interaction ✅

Dialog interpreter (a TypeScript VM over the original script format, including
conditional source blocks), shop stock resolved per NPC from `character.inc`
with four tabs, bank with a password and per-tab gold, item repair, and the
`character.inc` MMI capability parser.

### Quests ✅

Offer, accept, progress tracking, completion, rewards, the quest helper NPC
position lookup, and quest story dialog text — 401 quests loaded.

### Progression ✅

Character creation with name and slot guards, select and enter-world, stat point
allocation, level and experience with cascade handling, and the 1st→2nd job
change (dialog-driven, exactly as the C++ does it).

### PvP ✅

Player-target resolution with a mutual-consent PK gate, PK mode toggle, chaotic
state and PK value with decay, the PvP damage branch, PvP death penalties, and a
full duel handshake with expiry and disconnect handling.

### Party ✅

Invite, accept, leave, kick, leader transfer, party chat, durable parties across
relogs, hit-share experience division with its own reduction curve, four item
distribution modes, and the party-level experience bar.

### Social ✅

Vicinity chat, shout, whisper, friend list with presence relay, campus
(master–pupil) mentoring with a level-91 gate and campus buffs, cheering, motion
and emote broadcast, peer equipment inspection, GM target inspection, and
taskbar persistence for both the F1–F9 grid and the skill queue.

### Mail ✅ *(user-confirmed)*

Send, read, list, gold and item attachments, delete, and the mailbox mode flag.

### Trade and vending 🟡

Player-to-player trade and private vendor stalls both work end to end; some edge
cases remain (see [Partial](#partly-working)).

### Admin panel and live-ops ✅

Next.js panel with resource editors, character live-ops (online list, kick,
teleport, mail), a supervisor daemon that starts and stops servers, a long-poll
log hub, online presence tracking, and a client `.res` patch panel that rebuilds
the `Flyff.a` manifest.

---

## Partly working

The 41 🟡 items, condensed. Each has a `file:line` in the detailed checklist.

| Area | Works | Missing |
| --- | --- | --- |
| **Death / revival** | Death, revival in place and at town, exp penalty, chaotic HP rate | The real `m_nDead` 5 s countdown; `DiePenalty.inc` table loader (brackets are hardcoded); cross-world revive teleport |
| **PvP** | Everything listed above | Safe-zone region enforcement; PK item-drop penalty (KarmaProp); PvP-specific skill damage variables (parsed, unread) |
| **Monster AI** | Wander, aggro, chase, flee | Self-heal cadence (`healCadenceMs` never threaded, defaults to 1000 ms); disguise-buff aggro check tests only the transparency mode |
| **Quests** | Offer through reward | Party conditions fail closed — `partyQuery` is never passed to `QuestService`; TRN3 job-change quests absent |
| **Inventory** | Everything listed above | Item weight, durability decay (so `RepairService` is a no-op sink), piercing / sockets / awakening — all parsed and stored, consumed by nothing |
| **Social** | Chat, friends, campus, blocklist | `/p` and `/g` slash aliases; applet taskbar grid; sit-and-rest state and its recovery multipliers |
| **Peer data** | 🟥 `QUERY_PLAYER_DATA` always replies null — the friend, guild, and party windows ask for this |
| **Character delete** | Ownership check | The second factor (password + delete key) arrives on the wire and is discarded |
| **Job change** | 1st→2nd tier | Master / Hero / Legend tiers are rejected by the server while the admin panel models all five |
| **Flight** | Board / broom mount and dismount, `OBJSTAF_FLY` state, fly-mismatch targeting | `HATTR_NOFLY` terrain gating; disguise-buff and pet gates; fuel and turbo |
| **Pets** | Looter pet — summon, follow, auto-loot, dismiss | The egg → D-C-B-A-S system pet; `dwPetId` still serializes as `NULL_ID` |
| **Zones** | One zone (Flaris) | Cross-world `REPLACE` handoff; terrain collision; movement speed enforcement |
| **Trade / vending** | Core flows | Edge cases around cancellation and stack splitting |
| **Guild** | Roster, ranks and authority, `/cg` + `/g`, rejoin cooldown, contribution and guild level, the 21:00 salary payroll, guild bank, war (declare / accept / surrender / truce / timeout, war kills routed away from PK), the four dialog predicates, refusal notices, and the boss arena | **Untested in client.** Votes are compiled out of v19 upstream so they are deliberately absent. War and the arena are behind runtime flags that ship OFF (`world.guildWarEnabled`, `world.guildQuestEnabled`), matching vanilla. Guild 1v1 combat and Guild House are unported |

### Accepted and discarded (🟥)

`QUERY_PLAYER_DATA` peer reply · the `@flyff/gateway` unified WebSocket server
(2 items — undocumented, untested, zero external references; slated to be
documented or deleted) · a handful of skill effect classes (area-of-effect and
projectile).

---

## Not implemented

### Whole systems absent

Ranked by how much else they block.

1. **Lord / Election / Tax** — the player-elected Lord controls the tax rate that
   multiplies every shop transaction. 4 C++ files plus 2 `.inc` unprocessed.
2. **Events / live-ops** — no way to run a temporary drop, spawn, or experience
   event. This is the primary live-operations tool. 4 C++ sources, 4 Lua scripts,
   3 `.inc` files unparsed.
3. **Couple / marriage** — protocol-stubbed: opcodes and snapshots are already
   declared, only dispatch, service, and tables are missing.
4. **System pets** — the egg → D-C-B-A-S progression is absent; `dwPetId` always
   serializes as `NULL_ID`. The looter pet is a separate, working system.
5. **Mounts** — flight on a board or broom works; ridable mounts do not.
6. **Instance / party dungeons** — endgame PvE; blocks two quest `.inc` files
   that currently ship unprocessed.
7. **Item upgrade side-channels** — awakening, piercing, attribute change, smelt,
   baruna, transy. Around 10 undeclared opcodes.
8. **Guild 1v1 combat / Guild House** — the two guild subsystems still outside
   the port. Everything else guild-related is built (see *Guild* under **Partly
   working**).
9. **Minigames** (7), **Rainbow Race**, **Colosseum**, **Secret Room**,
   **Housing**, **Guild House**, **Quiz Event**, **Fishing**, **Auction House**,
   **Wanted List**, **Honor / Titles**, **Ultimate Weapon**, **Collecting**,
   **Rangda** (world boss), **weather and day-night**, **pocket inventory tabs**,
   **BeautyShop / look change**, **NPC minimap markers**, **Funny Coin**,
   **PCBang bonuses**.

### Protocol coverage

The emulator dispatches **112 client→server opcodes**. The original C++ dispatch
table carries substantially more; §23 of the detailed checklist enumerates **~156
still unrouted**, split into declared-but-undispatched (cheapest to close — the
opcode value is already pinned in `opcodes.ts`) and per-subsystem clusters.

Notably cheap: `MAGIC_ATTACK` is declared but has no handler, leaving one combat
path unclosed. The four couple opcodes are declared and undispatched.

### Slash commands

Player commands: 3 of 25 ported (`/w`, `/say`, `/s`). Most of the remainder are
either client-only display toggles that need no server work, or blocked on the
guild and party subsystems.

GM commands: roughly 35 ported, 60 missing. The highest-value missing ones need
no new subsystem — `/cjob`, the mute/freeze mode pipeline, and the skill-level
family.

---

## Quick wins

Features that are **implemented but inert** — a wiring or data fix, not a build.
Verified open as of 2026-08-04:

1. `MAGIC_ATTACK` dispatch — the opcode is declared, no handler file exists
2. `partyQuery` never passed to `QuestService`, so every quest party condition
   fails closed — one constructor key
3. Couple dispatch — opcodes and snapshots already declared
4. Disguise-buff aggro check reads only the transparency mode, though buffs
   shipped long ago
5. Monster self-heal cadence never threaded from the converter to the entity

If you are looking for a first contribution, start here.

---

## Test coverage

`pnpm -r test` — **2,494 tests, 0 failures** on Node's native runner, no external
framework.

| Package | Tests | | Package | Tests |
| --- | --- | --- | --- | --- |
| world-server | 356 | | party | 79 |
| core | 318 | | login-server | 74 |
| resources | 264 | | quest | 71 |
| admin | 237 | | entities | 72 |
| inventory | 210 | | ipc | 54 |
| combat | 179 | | skills | 51 |
| npc | 179 | | social | 48 |
| database | 141 | | cluster-server | 43 |
| world-core | 93 | | mail | 25 |

`@flyff/gateway` has **no test script at all** — one reason it is a deletion
candidate.

---

## Contributing to this list

If you test something against a real client and it works, say so in an issue —
user confirmation is the only signal that upgrades an item beyond "our checks
pass". If it breaks, that is even more useful: include the opcode, a hex dump,
and your client build.
