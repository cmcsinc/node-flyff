# Missing Features Audit — node-flyff

> **Superseded for fidelity:** For TS↔C++ behavioral deviations (formulas, packets,
> guards), see [`c++-fidelity-audit.md`](c++-fidelity-audit.md) (2026-07-27). This
> file remains for broader feature-gap coverage (systems not yet ported at all).
>
> **Generated:** 2026-07-21 (enriched from v19 C++ source scan)
> **Scope:** All gameplay systems the v19 Flyff C++ server ships vs. what node-flyff has implemented.
> **C++ source roots:** `h:\flyff\v19\Source\Source\` — `WORLDSERVER\DPSrvr.cpp` (C→S dispatch), `_Common\*` (game logic), `_AIInterface\*` (NPC FSM), `_Network\MsgHdr.h` (opcodes), `Neuz\DPClient.cpp` (S→C Send* callers), `_Database\DbManagerSave.cpp` (persistence).
> **NPC team is actively touching:** `entities/mover.ts`, `managers/spawn.manager.ts`, `net/snapshot/npcSnapshot.serializer.ts`, NPC-snapshot branch of `handlers/join.handler.ts`, `data/movers/*.yml`, `schemas/mover.schema.ts`. Everything recommended below avoids those files.

---

## 1. Current State — What Works End-to-End

A real v19 Neuz client can today: authenticate at Login, pick a server, create/select a character, land in Flaris, see the local player + static NPC/monster spawns, walk around (`PLAYERMOVED`/`PLAYERCORR`/`PLAYERMOVED2`/`PLAYERANGLE`), set facing/target, run motion loops, chat in zone (plain text, **no** `/cmd`), open script dialogs, revive, query peer data, leave cleanly.

**WAL journal shipped 2026-07-21** — `Journal` (`@flyff/database`) + `JournalReplayer` (world-server `systems/`), boot recovery wired before the TCP listener. Tier 2 inventory handlers are now unblocked.

### Implemented inbound world handlers (17)
`JOIN`, `MAP_KEY`, `QUERY_PLAYER_DATA`, `SNAPSHOT` (DESTPOS), `PLAYERMOVED`, `PLAYERBEHAVIOR`, `PLAYERCORR`, `PLAYERMOVED2`, `PLAYERANGLE`, `CHAT`, `MOTION`, `SETTARGET`, `QUERYGETPOS`, `GETPOS`, `SCRIPTDLG` (stub), `REVIVAL` (no death state), `LEAVE`.

### Implemented infra
Login (auth + server list + cache addr), Cluster (char list/create/select/handoff), World IPC registrar + listener, ZoneManager (256-unit grid), SpawnManager (static, no respawn), MovementService, `Journal` + `JournalReplayer`. DB tables: `accounts`, `characters`, `inventory`, `bank`, `skills`, `quick_slots` (last three unreached by code). Resource loaders: items, movers, skills, zones.

### Empty
`systems/` has only `journalReplayer.ts`. No combat, AI, exp, drop, skill, stats, or buff systems.

---

## 2. Tiers

| Tier | Meaning |
|------|---------|
| **0 — Blocker** | Gates the most gameplay. |
| **1 — Self-contained** | No combat/WAL/skill dependency. Parallel-safe. |
| **2 — WAL-gated (now ready)** | Inventory mutations — WAL journal is in, these can ship. |
| **3 — Combat-gated** | AI, drops, exp, PvP — need combat + stats first. |
| **4 — Large social** | Guild, quest, PvP — multi-subsystem; research-first. |

---

## 3. Tier 0 — Remaining Blocker

### 3.1 Combat System (`systems/combat.system.ts`)
- **Status:** 🔴 Blocked. No formulas, no damage path, no death state.
- **C++ source:** `_Common\MoverAttack.cpp`, `WORLDSERVER\AttackArbiter.cpp` (~900 lines), `_Common\MoverActEvent.cpp`, `Mover.cpp::DoDie` (line 5131), `SubDieDecExp` (7157).
- **Formulas to port:** `CalcATK`, `CalcDamage`, `PostCalcDamage`, `PostAsalraalaikum` (BP asal), `GetWeaponPlusDamage`, `GetAttackSpeed`, `GetHR`, `GetHitMinMax`, `CalcDefense/Core/Player/NPC`, `GetCriticalProb`, `CalcLinkAttackDamage`, `GetBlockFactor`, `GetDamageMultiplier`, `MinusHP`, `StealHP`.
- **C→S opcodes:** `MELEE_ATTACK=0x00ff0010` (OnMeleeAttack:4131), `MELEE_ATTACK2=0x00ff0014` (4180), `MAGIC_ATTACK=0x00ff0011` (OnMagicAttack:4214 — `+nMagicPower,idSfxHit`), `RANGE_ATTACK=0x00ff0012` (OnRangeAttack:4242 — `+dwItemID,idSfxHit`), `SFX_HIT=0x00ff00d2` (4045).
- **S→C:** `SNAPSHOTTYPE_DAMAGE`, `SNAPSHOTTYPE_MOVER_DEATH`, `PACKETTYPE_DAMAGE=0x00ff000c`, `PACKETTYPE_MOVERDEATH=0x00ff0013`, `g_UserMng.AddMeleeAttack/AddMagicAttack/AddRangeAttack`.
- **`__HACK_1023`:** adds trailing FLOAT to MELEE_ATTACK/DOEQUIP/DOUSEITEM reads.
- **Complexity:** LARGE. Plan a dedicated researcher dive per formula family.

---

## 4. Tier 1 — Self-contained, Parallel-safe (pick any)

### 4.1 Chat `/cmd` Router + Whisper/Shout  ⭐ smallest win
- **Now:** `ChatService` drops `/`-leading lines. No whisper/shout/party/guild routing.
- **C→S:** `CHAT=0x00ff0000` (OnChat:663 — `sChat[1024]`, `/` → `ParsingCommand`), `WHISPER=0x00ff00d4`, `SAY=0x00ff00e0`, `SHOUT=0x00ff00e1`, `GUILD_CHAT=0xffffff39`, `PARTYCHAT=0xffffff59`, `GMSAY=0x00ff00ed`.
- **Router gates:** `m_dwAuthorization` (GM); commands include `/move`,`/summon`,`/goto` etc.
- **Complexity:** SMALL (router); MEDIUM (whisper/party/guild routing).

### 4.2 Friend / Messenger
- **C→S:** `ADDFRIENDREQEST=0xffffff61` (OnAddFriendReqest:1496), `ADDFRIENDNAMEREQEST=0xffffff6b`, `ADDFRIENDCANCEL=0xffffff62`, `GETFRIENDNAME=0xffffff63`, `GETFRIENDSTATE=0xffffff64`, `SETFRIENDSTATE=0xffffff67`, `REMOVEFRIEND=0xffffff6a`, `BLOCK=0xffffff5a` (OnBlock:4971).
- **S→C:** `ADDFRIEND=0xffffff60`, `ADDFRIENDJOIN=0xffffff65`, `ADDFRIENDLOGOUT=0xffffff66`, `ADD_MESSENGER=0x70000000`, `DELETE_MESSENGER=0x70000001`, `UPDATE_MESSENGER=0x70000002`.
- **DB:** needs `friend` table (not yet in migration).
- **Complexity:** MEDIUM. Zero combat/skill coupling.

### 4.3 Mail
- **C→S:** `QUERYPOSTMAIL=0x0000001a` (OnQueryPostMail:7084 — `nItem,nItemNum,lpszReceiver,nGold,lpszTitle,lpszText`), `QUERYMAILBOX=0x0000001d`, `QUERYREMOVEMAIL=0x0000001b`, `QUERYGETMAILITEM=0x0000001c`, `QUERYGETMAILGOLD=0x0000001f`, `READMAIL=0x00000024`.
- **S→C:** `ALLMAIL=0x0000001e`.
- **DB:** needs `mail` table. Item-attachment path needs inventory (stub initially).
- **Complexity:** MEDIUM.

### 4.4 Party (in-memory core)
- **C→S:** `MEMBERREQUEST=0xffffff17` (OnPartyRequest:1455), `MEMBERREQUESTCANCLE=0xffffff18`, `CHANGETROUP=0xffffff19`, `CHANPARTYNAME=0xffffff1a`, `SETPARTYMODE=0xffffff1c`, `PARTYCHANGEITEMMODE=0xffffff20`, `PARTYCHANGEEXPMODE=0xffffff21`, `PARTYCHANGELEADER=0xffffff2f`, `PARTYSKILLUSE=0xffffff1b`.
- **S→C:** `ADDPARTYMEMBER=0xffffff11`, `REMOVEPARTYMEMBER=0xffffff12`, `ADDPLAYERPARTY=0xffffff13`, `REMOVEPLAYERPARTY=0xffffff14`, `ADDPARTYEXP=0xffffff1e`, `SETPARTYEXP=0xffffff22`, `PARTYNAME=0xffffff70`, `PARTYLEVEL=0xf000b009`.
- **Complexity:** MEDIUM. Exp-share hooks defer to combat phase.

### 4.5 Mining / Gathering
- **C→S:** `QUERY_START_COLLECTING=0xf000f800` (OnQueryStartCollecting:10582), `QUERY_STOP_COLLECTING=0xf000f801`.
- **S→C:** `COLLECTION_CERTIFY=0x88100220` + `CREATEITEM`.
- **Needs:** `propCollect` resource + inventory grants. Timed gather cycle with chance per `CCollectingProperty`.
- **Complexity:** SMALL. Fully self-contained.

### 4.6 Day/Night + Weather
- **Driven by Core** — world only receives. `ENVIRONMENTSNOW=0xffffff50` … `ENVIRONMENTALL=0xffffff56`.
- **Blocker:** needs a Core-like cron role. Defer until architecture has it.
- **Complexity:** SMALL once Core exists.

---

## 5. Tier 2 — Inventory Mutations (WAL now ready ✅)

WAL journal shipped. These can be built; each calls `journal.append()` before ack + registers a replayer.

| Opcode | Hex | C++ handler (DPSrvr.cpp) | Notes |
|--------|-----|-----|-------|
| `MOVEITEM` | `0x00ff0006` | OnMoveItem:787 | `nItemType,nSrcIndex,nDstIndex` |
| `DROPITEM` | `0x00ff0007` | OnDropItem:813 | `dwItemType,dwItemId,nItemNum,vPos` |
| `DOEQUIP` | `0x00ff000b` | OnDoEquip:735 | `nId,nPart`; `__HACK_1023` trailing FLOAT |
| `DOUSEITEM` | `0x00ff0021` | OnDoUseItem:2601 | `dwData,dwItemId,objid,nPart,bResult`; `__HACK_1023` |
| `BUYITEM` | `0x00ff00b3` | OnBuyItem:2804 | `cTab,nId,nNum,dwItemId`; perin 500ms rate-limit |
| `SELLITEM` | `0x00ff00b4` | OnSellItem:3074 | |
| `OPENSHOPWND` | `0x00ff00b1` | OnOpenShopWnd:2744 | NPC shop proximity check |
| `CLOSESHOPWND` | `0x00ff00b2` | OnCloseShopWnd:2793 | |
| `PUTITEMBACK` (bank) | `0xffffff42` | OnPutItemBank:3430 | bank table exists |
| `GETITEMBACK` (bank) | `0xffffff44` | OnGetItemBank:3791 | |
| `PUTGOLDBACK` | `0xffffff43` | OnPutGoldBank:3848 | |
| `GETGOLDBACK` | `0xffffff45` | OnGetGoldBank:3900 | |
| `TRADE` family | `0x00ff00a0–a8` | OnTrade:8478 etc. | dual-user state machine, WAL-mandatory |
| `REPAIRITEM` | `0x00ff00b5` | OnRepairItem:4858 | |

**Perin note:** `__PERIN_BUY_BUG` rate-limit (500ms between buys); `PERIN_VALUE` fixed conversion. Anti-dupe critical.

**Sub-systems deferred** (large, niche): piercing (`0xf000b025`), awakening (`0x70000008`), upgrade/enchant (`0xf000b024`/`0xf000b050`), ultimate (`0xf000f110–115`), player-vendor (`0x00ff00a9–ae`).

---

## 6. Tier 3 — Combat-Gated

| Domain | C++ | Key opcodes | Notes |
|--------|-----|-------------|-------|
| **Skills** | `MoverSkill.cpp`, `DPSrvrLux.cpp:32`, `SkillInfluence.cpp`, `CooltimeMgr.cpp` | `USESKILL=0x00ff0020`, `TELESKILL=0x00ff0025`, `SKILLTASKBAR=0xffffff0e`, `DOUSESKILLPOINT=0x000f0003` | Needs propSkill/propSkillAdd parse. LARGE. |
| **Buffs** | `buff.cpp`, `moverbuff.cpp`, `Ctrl.cpp::ProcessSkillInfluence` | `SFX_ID=0x00ff0022`, `STATEMODE=0xffffff7a`, snapshots `ADD/REMOVE_SKILL_INFLUENCE` | Tick-driven; must fit <10ms budget. |
| **Exp** | `Mover.cpp:6085–6395` (`AddExperience*`) | S→C `SETEXPERIENCE=0x00ff000d`, `ADDEXPERIENCE=0x00ff00d0` | Fires from `DoDie`. Needs level table. |
| **Drops** | `Mover.cpp:7238,7260`, `Project.cpp` | S→C `CREATEITEM=0x00ff0005`, `DROPGOLD=0x00ff0008` | `lpMoverProp->dwDropItem` + EventLua. |
| **Stats HP/MP/FP** | `MoverParam.cpp`, `OnIncStatLevel:1204`, `OnModifyStatus:10345` | `INC_STAT_LEVEL=0x00ff00c4`, `MODIFY_STATUS=0xf000f501`, `CHANGEJOB=0x00000f32` | Needs max-HP formulas from stats+buffs. |
| **NPC AI** | `AIMonster.cpp` (FSM: INIT/IDLE/WANDER/EVADE/RAGE/…), `FSM.cpp`, boss AIs | `SETMONSTERRESPAWN=0x0000ff07`, `CREATEMONSTER=0x0000002a` | Pathfinding = Worker Thread candidate. |
| **Pets** | `pet.cpp`, `AIPet.cpp` | `PET_RELEASE=0xf000f600`, `USE_PET_FEED=0xf000f601`, `TRANSFORM_ITEM=0x8FFF000D` | Pet AI engages combat. |
| **PvP/PK** | `AttackArbiter.cpp::OnDiedPVP:821`, `KarmaProp` | `MODE=0xffffff7b`, `DUELREQUEST=0xffffff23`, wanted `NW_WANTED_*`, guild war `DECL_GUILD_WAR=0xf000b036` | Karma `m_nSlaughter`, PINK/RED names. |

---

## 7. Tier 4 — Large Social Systems

### Guild
- **C→S (subset):** `CREATE_GUILD=0xffffff31`, `DESTROY_GUILD=0xffffff32`, `ADD/REMOVE_GUILD_MEMBER=0xffffff33/34`, `GUILD_INVITE=0xffffff35`, `GUILD_CLASS=0xffffff74`, `GUILD_NICKNAME=0xffffff75`, logo/contribution/notice `0xf000b010–12`, guild war `0xf000b036+`, guild house `0x88100000+`, guild bank `0xf000b020–22`, ranking `0xf000b04e`.
- **Sub-systems:** war, 1to1 combat, house, bank, quest, ranking (cross-server). Build base CRUD first; defer the rest.
- **Complexity:** LARGE. Needs `guild`/`guild_member`/`guild_bank` tables.

### Quest
- **C→S:** `SETQUEST=0x00ff0ff3` (dead — never grant), `REMOVEQUEST=0x00ff0026` (OnRemoveQuest:1609), `SCRIPT_CREATE_ITEM=0x00ff0ff4` (dead), `SCRIPT_ADD_GOLD=0x00ff0ff5` (dead), `SCRIPT_ADD_EXP=0x00ff0ff9`, `QUEST_CHECK=0x88100110`, `QUESTHELPER_REQNPCPOS=0x70005000`.
- **Blocker:** `WorldDialog.dll` is a binary dialog/quest script VM — node-flyff has `scriptDlg.handler.ts` stub but no interpreter. Needs a Lua or custom dialog VM. LARGE.

---

## 8. What to Pick Up While the NPC Team Works

Ranked by leverage × zero file conflict (WAL journal already done):

1. **⭐ Inventory mutation handlers (Tier 2)** — WAL is in. `MOVEITEM`/`DROPITEM`/`DOUSEITEM`/`DOEQUIP` ship fastest; reuse `InventoryRepository` (already has move/split/merge). `BUYITEM`/`SELLITEM` + shops next.
2. **Bank handlers** — `bank` table already exists; opcodes `0xffffff40–49`. WAL-pair.
3. **Chat `/cmd` router + whisper/shout** — tiny, immediate QA value.
4. **Friend/Messenger** — self-contained, zero combat coupling. Needs `friend` migration.
5. **Mining/Gathering** — small self-contained minigame.

**Avoid until NPC team merges:** `entities/mover.ts`, `managers/spawn.manager.ts`, `net/snapshot/npcSnapshot.serializer.ts`, NPC-snapshot branch of `handlers/join.handler.ts`, `data/movers/*.yml`.

---

## 9. Implementation Risks (cross-cutting)

1. **v19 DB layer is 100% stored procedures** (`usp_Master_Update`, `usp_SaveSkill`, … in `_Database\DbManagerSave.cpp`). Zero port-over — every repository must be rewritten against Knex query builders.
2. **Combat formulas are ~1900 lines** (`AttackArbiter.cpp` ~900 + `MoverAttack.cpp` 8 methods). Plan one researcher dive per formula family before coding.
3. **AI FSM + pathfinding** (`AIMonster.cpp` 1300+ lines, `layeredlinkmap.cpp`). Boss-specific AIs (`AIBigMuscle`, `AIClockWorks`, `AIBear`, `AIKrrr`, `aimeteonyker`). Pathfinder is the Worker-Thread candidate per `05-performance.md`.
4. **WAL is gating** for inventory/bank/trade/mail-item — ✅ now landed.
5. **WorldDialog.dll** — binary quest/dialog VM. No drop-in TS equivalent; needs an interpreter decision (Lua vs custom).
6. **SkillInfluence / CooltimeMgr / buff propagation** are tick-driven — slot into 50ms tick without breaking the <10ms budget.
7. **Guild** spans 6 sub-systems + cross-server Core messages — sequence base CRUD first.

---

## 10. Opcode Gaps in `packages/core/src/constants/opcodes.ts`

These v19 opcodes are referenced by the C++ source but **not yet declared** in `opcodes.ts`. Add them (with the `PACKETTYPE_*` C++ name) before implementing their handlers:

- Combat: `MELEE_ATTACK2=0x00ff0014`, `SFX_HIT=0x00ff00d2`, `SFX_ID=0x00ff0022`, `SFX_CLEAR=0x00ff0024`.
- Skills: `TELESKILL=0x00ff0025`, `ENDSKILLQUEUE=0x00ff00d5`, `SKILLTASKBAR=0xffffff0e`, `DOUSESKILLPOINT=0x000f0003`, `PARTYSKILLUSE=0xffffff1b`, `NPC_BUFF=0xf000f813`.
- Stats: `INC_STAT_LEVEL=0x00ff00c4`, `INC_JOB_LEVEL=0x00ff00c5`, `MODIFY_STATUS=0xf000f501`, `CHANGEJOB=0x00000f32`, `SEND_TO_SERVER_EXP=0x00000f31`.
- Movement: `PLAYERSETDESTOBJ=0xffffff07`, `PLAYERCORR2=0xffffff06`, `QUERYGETDESTOBJ=0xffffff72`, `GETDESTOBJ=0xffffff73`, `SETNAVIPOINT=0x00ff0018`, `SHIP_ACTMSG=0x00ff0015`.
- Inventory: `REMOVEITEM=0x00ff0009`, `SYNCITEM=0x00ff000a`, `REMOVEINVENITEM=0x00ff0019`, `REPAIRITEM=0x00ff00b5`, `DO_USE_ITEM_TARGET=0x70000004`, `DO_USE_ITEM_INPUT=0x8FFFFF00`, upgrade/pierce/awaken family.
- Shops: `OPENSHOPWND=0x00ff00b1`, `CLOSESHOPWND=0x00ff00b2`, `SELLITEM=0x00ff00b4`, `BUYCHIPITEM=0x00ff00b6`.
- Bank: `0xffffff40–49` (open/close/put/get/move/pass/confirm/bank-to-bank).
- Trade: `0x00ff00a0–a8`, `TRADECONFIRM=0x00ff002f`.
- Party: `0xffffff11–22`, `0xffffff2f`, `0xffffff70–71`.
- Guild: `0xffffff31–39`, `0xffffff74–77`, `0xf000b009–12`, war `0xf000b036+`, house `0x88100000+`, bank `0xf000b020–22`, ranking `0xf000b043/e`.
- Friend/Messenger: `0xffffff5a`, `0xffffff60–6e`, `0x70000000–02`.
- Mail: `0x0000001a–1f`, `0x00000024`, `0x88100240–41`.
- Pets: `0xf000f600–05`, `0x70000009`, `0x8FFFFF01`, `0x8FFF000D/F`, `0x88000000–01`.
- PvP: `0xffffff23–2a`, wanted `0x00ff00ef/f0`, guild combat `0xf000d021+`, `0xf000f700+`.
- Mining: `0xf000f800–01`, `0x88100220`.
- AI/spawn: `SETMONSTERRESPAWN=0x0000ff07`, `CREATEMONSTER=0x0000002a`.
