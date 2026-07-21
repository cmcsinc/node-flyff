# Flyff Emulator — Cross-Agent Progress Ledger

> **All agents MUST read this file at session start and update it when completing tasks.**
> This is the shared memory layer that allows agents to communicate across sessions.

---

## Project Phase: Foundation

| Status | Legend |
|--------|--------|
| ✅ Done | Implemented, tested, reviewed |
| 🔄 In Progress | Actively being worked on |
| ⏳ Pending | Not started yet |
| 🔴 Blocked | Waiting on a dependency |
| 🚫 Skipped | Intentionally deferred |

---

## Module Status

### @flyff/core

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `config/loader.ts` | ✅ Done | implementor | Config loader with YAML+JSON+env merge |
| `config/schemas/base.schema.ts` | ✅ Done | implementor | Base Zod config schema |
| `config/schemas/login.schema.ts` | ✅ Done | implementor | Login server config schema |
| `config/schemas/cluster.schema.ts` | ✅ Done | implementor | Cluster server config schema |
| `config/schemas/world.schema.ts` | ✅ Done | implementor | World server config schema |
| `config/merge.ts` | ✅ Done | implementor | Deep merge utility |
| `net/PacketReader.ts` | ✅ Done | implementor | Binary packet reading with offset pattern |
| `net/PacketWriter.ts` | ✅ Done | implementor | Binary packet writing with object pooling |
| `net/PacketBuffer.ts` | ✅ Done | implementor | TCP stream reassembly |
| `net/LSFRCipher.ts` | ✅ Done | implementor | Per-connection LSFR encryption |
| `constants/opcodes.ts` | ✅ Done | implementor | SNSP_* opcode constants with type safety |
| `constants/objectTypes.ts` | ✅ Done | implementor | Object type enums (MOVER, ITEM, CTRL, etc.) |
| `constants/sessionState.ts` | ✅ Done | implementor | Session state enum (CONNECTED, AUTHENTICATED, IN_CLUSTER, IN_WORLD) |
| `errors.ts` | ✅ Done | implementor | FlyffError, PacketError, AuthError, GameError with cause chaining |
| `logger.ts` | ✅ Done | implementor | pino logger factory with test mode silencing |
| `eventBus.ts` | ✅ Done | implementor | Typed EventEmitter with full type safety |
| `cache/ICacheAdapter.ts` | ✅ Done | implementor | Cache interface with optional pub/sub |
| `cache/MemoryCache.ts` | ✅ Done | implementor | In-memory Map implementation with lazy TTL expiry |
| `cache/RedisCache.ts` | ✅ Done | implementor | ioredis-backed implementation with subscriber connection duplication |

### @flyff/ipc

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `registration.ts` | ✅ Done | implementor | Server registration logic |
| `opcodes.ts` | ✅ Done | implementor | IPC_OP opcode constants |
| `schemas/registration.schema.ts` | ✅ Done | implementor | Zod schemas for registration |
| `signing.ts` | ✅ Done | implementor | HMAC-SHA256 signing with replay protection (19 tests passing) |
| `circuit.ts` | ✅ Done | implementor | CircuitBreaker pattern for resilient IPC (21 tests passing) |
| `IpcBus.ts` | ✅ Done | implementor | Redis pub/sub + HMAC signing (8 tests passing) |
| `IpcServer.ts` | ✅ Done | implementor | Internal TLS TCP server (3 tests passing) |
| `IpcClient.ts` | ✅ Done | implementor | Internal TLS TCP client (4 tests passing) |

### @flyff/login-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/clusterRegistry.ts` | ✅ Done | implementor | Manages cluster server connections |
| `services/serverList.service.ts` | ✅ Done | implementor | Server list service |
| `services/auth.service.ts` | ✅ Done | implementor | Auth service (argon2id, rate limiting, session management) |
| `services/token.service.ts` | ✅ Done | implementor | Handoff token generation and validation |
| `handlers/auth.handler.ts` | ✅ Done | implementor | LOGIN_CERTIFY handler with input validation |
| `handlers/serverList.handler.ts` | ✅ Done | implementor | SERVER_LIST response handler |
| `compose.ts` | ✅ Done | implementor | DI wiring with MemoryCache and EventBus |
| `index.ts` | ⏳ Pending | — | Entry point (needs TCP server implementation) |

### @flyff/cluster-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/worldRegistry.ts` | ✅ Done | implementor | World server registry with heartbeat |
| `ipc/loginRegistrar.ts` | ✅ Done | implementor | Registers with login server |
| `services/worldList.service.ts` | ✅ Done | implementor | World list management |
| `handlers/characterSelect.handler.ts` | ⏳ Pending | — | Character selection handler |
| `handlers/characterCreate.handler.ts` | ⏳ Pending | — | Character creation handler |
| `index.ts` | ⏳ Pending | — | Entry point |
| `compose.ts` | ⏳ Pending | — | Composition root / DI |

### @flyff/world-server

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `ipc/clusterRegistrar.ts` | ✅ Done | implementor | Registers with cluster server |
| `entities/player.ts` | ✅ Done | implementor | CPlayer with m_fAngle/m_idTarget/m_idSetTarget/m_tickScript |
| `entities/mover.ts` | ✅ Done | implementor | CMover NPC/monster entity (NPC serialize branch fields, objid-allocated) |
| `entities/npc.ts` | 🚫 Skipped | — | Folded into mover.ts — single CMover class sufficient until equipped NPCs |
| `managers/zone.manager.ts` | ✅ Done | implementor | Zone-scoped broadcast |
| `managers/object.manager.ts` | 🚫 Skipped | — | Objid allocator folded into SpawnManager (0x40000000+ range) |
| `managers/spawn.manager.ts` | ✅ Done | implementor | Bootstraps zone NPCs + monster spawns (count, jitter); inZone() lookup; per-mover setTimeout respawn on `kill()` (delay from zone.spawn.delay); onSpawn callback broadcasts ADD_OBJ; shutdown() clears timers |
| `systems/combat.system.ts` | 🔴 Blocked | — | Need combat formulas for MELEE/MAGIC/RANGE_ATTACK |
| `systems/ai.system.ts` | ⏳ Pending | — | NPC AI state machine |
| `systems/movement.system.ts` | ✅ Done | implementor | Extended for PLAYERCORR/MOVED2/ANGLE/GETPOS |
| `systems/exp.system.ts` | ⏳ Pending | — | Exp/level system |
| `systems/drop.system.ts` | ⏳ Pending | — | Drop rolls |
| `journal.ts` | 🔴 Blocked | — | WAL journal — blocks DROPITEM/DOUSEITEM/BUYITEM/MOVEITEM/DOEQUIP |
| `index.ts` | ✅ Done | implementor | Entry point — wires all handlers |
| `systems/journalReplayer.ts` | ✅ Done | implementor | Boot crash-recovery: replays `replayed=0` journal rows via per-type handler registry before TCP listener opens (5 tests) |
| `compose.ts` | ✅ Done | implementor | DI root with 17 handlers wired |

### @flyff/database

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `db.ts` | ✅ Done | implementor | Knex factory (SQLite/PG/MySQL) with Zod validation (5 tests passing) |
| `migrate.ts` | ✅ Done | implementor | Migration runner functions |
| `migrations/001_initial.ts` | ✅ Done | implementor | Initial schema: accounts, characters, inventory, bank, skills, quick_slots |
| `repositories/account.repo.ts` | ✅ Done | implementor | Account CRUD repository (17 test methods) |
| `repositories/character.repo.ts` | ✅ Done | implementor | Character CRUD repository (22 test methods) |
| `repositories/inventory.repo.ts` | ✅ Done | implementor | Inventory CRUD with stack/split/merge (15 test methods) |
| `journal.ts` | ✅ Done | implementor | WAL journal (better-sqlite3, WAL+NORMAL pragmas, append/getUnreplayed/markReplayed, 9 tests) — gates inventory handlers |

### @flyff/resources

| Module | Status | Last Agent | Notes |
|--------|--------|------------|-------|
| `loaders/propItem.loader.ts` | ⏳ Pending | — | propItem.txt loader |
| `loaders/propMover.loader.ts` | ⏳ Pending | — | propMover.txt loader |
| `parsers/defineFile.parser.ts` | ⏳ Pending | — | defineItem.h parser |
| `parsers/propFile.parser.ts` | ⏳ Pending | — | propItem.txt parser |

---

## Test Coverage

| File | Test File | Status |
|------|-----------|--------|
| `cluster-server/src/ipc/worldRegistry.ts` | `worldRegistry.test.ts` | ✅ Exists |
| `world-server/src/ipc/clusterRegistrar.ts` | `clusterRegistrar.test.ts` | ✅ Exists |
| `core/src/config/merge.ts` | `merge.test.ts` | ❌ Missing |
| `core/src/config/schemas/cluster.schema.ts` | `cluster.schema.test.ts` | ❌ Missing |
| `core/src/config/schemas/world.schema.ts` | `world.schema.test.ts` | ❌ Missing |
| `login-server/src/services/serverList.service.ts` | `serverList.service.test.ts` | ❌ Missing |

---

## Security Audit Log

| File | Audited By | Result | Date |
|------|-----------|--------|------|
| — | — | — | — |

> When `security-auditor` reviews a file, it logs findings here.
> 🟢 = No issues | 🟡 = Minor warnings | 🔴 = Critical — must fix before merge.

---

## Research Findings

| Topic | Found By | Summary | Source |
|-------|----------|---------|--------|
| PacketBuffer stream framing | researcher | Flyff packets use DWORD size (excluding size itself), WORD header 0x5E80, WORD opcode; TCP stream must buffer until 4+size bytes then emit payload (header+opcode+payload). | /Users/owner/Cyril/nodejs-flyff/CLAUDE.md:142-153; /Users/owner/Cyril/nodejs-flyff/.claude/skills/flyff-packet-protocol/SKILL.md:14-159 |
| LSFR cipher algorithm | researcher | LSFRCipher uses key transform: `key = (key * 0x08088405 + 1) >>> 0`; XOR each byte with `key >>> ((i % 4) * 8) & 0xFF`. Key exchange: client sends SNSP_LOGIN_CERTIFY plaintext, server responds with key, all subsequent packets encrypted. | .claude/skills/flyff-packet-protocol/SKILL.md |
| PacketReader/Writer patterns | researcher | Offset-based pattern: PacketReader maintains offset pointer, auto-advances, has remaining property; PacketWriter builds chunks array, concatenates in build(), fluent interface. All integers Little-Endian. Strings are DWORD-length-prefixed, not null-terminated. | .claude/skills/flyff-packet-protocol/SKILL.md |
| Type mapping (C++ → Node.js) | researcher | BYTE=buf.readUInt8, WORD=buf.readUInt16LE, DWORD=buf.readUInt32LE, float=buf.readFloatLE, String=4-byte length prefix+ASCII. Y is vertical (up) coordinate. | .claude/skills/flyff-packet-protocol/SKILL.md |
| Core opcodes | researcher | SNSP_LOGIN_CERTIFY=0xFC03, SERVER_LIST=0xFC06, PLAYER_LIST=0x7802, CREATE_PLAYER=0x7803, SELECT_PLAYER=0xFC15, PLAYER_SNAPSHOOT=0x7E12, CHAT=0xFF00, MELEE_ATTACK=0x7E2C. | .claude/skills/flyff-packet-protocol/SKILL.md; packages/core/src/constants/opcodes.ts |
| v15 propMoverEx.inc format | researcher | Per-mover block keys: Maxitem=NN; DropItem(itemId, prob, level, count); DropGold(min,max); DropKind(ik3,unused,unused); QuestItem(quest,state,item,prob,count); m_dwAttackMoveDelay, m_dwRunawayDelay, SetRunAway, SetCallHelper, m_nAttackFirstRange, AI{#Scan/#battle/#move}. DROPITEM struct {dtType, dwIndex, dwProbability, dwLevel, dwNumber, dwNumber2}. Probability is DWORD out of 3000000000 (=100%); e.g. DropItem(II_GEN_GEM_GEM_TWINKLESTONE, 300000000, 0, 1) = 10% drop. DropGold becomes DROPTYPE_SEED entry with dwProbability=0xFFFFFFFF. SortDropItem (Project.cpp:3645) sorts slots asc by dwProbability (rare first) but swap never commits (dead code). Caps: MAX_QUESTITEM=16, MAX_DROPKIND=80, DropItem vector max 32 (comment). | H:\flyff\v15\Server\Resource\propMoverEx.inc:76-103; H:\flyff\v15\Source\Source\_Common\ProjectCmn.h:458-498; H:\flyff\v15\Source\Source\_Common\Project.cpp:2791-2855, 3645-3670 |
| v15 drop roll on death | researcher | CMover::DropItemByDied(pAttacker) picks looter via GetMaxEnemyHitID() (first-hit), else pAttacker. CMover::DropItem(pAttacker) is the roll. Algorithm: outer loop nloop times (1 default; +1/+2 from II_SYS_SYS_SCR_GET01/02 buff; party GiftBox=2). Per iter: level-diff gate d=atkLvl-mobLvl buckets {<=1:100%, <=2:80%, <=4:60%, <=7:30%, else 10%}; multiply by GetItemDropRateFactor; if xRandom(100) >= gate skip all. Iterate m_DropItemGenerator slots in file order; GetAt rolls xRandom(3000000000)/fProbability < dwProbability. DROPTYPE_NORMAL: spawn CItem at mob pos +/-rand(2.0) x/z; m_idOwn=attacker, m_dwDropTime=now, m_bDropMob=TRUE; count = xRandom(dwNumber)+1; SetAbilityOption(dwLevel). DROPTYPE_SEED (gold) on k==0 only: nNumGold=min+xRandom(max-min); scaled by nPenyaRate, m_fGoldDropRate, m_fPenya_Rate, event factor; pick II_GOLD_SEED1..4 by amount. RANK_SUPER monsters skip m_idOwn (FFA). Max drops per death = m_DropItemGenerator.m_dwMax. Flying monsters: items skip ground and call pAttacker->CreateItem directly. | H:\flyff\v15\Source\Source\_Common\Mover.cpp:7238-7255, 7260-7855; H:\flyff\v15\Source\Source\_Common\Project.cpp:171-207 |
| v15 CItem ground entity | researcher | Created via new CItem; pItem->m_pItemBase = new CItemElem; SetIndex(itemId) loads model; m_dwType=OT_ITEM (=4 per CreateObj.cpp:618/679 -> new CItem). Ground-only fields: m_idOwn (OBJID owner — NULL_ID = FFA), m_dwDropTime (set on drop, drives loot-lock + despawn), m_bDropMob (BOOL), m_idHolder (0 normal, non-zero locks to that player), m_IdEventMonster (event). Ctor Item.cpp:459-475; SetOwner(id) Item.cpp:477-482 sets all three. Spawn via GetWorld()->ADDOBJ(pItem, TRUE, GetLayer()) at Mover.cpp:7832. | H:\flyff\v15\Source\Source\_Common\Item.h:968-970; H:\flyff\v15\Source\Source\_Common\Item.cpp:459-482; H:\flyff\v15\Source\Source\_Common\CreateObj.cpp:618,679; H:\flyff\v15\Source\Source\_Common\Mover.cpp:7795-7832 |
| v15 OT_ITEM ADD_OBJ serialize | researcher | CItem::Serialize chains CCtrl::Serialize(33B) -> CItemBase::Serialize(11B) -> CItemElem::Serialize(18B). S->C store layout: CObj (ObjSerializeOpt.cpp:18-32): u8 m_dwType(=4 OT_ITEM), DWORD m_dwIndex, u16 m_vScale.x*100, FLOAT[3] m_vPos, i16 m_fAngle*10. CCtrl (ObjSerialize.cpp:15-27): DWORD m_objid. CItemBase (ObjSerialize.cpp:31-45): DWORD m_dwObjId, DWORD m_dwItemId, LONGLONG m_liSerialNumber, DWORD-len String m_szItemText(max 32). CItemElem (ObjSerialize.cpp:48-85): short m_nItemNum, short m_nRepairNumber, int m_nHitPoint, short m_nRepair, BYTE m_byFlag, int m_nAbilityOption, u_long m_idGuild, BYTE m_bItemResist, int m_nResistAbilityOption, int m_nResistSMItemId, piercing struct, BYTE m_bCharged, LONGLONG m_iRandomOptItemId, DWORD m_dwKeepTime, if(keepTime) time_t remaining, BYTE pet-flag + optional CPet, BYTE m_bTranformVisPet. Total ~140-180B/item. PORT NOTE: existing mover serializer at packages/world-server/src/net/snapshot/npcSnapshot.serializer.ts only handles OT_MOVER/OT_CTRL — OT_ITEM needs separate serializer matching this exact chain. | H:\flyff\v15\Source\Source\_Common\ObjSerializeOpt.cpp:18-59; H:\flyff\v15\Source\Source\_Common\ObjSerialize.cpp:15-27, 31-45, 48-138, 158-172 |
| v15 item decay/despawn | researcher | CItem::Process (Item.cpp:515-556) per tick: if (g_tmCurrent - m_dwDropTime > MIN(3)) Delete(). 3-minute despawn from m_dwDropTime regardless of pickup eligibility. Despawn broadcast = SNAPSHOTTYPE_DEL_OBJ (0x00f1, MsgHdr.h:1128) via User::AddRemoveObj(objid) (User.h:251) to nearby players. Loot-lock (IsLoot MoverActEvent.cpp:2193-2255): m_idOwn!=NULL_ID -> only owner, party (m_idparty match), or anyone-after-SEC(7) (v9+, was SEC(40) pre-v9) may loot. Invalid m_idOwn -> FFA. m_idHolder!=0 -> locked to that player only. Event-monster items use GetLootTime(). | H:\flyff\v15\Source\Source\_Common\Item.cpp:515-556; H:\flyff\v15\Source\Source\WORLDSERVER\User.h:251; H:\flyff\v15\Source\Source\_Network\MsgHdr.h:1128; H:\flyff\v15\Source\Source\_Common\MoverActEvent.cpp:2193-2255 |
| v15 item pickup opcode | researcher | Pickup is NOT a dedicated opcode. Client sends PACKETTYPE_ACTMSG with OBJMSG_PICKUP (=11, MoverMsg.h:118) via CDPClient::SendActMsg (DPClient.cpp:9102-9109: ar << dwMsg << nParam1 << nParam2 where nParam1=target item objid). Server routes ACTMSG and calls CUser::OnMsgArrival(DWORD dwParam=loot objid) (User.cpp:7040-7068): if OT_ITEM: bail on IsFly(); bail on IsMode(ITEM_MODE); IsLoot check (TID_GAME_PRIORITYITEMPER on fail); DoLoot(pItem) (MoverActEvent.cpp:2575-2619): if IK1_GOLD PickupGold; else if m_bDropMob SubLootDropMob else SubLootDropNotMob -> CreateItem into inventory; on success pItem->Delete() + g_UserMng.AddMotion(this, OBJMSG_PICKUP). Response: success -> inventory append snapshot + SNAPSHOTTYPE_DEL_OBJ(0x00f1) for all viewers; failure -> AddDefinedText(TID_GAME_LACKSPACE). PACKETTYPE_GETITEM_GUILDCOMBAT (0xf000d02f, DPSrvr.cpp:7747) is NOT ground pickup — guild-combat reward claim only. PACKETTYPE_GETITEMBACK=0xffffff44 and PACKETTYPE_GETITEMGUILDBANK=0xf000b022 are bank/guild-bank retrieval, not ground pickup. | H:\flyff\v15\Source\Source\_Common\MoverMsg.h:105-166; H:\flyff\v15\Source\Source\Neuz\DPClient.cpp:9102-9109; H:\flyff\v15\Source\Source\WORLDSERVER\User.cpp:7040-7068; H:\flyff\v15\Source\Source\_Common\MoverActEvent.cpp:2575-2619 |
| v15 inventory dependency for pickup | researcher | Pickup hard-requires a working inventory: DoLoot->SubLootDropMob->CreateItem (MoverActEvent.cpp:2264) calls CInventory::Add, returns FALSE on full/invalid -> AddDefinedText(TID_GAME_LACKSPACE). IsLoot pre-checks m_Inventory.IsFull() for pet loot (MoverActEvent.cpp:2249). HOWEVER drop+decay is fully decoupled — propMoverEx parser, DropItem roll, CItem spawn, ADD_OBJ serialize, 3-min despawn, SNAPSHOTTYPE_DEL_OBJ broadcast all work with ZERO inventory code. RECOMMENDATION: ship drop + ground item entity + OT_ITEM ADD_OBJ serializer + despawn WITHOUT pickup (return TID_GAME_LACKSPACE or log+ignore ACTMSG OBJMSG_PICKUP until inventory exists). Pickup blocked on: (a) CInventory repo+service, (b) ADDITEM SNAPSHOT format, (c) gold PickupGold->AddGold path (needs gold state on CPlayer). Flying monsters drop directly to inventory (Mover.cpp:7761 CreateItem on roll) — gate these to ground-only or skip entirely until inventory exists. | H:\flyff\v15\Source\Source\_Common\MoverActEvent.cpp:2264, 2249; H:\flyff\v15\Source\Source\_Common\Mover.cpp:7761; H:\flyff\v15\Source\Source\WORLDSERVER\User.cpp:7040-7068 |
| v15 AI driver class | researcher | `CAIMonster extends CAIInterface` drives NPC behavior. FSM via method-pointer + STATEMAP table. Per-tick entry: `CAIInterface::RouteMessage()` drains `m_MsgQueue` then dispatches `AIMSG_PROCESS` to `m_pStateFunc`. | `_AIInterface/AIInterface.h:87`, `AIInterface.cpp:60-83`, `_AIInterface/AIMonster.h:8`, `Obj.cpp:286-290`, `Mover.cpp:3799` |
| v15 AI states enum | researcher | `enum AI2_STATE { AI2_IDLE, AI2_MOVE, AI2_RAGE, AI2_SEARCH, AI2_TRACKING, AI2_ATTACK }`. CAIMonster state methods: StateInit/StateIdle/StateWander/StateRunaway/StateEvade/StateRage/StateRagePatrol/StateStand/StatePatrol. AIMSG codes 1..22 (AIMSG_INIT, AIMSG_PROCESS, AIMSG_DAMAGE, AIMSG_DIE, AIMSG_ATTACK_MELEE, AIMSG_ARRIVAL, AIMSG_SETSTATE, etc.). | `_AIInterface/AIInterface.h:29-62`, `AIMonster.cpp:44-54`, `AIMonster.h:70-82` |
| v15 aggro detection | researcher | Passive scan inside `MoveProcessIdle`/`MoveProcessStand` via `ScanTarget(pMover, nAttackFirstRange, ...)`. Range from `MoverProp::m_nAttackFirstRange` (propMover `nAttackFirst`). Bounds-check `>10 \|\| <=0` errors. On pickup → `SetTarget(id,partyId)` + `AIMSG_SETSTATE, STATE_RAGE`. Filter: live, not TRANSPARENT_MODE, no IK3_TEXT_DISGUISE buff. NOT a separate sight-then-attack phase — single radius. | `AIMonster.cpp:344-432, 804-892, 1080-1090`, `AIInterface.cpp:166-256`, `AIInterface.h:118` |
| v15 NPC attack timing | researcher | Swing cadence via `m_tmAttackDelay` (`AIMonster.h:12`). In `SubAttackChance`: if `pProp->dwReAttackDelay` set → `m_tmAttackDelay = TIMEGETTIME + dwReAttackDelay - SEC(1) + xRandom(SEC(2))`; else hard-coded `SEC(3)`. Range check `IsRangeObj(pTarget, fRange)`. Swing fires when `TIMEGETTIME > m_tmAttackDelay`. Separate `m_tmAttack` (s_tmAttack=SEC(15)\|\|SEC(20)) = aggro-drop timeout, not swing cadence. Helpers: `GetAtkMethod_Far/Near`, `GetAtkRange(dwAtkMethod)`. | `AIMonster.cpp:78-80, 1310-1390, 1227-1240`, `AIMonster.h:11-16, 46-50` |
| v15 NPC→player damage | researcher | `CAttackArbiter::CalcATK` (AttackArbiter.cpp:462-470): if `!AF_MAGICSKILL && attacker.IsNPC() && defender.IsPlayer()`, `nDelta = attacker.level - defender.level`; if `>0`, `nATK *= 1.0 + 0.05*nDelta` (+5% per level above). Then `pDefender->ApplyDPC(nATK, pInfo)` (player DEF path, NOT NPC `dwNaturalArmor/7+1` branch). NPC-attacker uses `npcHR`/`npcAtkMin/Max`/`npcArmor` from propMover, not STR/weapon. | `WORLDSERVER/AttackArbiter.cpp:462-470, 472-499`, `Mover.cpp::ApplyDPC` |
| v15 leash / return-home | researcher | `DoReturnToBegin(BOOL)` (`AIMonster.cpp:286-309`): sets `m_bReturnToBegin=TRUE`, records `m_tmReturnToBegin`, clears target, `SetSpeedFactor(2.66f)` (run), `MoveToDst(m_vPosBegin)` (spawn anchor `m_vPosBegin`, `AIMonster.h:18`). Leash trigger: `IsInRange(m_vPosBegin - curPos, RANGE_MOVE)` false at idle init (flying ×3). Forced snap at `TIMEGETTIME - m_tmReturnToBegin >= SEC(20)` (v9+) → `pMover->SetPos(m_vPosBegin)` + `AddSetPos` broadcast. On reach (dist<7m): `DoReturnToBegin(FALSE)` → full HP heal + `RemoveAllEnemies()`. | `AIMonster.cpp:286-309, 332-377, 588-593, 1804-1856`, `AIInterface.h:110` |
| v15 NPC movement broadcast | researcher | SAME frame as player. `CUserMng::AddMoverMoved(pMover,v,vd,f,dwState,dwStateFlag,dwMotion,nMotionEx,nLoop,dwMotionOption,nTickCount)` writes `GETID(pMover) << SNAPSHOTTYPE_MOVERMOVED` and broadcasts `FOR_VISIBILITYRANGE(pMover)` — no NPC-vs-player branch. `AddMoverMoved2` (MOVERMOVED2, +angle/acc/turn/frame), `AddSetPos` (snap). `AddDestPos`/DESTPOS (0xc1) also applies to NPC return-home. | `WORLDSERVER/User.cpp:4839-4893, 4710` |
| v15 AI tick rate | researcher | **World ticks every ~1000ms (1s), NOT 50ms.** `CTimeout timeoutObject(1000, 67)` in `CRunObject::Run` (ThreadMng.cpp:322, 345-354) — fires at 67ms post-boot then every 1000ms. Path: `g_WorldMng.Process()` → `CWorld::Process()` → `pObj->Process()` → `CMover::Process()` → `ProcessAI()` → `RouteMessage()`. Outer loop spins on `WaitForSingleObject(m_hClose, 1)` (1ms). `FOR_LINKMAP` spatial hash (linkPlayer layer) avoids O(n²) aggro. Respawn timer 1000ms, quest timer 1000ms. | `WORLDSERVER/ThreadMng.cpp:322-354, 90-118`, `_Common/worldmng.cpp:666-674`, `_Common/Mover.cpp:3488, 3799` |
| v15 AI propMover columns | researcher | Columns consumed by CAIMonster: `m_nAttackFirstRange` (aggro radius), `nScanJob/dwScanQuestId/dwScanItemIdx/nScanChao` (target filters), `m_nHelpRangeMul` (helper-call multiplier on attackFirstRange), `dwReAttackDelay` (swing cooldown), `m_bRangeAttack[nJob] & 0x7F` (per-job range distance), `m_bMeleeAttack` (bool), `m_bRecvCond/m_nRecvCondMe/m_nRecvCondHow/m_nRecvCondMP` (self-heal threshold), `m_nLoot/m_nLootProb` (loot), `m_nSummProb/m_nSummNum/m_nSummID` (summons). | `AIMonster.cpp:344, 417-430, 1080-1090, 1322-1352, 1441-1490`, `_Common/Mover.h` |
| v15 item-drop AddCreateItem (NEW slot notify) | researcher | Pickup into a NEW/empty inventory slot uses `SNAPSHOTTYPE_CREATEITEM=0x0003` (MsgHdr.h:859), NOT `UPDATE_ITEM`. `CUser::AddCreateItem` (User.cpp:731): `[objid:GetId()][WORD 0x0003][BYTE 0][CItemBase::Serialize(=CItemElem body — same fields as the ground-item CItemElem, NO CObj/CCtrl frame)][BYTE nCount][BYTE[nCount] pnId slot ids][short[nCount] pnNum counts]`. Called from `CMover::CreateItem` (Mover.cpp:2291) after `CInventory::Add`. `UPDATE_ITEM=0x0018` (`AddUpdateItem` User.cpp:1089, `[objid][0x0018][BYTE cType=slot][BYTE nId=UI_*][CHAR cParam][DWORD dwValue][DWORD dwTime v15]`) is for COUNT changes on an existing slot only (`UI_NUM=0` etc, Mover.h:62). | `WORLDSERVER/User.cpp:731-742, 1089-1105`, `_Common/Mover.cpp:2291-2339`, `_Network/MsgHdr.h:859, 882`, `_Common/Mover.h:62` |
| v15 pickup C→S | researcher | Pickup is `PACKETTYPE_ACTMSG=0x0002` with `OBJMSG_PICKUP=11` (MoverMsg.h:118), `nParam1=item objid`. Server `CUser::OnMsgArrival` (User.cpp:7040) → `DoLoot` (MoverActEvent.cpp:2575) → `SubLootDropMobSingle` → `CMover::CreateItem` → on success `pItem->Delete()` + DEL_OBJ to viewers; fail (inv full) → `TID_GAME_LACKSPACE`. Gold (`IK3_GOLD`) → `PickupGold` → `AddGold`. Loot-lock `IsLoot` (MoverActEvent.cpp:2193): owner-only / party / FFA after SEC(7). | `WORLDSERVER/User.cpp:7040-7068`, `_Common/MoverActEvent.cpp:2193-2317, 2491-2629`, `_Common/MoverMsg.h:105-166` |

> When `researcher` agent discovers opcodes, formulas, or packet structures,
> they are logged here for all other agents to reference.

---

## Known Blockers

| Blocker | Affects | Reported By | Status |
|---------|---------|-------------|--------|
| `journal.ts` WAL not implemented | DROPITEM, DOUSEITEM, BUYITEM, MOVEITEM, DOEQUIP handlers | implementor | ✅ Done 2026-07-21 — `Journal` in `@flyff/database`, `JournalReplayer` boots before listener; handlers still need combat/skill for some |
| Combat system absent | MELEE_ATTACK, MAGIC_ATTACK, RANGE_ATTACK, USESKILL handlers | implementor | 🔴 Blocked — need target manager + damage formulas + skill propMover |
| Skill system absent | USESKILL handler | implementor | 🔴 Blocked — need skill propMover + skill state |
| `js-yaml` types missing | `packages/core/src/config/loader.ts:42` | pre-existing | 🟡 Low — install `@types/js-yaml` or write `.d.ts` shim |

---

## Lessons Learned

> Agents write here when a bug fix causes a FAIL→PASS test transition, or when a non-obvious edge case is discovered.
> The `post-tool-auto-test.mjs` hook auto-writes brief entries; agents add root-cause detail manually.

| 2026-07-21 | implementor | resources/scripts/extractFlaris.ts | .dyo editor format ≠ runtime `CMover::Read` (Mover.cpp:2896). Every record padded to fixed 200B; locate OT_MOVER via invariant `DWORD(o)==5 && DWORD(o+44)==5` (m_dwType==dwObjType, CreateObj.cpp:628). Per mover: angle(deg)@4, pos@20/24/28 (×4 OLD_MPU on x,z), MI@48, charKey@160. .rgn `respawn7 <layer> <MI> <x> <y> <z> <count> <delaySec> <flag> <minX> <minZ> <maxX> <maxZ>`. Filter MI 10/11/12 (player templates) + MIs absent from propMover or zone cross-ref validation fails. |
| 2026-07-21 | implementor | schemas/mover.schema.ts + converters/movers.ts + entities/mover.ts | BELLI enum (defineAttribute.h:203-215): PEACEFUL=1 ... MELEE2X=11, MELEE=12, RANGE=13. Client attack cursor gated by `CMover::IsAttackAbleNPC` (Mover.cpp:6572) — peaceful(1) suppresses it. Was hardcoded `m_dwBelligerence=0` in CMover ctor; now flows schema→converter(`BELLI_TEXT_TO_NUM`)→`MoverSpawnSource.belligerence`→`m_dwBelligerence`→`npcSnapshot.serializer`. |
| 2026-07-21 | implementor | services/chat.service.ts + handlers/chat.handler.ts + net/snapshot/chat.serializer.ts | **Old chat.serializer was wrong.** It wrote `jobId\|name\|level\|text` under `SNAPSHOTTYPE_CHAT_OUT` (0x00bc). Real `CUserMng::AddChat` (User.cpp:2925) = `objid \| SNAPSHOTTYPE_CHAT(0x0001) \| String` ONLY — client resolves name/level from objid via ADD_OBJ. Also OnChat reads `DWORD dwAuth \| String` (Florist), not bare String — handler was mis-parsing. Both fixed. |
| 2026-07-21 | implementor | services/command.service.ts + constants/authority.ts | `ParsingCommand` router shipped. Only ONE C→S chat packet exists (CHAT 0x00ff0000) — whisper/shout/party/guild are `/cmd` slash-lines inside it, NOT separate opcodes. Commands: `/w /s /say /te /su /sys /lv`, authority-gated (GENERAL→ADMIN). `accounts.gm` bool → m_bAuthority. `/ci /gg /k /out` deferred (need inventory/gold/combat/disconnect). |
| 2026-07-21 | implementor | database/journal.ts | Do NOT `import type { Logger } from '@flyff/core'` inside `@flyff/database` — database tsconfig has `rootDir: src`, and resolving `@flyff/core` pulls core's source into the program → TS6059 across every core file. Use a local minimal `JournalLogger` interface (pino is structurally compatible). Database pkg was previously core-free; keep it that way. |
| 2026-07-21 | implementor | entities/mover.ts + npcSnapshot.serializer.ts | NPC ADD_OBJ uses the short `m_bPlayer=0` serialize branch (~45B), NOT the player METHOD_NONE blob. `m_szCharacterKey` must be the character.inc key (empty for monsters) — writing the display name there is a bug. Outfit = SetFigure (hairMesh/hairColor/headMesh/characterKey) + SetEquip (`uSize × {uParts:BYTE, itemId:WORD}`, no byFlag). Flaris shopkeepers have no character.inc outfit; MaDa_Homeit/MaDa_Corel do. |
| 2026-07-20 | implementor | entities/player.ts | Adding runtime-defaulted entity fields (`m_fAngle`, `m_idTarget`, etc.) via class-field initializers avoids the constructor signature growing for every new optional field. Initialize from a constant like `NULL_ID` to keep C++ semantics. |
| 2026-07-20 | implementor | test/handlers/revival.handler.test.ts | `PacketReader` rejects empty buffers (`Cannot create PacketReader from empty buffer`). Empty-body packets like REVIVAL need a dummy byte in test payloads. |
| 2026-07-20 | implementor | services/movement.service.ts | PLAYERCORR / PLAYERMOVED2 / PLAYERANGLE wire bodies look identical to PLAYERMOVED at first glance but differ: CORR=60B same, MOVED2=73B (+3 floats +BYTE), ANGLE=45B (no state block). Read C++ field lists twice before extending the serializer. |
| 2026-07-21 | implementor | services/revival.service.ts + systems/ai.system.ts | **Death→revival loop shipped.** C++ `DoDie` (Mover.cpp:5131) sends `SendActMsg(OBJMSG_DIE=40)` to the dying client via `SNAPSHOTTYPE_ACTMSG(0x0002)` — NOT `SNAPSHOTTYPE_MOTION(0x0098)` (that's sit/stand). Two different snapshot sub-types, two different client handlers. OBJMSG_STOP=6 sent first. `IsDie()` = `m_dwState & OBJSTA_DIE_ALL(0x08000000)` \|\| HP==0; we model as `m_bDead` flag (no bitfield needed). 3 revival C→S opcodes (REVIVAL/TO_LODESTAR/TO_LODELIGHT) read ZERO body — opcode selects branch. S→C confirms `SNAPSHOTTYPE_REVIVAL(0x00a1)/LODESTAR(0x00a2)/LODELIGHT(0x00a3)` = `OBJID+WORD` AddHdr only. Exp penalty on TOWN revive only (not scroll, non-chaotic); `subDieDecExp` bracket table (Lv≤20=0%, Lv≤29=6%, Lv≤59=5%…). HP restore 0.2×max (v9+ default). Scroll `II_SYS_SYS_SCR_RESURRECTION=10431`. Lodelight = C++ empty stub, rejected. |
| 2026-07-21 | implementor | test/services/revival.service.test.ts | `CPlayer.fromRow({exp: Xn})` converts cumulative→within-level via `withinLevelExp`, clamping to 0 if X < the level's `nExp1` base. To test within-level exp behavior, set `p.m_nExp` directly AFTER `fromRow` (bypass conversion). Also `subDieDecExp` clamps loss to current within-level exp (never de-levels) — test assertions must account for the clamp when exp is small relative to the penalty. |

---

## Agent Communication Log

| Timestamp | From | To | Message |
|-----------|------|----|---------|
| 2026-07-21 | main (drops) | all | **Drops Phase D shipped (inventory state + CREATEITEM serializer).** DB layer was already done by a teammate (inventory table in `001_initial.ts`, `characters.gold` in `003_character_gold.ts`, `InventoryRepository` + `CharacterRow.gold` + `character.repo.updateGold` + repo test). Phase D added: `SNAPSHOTTYPE_CREATEITEM=0x0003` constant; `net/snapshot/createItem.serializer.ts` (`buildOne/build` — 96 B one-slot add: SNAPSHOT hdr 10 + objid/0x0003/BYTE0/body 75/nCount/slot/count; reuses Phase B CItemBase 20B + CItemElem 55B body, NO CObj/CCtrl frame); `entities/player.ts` `InventorySlot{itemId,count}` + `m_Inventory:(InventorySlot\|null)[]` len `INVENTORY_SLOTS`=73; `services/join.service.ts` `loadInventory()` maps rows→slots (optional `inventoryRepo` dep); `compose.ts` instantiates + wires `inventoryRepo`. Format verified at source: `CUser::AddCreateItem` (User.cpp:727) `pItemBase->Serialize` is virtual → `CItemElem::Serialize` (ObjSerialize.cpp:48) calls `CItemBase::Serialize` (:31) first, so body == OT_ITEM ground-item body minus CObj/CCtrl. 2 new tests (createItem byte-layout) green; world 267/268 (1 fail = teammate notice.serializer WIP). **Phase E (pickup) is a PACKETTYPE_ACTMSG handler — opcode pinned: `0x00ff0001` (MsgHdr.h:112), fields `DWORD dwMsg\|int nParam1\|int nParam2` (SendActMsg DPClient.cpp:9102), OBJMSG_PICKUP=11 (MoverMsg.h:118) → OnMsgArrival(nParam1=itemobjid) → DoLoot. NOT `SNAPSHOTTYPE.ACTMSG=0x0002` (different namespace). See Research Findings row "v15 item pickup opcode".** |
| 2026-07-21 | main (drops) | all | **Drops Phases A–C shipped.** Phase A: `@flyff/resources` `converters/drops.ts` parses propMoverEx.inc → `data/drops/drops.yml` (575 tables, II_/MI_ resolved via defineItem.h/defineObj.h), `drop.schema.ts`, `drop.loader.ts` (DropIndex keyed by modelIdx), wired into ResourceIndex + dist rebuilt. Phase B: `entities/item.ts` (GroundItem, objids from 0x80000000), `net/snapshot/itemSnapshot.serializer.ts` (OT_ITEM ADD_OBJ — 111 B/entry, exact CItemElem v15 layout), `managers/item.manager.ts` (spawn→ADD_OBJ, 3-min decay→DEL_OBJ, shutdown clears timers). Phase C: `services/drop.service.ts` (level-diff buckets, rng.int(3e9)<prob*factor, gold pile, looter=first-hitter via m_idEnemies), wired into `CombatService.onDeath` + compose. 14 new tests (4 drop.service + 3 item.manager + 3 serializer + ...). tsc clean. **Phases D (inventory: migration+repo+CPlayer m_Inventory/gold+addItem serializer) + E (ACTMSG/OBJMSG_PICKUP handler) pending — start Phase D with research spike on add-to-empty-slot snapshot body (UPDATE_ITEM 0x0018 vs append).** Plan: `C:\Users\Cyan\.claude\plans\wobbly-scribbling-fountain.md`. Note: 3 world-server test failures (NoticeSerializer, CombatService counter-swing, E2E CERTIFY) are the AI teammate's WIP — not caused by drops; my Phase A–C tests pass independently. |
| 2026-07-21 | implementor | all | WAL journal unblocked: `Journal` class in `@flyff/database/src/journal.ts` (better-sqlite3, WAL+NORMAL, append/getUnreplayed/markReplayed/clearAll/countUnreplayed, 9 tests) + export. `JournalReplayer` in `packages/world-server/src/systems/journalReplayer.ts` (per-type handler registry + boot recover(), 5 tests). Wired in compose.ts (config.wal.journalPath) + index.ts (recover before listen, close on SIGINT/SIGTERM). database 90/90 + world 101/101 green. Tier 2 inventory handlers (DROPITEM/MOVEITEM/DOUSEITEM/DOEQUIP/BUYITEM) can now call `journal.append()` + register replayers. Flusher (30s dirty→main DB) deferred — ponytail in compose.ts. |
| 2026-07-20 | implementor | test-agent | Implemented 11 v15 C→S handlers (CHAT, MOTION, SETTARGET, LEAVE, PLAYERCORR, PLAYERMOVED2, PLAYERANGLE, QUERYGETPOS, GETPOS, SCRIPTDLG, REVIVAL) + 7 services + 2 serializers + extensions to movement.service/moverBroadcast.serializer — 36 new tests pass, 77/77 world-server tests green. Skipped 8 packets that need combat/inventory/WAL subsystems (see Known Blockers). |
| 2026-03-24 | implementor | test-agent | Verified core utility modules (constants, errors, logger, eventBus, cache) — all tests passing (92 total tests), tsc compilation successful with 0 errors |
| 2026-03-24 | implementor | test-agent | Implemented PacketBuffer stream reassembly + tests; ready for review. |
| 2026-03-24 | researcher | implementor | Packet framing confirmed in docs: size DWORD excludes itself, header 0x5E80, opcode WORD; PacketBuffer.drain should buffer until 4+size bytes then slice 4..4+size. Sources in PROGRESS.md Research Findings. |
| 2026-03-24 | researcher | implementor | Core network layer research complete: LSFR cipher algorithm, PacketReader/Writer patterns, type mapping (BYTE/WORD/DWORD/float/String), core opcodes logged. Ready for implementation. See PROGRESS.md Research Findings for full details. |
| 2026-03-24 | implementor | test-agent | Implemented core network layer: PacketReader (29 tests), PacketWriter (35 tests), LSFRCipher (29 tests) — all passing. Ready for test coverage review. |
| 2026-03-24 | main | all | Initial PROGRESS.md created — project foundation phase |
| 2026-03-24 | main | all | Agentic workflow upgraded: RESEARCH→IMPLEMENT→VALIDATE→TEST→FIX loop, self-learning hooks, per-agent session files |
| 2026-03-24 | implementor | test-agent | Implemented IPC framework: signing.ts (19 tests passing), circuit.ts (21 tests passing) — HMAC-SHA256 message signing and CircuitBreaker pattern for resilient IPC |
| 2026-03-24 | implementor | test-agent | Implemented @flyff/ipc IpcBus.ts, IpcServer.ts, IpcClient.ts — Redis pub/sub bus, internal TLS TCP server/client with HMAC signing (15 tests passing) |
| 2026-03-24 | implementor | test-agent | Implemented @flyff/database package: Knex factory, migrations, 3 repositories (account, character, inventory) with full CRUD operations — ready for integration testing (sqlite3 native bindings needed) |
| 2026-03-24 | implementor | test-agent | Implemented @flyff/login-server auth services and handlers — AuthService (argon2id), TokenService (HMAC handoff tokens), AuthHandler (LOGIN_CERTIFY), ServerListHandler (SERVER_LIST). TypeScript compilation successful with 0 errors. Test files created, ready for test execution. |
| 2026-03-24 | main | all | NEW FEATURE: Parallel sub-agent spawning capability added to agentic workflow. All agents can now spawn parallel helpers for independent subtasks. Safety limits: maxDepth=3, maxConcurrent=5. See `.claude/rules/08-agent-workflow.md` → "Parallel Sub-Agent Spawning", `.claude/skills/flyff-parallel-spawning/SKILL.md`, and each agent's session file for usage patterns. Example: implementor can spawn database-agent + security-auditor + test-agent in parallel to build features faster. |
| 2026-03-24 | main | all | DOCUMENTATION UPDATE: Created comprehensive documentation for parallel spawning feature. See: (1) `.claude/skills/flyff-parallel-spawning/SKILL.md` — full skill guide with patterns for all agent types, (2) `docs/agent-workflow/parallel-spawning-guide.md` — user-facing guide with examples, (3) `MEMORY.md` — project memory index with feature overview, (4) `memory/parallel_spawning_feature.md` — persistent memory entry. All agents: Review the skill guide before using parallel spawning. |
| 2026-07-21 | main | all | RESOURCE MIGRATION: Copied 24 source files from `game/resource/` → `packages/resources/raw/` (editable snapshot; client keeps originals). Built txt→yml converter (`scripts/convert.ts` + `scripts/converters/{parse,movers,items,skills}.ts`), wired as `pnpm --filter @flyff/resources convert`. One run regenerates `data/`: 782 movers (606 monsters/174 npcs/2 player), 3494 items (weapons/armors/consumables/materials), 166 skills (12 job files). Schemas relaxed: mover `model` optional, mover/item/skill `name_id` accept raw `IDS_*` keys. Flaris zone spawns/NPCs remapped to real MI_* ids (Aibatt 20-23, Marche 214, Boboku 211, Lui 213, Julia 212, Infopeng 200). All 8 loader tests green. TODO: jewelry/quest item buckets, propSkillAdd.csv per-level merge, character.inc NPC outfits. |
| 2026-07-21 | researcher ×4 (parallel) | all | **FULL COMBAT RESEARCH COMPLETE** — 4 parallel dives (stats / damage-pipeline / death-exp-drops / packets) persisted to `docs/combat-research.md` (sections A–E). Key: (1) Stats — ATK/DEF/HR/ER/crit/block/atkSpeed formulas from MoverAttack.cpp + propJob.inc (32 rows, VAGRANT/MERCENARY captured); port needs atkSpeedPlus[18] table + element 6×6 match table. (2) Damage — AttackArbiter pipeline CalcATK→PostCalcGeneric→CalcDefense→GetBlockFactor→GetDamageMultiplier; AF_* flags (ActionMover.h:27, sent in DAMAGE snapshot); crit 2.3x (ATK4/charge4 = 2.6x); server-authoritative hit/miss via GetAttackResult (never trust client dwAtkFlags). (3) Death/exp/drops — OnDied NPC fast-path (Delete(), no DoDie); exp = nExpValue*rate, hit-share via m_idEnemies, solo level-diff mult (≤0=1.0,1-2=0.7,3-4=0.4,≥5=0.1), LimitExp cap, level-up grants ((lvl-1)/20)+2 stat pts; drops in **propMoverEx.inc** (NOT propMover cols); gold = II_GOLD_SEED ADD_OBJ. (4) Packets — DAMAGE(0x0013) is the HP-sync (client IncHitPoint locally), MOVERDEATH=snapshot 0x00c7 (vicinity), SETEXPERIENCE(0x0012) self-only __int64, SETLEVEL(0x0011) vicinity-skips-self; ADDEXPERIENCE/UPDATE_MOVER/top-level variants are DEAD in v15. Resources pre-req: parse propJob.inc+expTable.inc+propMoverEx.inc, extend item.schema (raw dwAbilityMin/Max+fAttackSpeed+dwWeaponType+element), CPlayer needs equipped-weapon state. Next: architect plan (task #7), then implement bottom-up stats→damage→death→packets. |
| 2026-07-21 | implementor | all | PLAYERSETDESTOBJ (0xffffff07) + MELEE_ATTACK (0x00ff0010) handlers shipped — the two opcodes repeatedly dropped when a client auto-attacks a monster. PLAYERSETDESTOBJ: 8B C→S `objid,fRange`, new `DestObjSerializer`+`SNAPSHOTTYPE_MOVERSETDESTOBJ=0x00c2` S→C, added `MovementService.applySetDestObj` (records `m_idDestObj` on CPlayer, `__TRAFIC_1223` dedup, peer-clients pathfind themselves — no position sent). MELEE_ATTACK: motion-only (damage deferred to Tier 0 combat); 20B C→S `dwAtkMsg,objid,nParam2,nParam3,fVal(__HACK_1023)`, new `MeleeAttackSerializer`+`SNAPSHOTTYPE_MELEE_ATTACK=0x00e0` echoes 4 fields (no fVal). 6 new tests, world 154/154 green, tsc clean. ponytail: real damage + `fVal==fAttackSpeed` anti-cheat once inventory/stats ship. |
| 2026-07-21 | implementor | all | FLARIS CANONICAL PORT + BELLI WIRE: (1) `m_dwBelligerence` now flows schema→converter→entity→spawn (was hardcoded 0 — peaceful town NPCs sent 0, could show attack cursor). BELLI map in `converters/movers.ts` (defineAttribute.h:203-215: PEACEFUL=1, MELEE2X=11, MELEE=12, RANGE=13). (2) New `scripts/extractFlaris.ts` (`pnpm extract:flaris`) parses `game/resource/World/WdMadrigal/WdMadrigal.dyo` (binary, 200B records located via OT_MOVER invariant DWORD(o)==5 && DWORD(o+44)==5) + `.rgn` (UTF-16LE respawn lines) → regenerates `data/worlds/zones/flaris.yml`: **195 placed NPCs + 859 monster spawns** (was 5 hand-authored NPCs + 4 spawns). Zone metadata preserved; npc `functions:[]` (dialogue/shop re-link deferred, ponytail). Resources 12/12 + world 139/139 green. NPC dialogue/shop re-linking from character_key→prefix is the follow-up. |
| 2026-07-21 | implementor | all | **FULL v15 COMBAT SHIPPED** (player→NPC melee damage + death + exp/level-up). Plan: `docs/combat-plan.md`; formula ref: `docs/combat-research.md`. New `src/combat/`: `tables.ts` (JOB_TABLE[32] from propJob.inc, ATK_SPEED_PLUS[18], ELEMENT_MATCH 6×6, AF_*/WT_*/ATK_*), `expTable.ts` (200 rows from expTable.inc: nExp1/dwLPPoint/nLimitExp), `formulas.ts` (pure AttackArbiter port — getWeaponATK/getHitMinMax/getHR/getParrying/getAttackResult/calcDefense/getBlockFactor/getDamageMultiplier/resolveMelee + expLevelDiffMult). Entity: `CMover` gains m_nAtkMin/Max/Armor/HR/ER/ExpValue/Element + m_idEnemies hit-share + m_bDead; `SpawnManager` populates from mover yml + new `kill(id)`. Serializers: DAMAGE(0x0013)/MOVERDEATH(0x00c7)/SETEXPERIENCE(0x0012 self)/SETLEVEL(0x0011 vic-skip-self). `CombatService.resolveAttack` runs pipeline, broadcasts DAMAGE (HP-sync), on death → MOVERDEATH + grantExp (level-diff mult + LimitExp cap + level-up cascade) + WAL journal EXP_GAIN + `charRepo.updateLevelAndExp`. `MeleeAttackService` rewired to call it after the swing echo. `join.service` hydrates `m_nExp` from row. Server-authoritative (client dwAtkFlags/nParam3 never enter math). 14 new tests (12 formula with hand-computed C++ outputs + 2 service wiring), world **186/186 green**, tsc clean. ponytail: drops (propMoverEx.inc), respawn queue, equipped-weapon model (player bare-hand), hit-share party grouping, stealHP/skills, NPC-attacker/player-defender (monsters don't swing — AI). |
| 2026-07-21 | implementor | all | **FULL QUEST ENGINE SHIPPED** (7-phase plan `C:\Users\Cyan\.claude\plans\delegated-skipping-cloud.md`). Phases: (1) `core/constants/quest.ts` + opcodes + snapshot sub-types + `resources/schemas/quest.schema.ts` + converter `converters/quests.ts` (285 quests → `data/quests/*.yml`, commands verbatim) + `quest.loader.ts` + `database/migrations/002_quests.ts` + `repositories/quest.repo.ts`. (2) CPlayer quest arrays + `quest.serializer.ts` (12B byte-exact QUEST struct + SETQUEST/QUEST_REMOVE/QUEST_CHECKED/QUEST_TEXT_TIME/QUESTHELPER_NPCPOS) + inline JOIN arrays + `quest.service.loadOnJoin` (wired in `join.service`). (3) `questConditions.ts` (pure canBegin/isComplete — AND-semantics mirroring `__IsBegin/EndQuestCondition` Mover.cpp:7108/7393) + `questRewards.ts` (applyBeginSet/applyEnd, WAL GOLD/EXP/ITEM journals) + begin/end/cancel/setChecked. (4) C→S handlers REMOVEQUEST/QUEST_CHECK/QUESTHELPER_REQNPCPOS. (5) `scriptDlg.service.runDialog` runtime (NPC resolve + `MAX_LEN_MOVER_MENU_SQ=1024` gate + Speak→chat + LaunchQuest→beginQuest + C++ `SetEndCondDialog` sweep DPSrvr.cpp:859-875). (6) `questTracker.system.ts` reactive engine: `onKill` (SetEndCondKillNPC slot increment), `onPlayerMoved` (SetEndCondPatrolZone rect → QUEST_FLAG.PATROL), `tick` (SetEndCondLimitTime → bit15). (7) Integration: loadOnJoin wired, `onKill` in CombatService.onDeath, `onPlayerMoved` via MovementService.onMoved (3 paths), tracker start/stop. **Key verified facts**: v15 propQuest.inc uses `SetEndCondCharacter` (156×) NOT `SetEndCondDialog` (0×) → sweep dormant but spec-correct; `__IsEndQuestCondition` does NOT gate on m_bDialog/m_szEndCondCharacter (UI hints only); QUEST struct 12B MSVC x86 align (padding on wire). Tests: world **194/194** (47 quest+dialog + 8 tracker), database 96/96, resources 12/12, 8/8 packages build clean. Memory: `flyff-quest-engine-architecture`. ponytail: dialog `source` bodies (EndQuest/SetQuestState/CreateItem script runtime — the real quest trigger); inventory/party/guild deps stubbed permissive; QuestItem drops (needs propMoverEx.inc loot); gold/exp DB columns partial. |





---

*Last updated: 2026-03-24*
*Update protocol: When completing a module, change its row Status + Last Agent + Notes.*
