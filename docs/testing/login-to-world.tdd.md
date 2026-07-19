# Login → Char → World — TDD Evidence Report

**Plan:** `docs/plans/cpp-to-nodejs-port.plan.md` (Milestone 1, Phases 1.A–1.F)
**Runner:** `tsx --test` (Node native) · **PM:** pnpm · **Style:** RED → GREEN → refactor
**Date:** 2026-07-19

---

## Source plan

`docs/plans/cpp-to-nodejs-port.plan.md`. Milestone 1 vertical slice: **Login → Char select/create → Enter world**, connectable + tested end-to-end. C++ source of truth: `game/source/` (`__VER 15`).

## User journeys

1. **Authenticate** — client CERTIFY → login validates credentials, issues a login handoff token, replies SRVR_LIST.
2. **Pick a character** — client GETPLAYERLIST → cluster returns PLAYER_LIST; CREATE_PLAYER / DELETE_PLAYER mutate the roster.
3. **Enter the world** — client PRE_JOIN → cluster issues a world handoff token + publishes `player:handoff` over signed IPC; client JOINs the world → world validates the handoff, loads the char, writes the JOIN/ADD_OBJ self-spawn snapshot.

---

## Final suite (all green)

| Package | Tests | Fail |
| --- | --- | --- |
| @flyff/core | 298 | 0 |
| @flyff/ipc | 50 | 0 |
| @flyff/database | 81 | 0 |
| @flyff/login-server | 65 | 0 |
| @flyff/cluster-server | 33 | 0 |
| @flyff/world-server | 43 | 0 |
| @flyff/resources | 8 | 0 |
| **Total** | **578** | **0** |

Validation command (per package): `pnpm --filter @flyff/<pkg> test`.

---

## Task report (per phase)

### Phase 1.A — Protocol hardening (`@flyff/core`)
- Frame `[0x5E marker][DWORD size LE][payload]`; payload leads with DWORD opcode. `PacketBuffer.drain()` reassembles; `<4`-byte guard. CRC integrity (not LSFR).
- Opcode audit vs `_Network/MsgHdr.h` `PACKETTYPE_*`; added `Validate.*` (name/slot/dword/pos).
- **Evidence:** `packages/core/test/...` — 297/0.

### Phase 1.B — Database (`@flyff/database`)
- Migration `001_initial` (`accounts`, `characters`, `character_items`); `account.repo`, `character.repo`. Argon2id hashing.
- **Debt cleared this milestone:** `migrate.test` 4 failures — (1) Knex 3.x `currentVersion()` returns a string (destructure yielded `'n'`); (2) migrations dir resolved absolutely via `import.meta.url`; (3) `loadExtensions: ['.js','.ts']`. `packages/database/src/migrate.ts`, `packages/database/test/migrate.test.ts`. 81/0.

### Phase 1.C — Login (`@flyff/login-server`)
- `auth.service`/`auth.handler` (CERTIFY), `serverList.service`/`.handler` (SRVR_LIST). Token cached TTL 30s.
- **Debt cleared:** `serverList.handler` referenced non-existent `SNSP`; switched to `PACKETTYPE`. 64/0.

### Phase 1.D — Cluster (`@flyff/cluster-server`)
- `charList`, `charCreate`, `charSelect` services + `char.handler` (GETPLAYERLIST / CREATE_PLAYER / DELETE_PLAYER / PRE_JOIN). `playerList.serializer` (26-field per-char layout). PRE_JOIN issues a single-use world handoff token (HMAC) + publishes `player:handoff`. 32/0.

### Phase 1.E — World enter-world (`@flyff/world-server`)
New modules (all RED → GREEN):
- `entities/player.ts` — `CPlayer` (C++ `m_` field mirror).
- `managers/player.manager.ts` — O(1) `Map<charId,CPlayer>`, explicit remove.
- `managers/zone.manager.ts` — zone-bucket broadcast, ground-plane radius.
- `ipc/clusterListener.ts` — `player:handoff` consumer, **charId-keyed single-use**; HMAC + 30 s freshness verified through the **real `IpcBus`** (tamper/stale genuinely rejected).
- `services/join.service.ts` — handoff consume → DB load → spawn.
- `net/snapshot/` — byte-exact fresh-spawn blob: full `CMover::Serialize` (METHOD_NONE, `__VER 15`) + empty inventory/3 banks/pocket/buffs framing.
- `handlers/join.handler.ts` — JOIN parse, nSlot≥3 reject, snapshot write.
- `compose.ts` — wires all of the above.
- **Evidence:** 36/0 unit + 2/0 E2E.

### Phase 1.F — End-to-end verification
- **E2E integration test** (`packages/world-server/test/e2e/join.e2e.test.ts`): signed IPC publish → real `IpcBus` HMAC verify → `ClusterListener` → `JoinService` → `JoinHandler` → `PlayerSnapshotSerializer` → mock socket receives the 3090-byte JOIN/ADD_OBJ snapshot. No layer mocked between publish and socket write except the DB. 2/0.
- **3-server byte chain** (`packages/world-server/test/e2e/bytechain.e2e.test.ts`): real `AuthHandler`(CERTIFY) → real `CharHandler`(PRE_JOIN) → real `ClusterHandoffPublisher` → real `IpcBus` → real `ClusterListener`+`JoinHandler` → snapshot, over shared in-memory SQLite + FakeRedis. 4/0.
- **Client-facing TCP layer** (`@flyff/core` `PacketDispatcher` + `createClientServer`): reassembles the v19 `[0x5E][DWORD size LE][payload]` frame, routes by leading DWORD opcode, attaches a `CONNECTED` session per socket, contains handler throws + socket errors per-connection (rule 03). Each server's `clientServer.ts` binds its opcodes (`CERTIFY` / the 4 char packets / `JOIN`) and `index.ts` calls `.listen(config.server.port)` — servers now actually accept real client TCP. Real-loopback dispatcher test (6/0) covers split/multi-frame reassembly, unknown-opcode drop, throw containment, session attach, framed replies; one registration test per server (3/0).
- **Coverage:** `tsx --test --experimental-test-coverage` → **84.03 % lines / 89.31 % branches**.

---

## Test specification (Phase 1.E guarantees)

| # | Guarantee | Test | Result |
| --- | --- | --- | --- |
| 1 | `CPlayer.fromRow` maps every tracked CharacterRow field | `test/entities/player.test.ts` | PASS |
| 2 | `PlayerManager` add/get/remove is O(1) + size tracks | `test/managers/player.manager.test.ts` | PASS |
| 3 | `ZoneManager` broadcasts only to in-zone, in-radius players | `test/managers/zone.manager.test.ts` | PASS |
| 4 | Validly-signed `player:handoff` is stored + single-use | `test/ipc/clusterListener.test.ts` | PASS |
| 5 | Tampered-signature / stale (>30 s) / malformed handoffs rejected | `test/ipc/clusterListener.test.ts` | PASS |
| 6 | `JoinService` spawns on valid handoff; rejects bad token / missing char / world mismatch | `test/services/join.service.test.ts` | PASS |
| 7 | Snapshot frame = `[JOIN][objidPlayer][cb=1][ADD_OBJ entry]`, OT_MOVER + model index | `test/net/snapshot/playerSnapshot.serializer.test.ts` | PASS |
| 8 | CMover prefix fields (name, sex, skin, hair, hp, level…) at byte-exact offsets | `test/net/snapshot/playerSnapshot.serializer.test.ts` | PASS |
| 9 | Fresh-spawn total length = `3086 + nameLen` (3090 for "Hero") | `test/net/snapshot/playerSnapshot.serializer.test.ts` | PASS |
| 10 | `JoinHandler` writes the snapshot on success; destroys on reject / nSlot≥3 | `test/handlers/join.handler.test.ts` | PASS |
| 11 | **End-to-end:** cluster signed publish → world writes 3090-byte snapshot | `test/e2e/join.e2e.test.ts` | PASS |

---

## C++ source citations (Phase 1.E blob)

- `WORLDSERVER/DPSrvr.cpp:612` — `CDPSrvr::OnAddUser` (JOIN handler); `:616-626` field order; `:628` nSlot≥3 reject.
- `WORLDSERVER/User.cpp:305-355` — `CUser::Open` (SetSnapshot JOIN + AddAddObj self); `:657-672` AddAddObj entry.
- `WORLDSERVER/Snapshot.cpp:20-26` — frame layout (dwHdr + objid + cb).
- `_Common/ObjSerializeOpt.cpp:18-60` — `CObj::Serialize`; `:97-277` `CMover::Serialize` (METHOD_NONE).
- `_Common/ObjSerialize.cpp:15-27` — `CCtrl::Serialize`.
- `_Common/Item.h:892-945` — `CItemContainer::Serialize` (empty framing: index table + chSize + objIndex table).
- `_Common/ObjSerialize.cpp:31-138` — `CItemBase`/`CItemElem::Serialize`.
- `_Common/buff.cpp:901-933` — `CBuffMgr::Serialize` (size_t count + 12 B/buff).
- Constants: `resource/defineNeuz.h:62` (MAX_HUMAN_PARTS=31), `resource/defineJob.h:91` (MAX_JOB=32) / `:12-17` (MAX_SKILL_JOB=45), `_Network/CmnHdr.h:504` (SM_MAX=26), `_Common/ProjectCmn.h` (MAX_INVENTORY=42, MAX_BANK=42, MAX_HONOR_TITLE=150), `_Common/Item.h:308` (sizeof SKILL=8), `_Common/Mover.h:260` (sizeof QUEST=12).

---

## Flagged uncertainties (honesty — not fabricated)

All three previously-inferred bytes are now **LOCKED vs C++ source** (researcher pass, citations below). One real bug was found and fixed in the process (`OT_MOVER` was 4, should be 5).

1. **`OT_MOVER`** = **5** (was inferred 4 — WRONG). The `OT_` enum is sequential from 0: `OT_OBJ=0, OT_ANI=1, OT_CTRL=2, OT_SFX=3, OT_ITEM=4, OT_MOVER=5, OT_REGION=6, OT_SHIP=7`. Proven by the filter array indexed by `dwType` in `_Common/World3D.cpp:23` + `m_apObject[nType]` indexing in `_Common/lod.cpp:1544-1547`. Written at `WORLDSERVER/User.cpp:669`. Fixed in `constants.ts`; `packages/core/src/constants/objectTypes.ts` was also corrected (it was entirely fabricated — `MOVER:0, ITEM:1, …`) to the real enum.
2. **`dwObjIndex`** = `MI_MALE=11` / `MI_FEMALE=12` — **confirmed**. `resource/defineObj.h:962-963`; world-side load at `WORLDSERVER/DPDatabaseClient.cpp:721`; set at char-create in `_Database/DbManager.cpp:187`.
3. **`m_dwMute`** = `0`, **written** — `__JEFF_9_20` IS defined (`WORLDSERVER/VersionCommon.h:112`); write site `_Common/ObjSerializeOpt.cpp:263-265`; init 0 at `_Common/Mover.cpp:530`.

Bonus corrections from the same pass: `m_idGuildCloak` init is `0` not `NULL_ID` (`Mover.cpp:381`) — fixed in `mover.serializer.ts`. `m_idMurderer` confirmed `NULL_ID` (`Mover.cpp:342`). `m_idMarkingWorld` is the one remaining gap: C++ overwrites it with the numeric world ID on entry (`Mover.cpp:969`); this slice has no numeric world IDs yet, so it stays `NULL_ID` (flagged in-code) until world-id mapping lands.

The rest of the ~3 KB fresh-spawn blob is byte-exact vs `ObjSerializeOpt.cpp`.

---

## Doc debt

- **`CLAUDE.md` "Packet Protocol"** — **fixed.** It previously documented `[4 B size][2 B 0x5E80 header][2 B opcode]` + LSFR cipher; corrected to the implemented `[0x5E marker][4 B size LE][payload-leading-with-DWORD-opcode]` + CRC integrity (v19-style), with a note on the prior discrepancy.

---

## Remaining 1.F work

1. **Real `IpcBus` wiring in `world-server/src/index.ts`** — **done.**
2. **Cluster→world handoff actually published** — **done.** `ClusterHandoffPublisher` was a log-only stub; now takes an injectable bus and publishes `player:handoff` for real. `cluster-server/src/index.ts` wires a real `IpcBus` (guarded dynamic `ioredis`, mirror of the world side). Also fixed a pre-existing typo in cluster `index.ts` (`clusterRegistry` → `worldRegistry` + `loginRegistrar`).
3. **Full 3-server byte-chain integration test** — **done.** `packages/world-server/test/e2e/bytechain.e2e.test.ts` drives real `AuthHandler` (CERTIFY) → real `CharHandler` (PRE_JOIN) → real `ClusterHandoffPublisher` → real `IpcBus` (HMAC) → real `ClusterListener` + `JoinHandler` → 3090-byte snapshot, over a shared in-memory SQLite + shared FakeRedis bus. 4 tests, green. Cross-package test deps (`@flyff/login-server`, `@flyff/cluster-server`, `argon2`) added to world-server `devDependencies`; `@flyff/database` `exports` gained `./migrations/*` so the test can run `up(db)`.
4. **Coverage ≥80 %** — **done.** `tsx --test --experimental-test-coverage`: **84.03 % lines / 89.31 % branches** across world-server + its dep tree. Every Phase 1.E source file is at 100 %.
5. **Lock the 3 flagged snapshot bytes** — **done.** See "Flagged uncertainties" above. All three locked vs C++ source; `OT_MOVER` corrected 4 → 5; `m_idGuildCloak` corrected NULL_ID → 0; core `objectTypes.ts` corrected to the real `OT_*` enum.
6. **Manual smoke runbook** — **not done (runtime task).** Boot login/cluster/world with Redis + SQLite, run a scripted TCP client (or a real v15 client) through the slice. Steps:
   - `pnpm install`; create `.env` (`DB_CLIENT=better-sqlite3`, `DB_FILENAME=./dev.sqlite3`, `IPC_SECRET=…`, `CACHE_ADAPTER=redis`, `CACHE_REDIS_URL=redis://localhost:6379`, per-server ports/hosts).
   - `pnpm --filter @flyff/database migrate` to create the schema.
   - Start Redis. Boot `@flyff/login-server`, `@flyff/cluster-server`, `@flyff/world-server` (separate terminals).
   - Connect a TCP client to `:23000`, send CERTIFY, follow the SRVR_LIST → cluster(:38100) → world(:38180) handoff.

---

## Merge evidence

No squash performed. Per-phase commits land separately. RED evidence = tests written before impl (import-failure RED) for each module; GREEN evidence = the 570/0 suite above. The two E2E tests in `test/e2e/join.e2e.test.ts` are the cross-layer proof for the new 1.E work.
