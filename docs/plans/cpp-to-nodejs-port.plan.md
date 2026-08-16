# C++ Flyff Server → Node.js Port — TDD Plan

**Created:** 2026-07-19
**Runner:** `tsx --test` (Node native test runner) · **PM:** pnpm · **Style:** TDD (RED → GREEN → refactor)

---

## Decisions (locked)

| Question | Answer |
| --- | --- |
| Topology | **TCP 3-server split** — login(23000) / cluster(38100) / world(38180), raw TCP + LSFR cipher. Authentic real-client protocol. `gateway`/`client` (WebSocket) deprecated, not extended. |
| Source of truth | **`game/source/`** — the real C++ server (525 `.cpp`, 708 `.h`): `LOGINSERVER`, `CERTIFIER`, `CACHESERVER`, `WORLDSERVER`, `_Common`, `_Network`, `_AIInterface`. Plus `game/resource/` (`define*.h`, `prop*.txt`, `World/`, `.lua`). |
| First milestone | **Login → Char select/create → Enter world** vertical slice, connectable + tested end-to-end. |

### C++ → TS server mapping

| C++ dir | Role | TS package |
| --- | --- | --- |
| `CERTIFIER` / `LOGINSERVER` | account auth, server list | `@flyff/login-server` |
| `CACHESERVER` | character list/select/create (per-account) | `@flyff/cluster-server` |
| `WORLDSERVER` | gameplay, zones, AI, combat | `@flyff/world-server` |
| `_Common`, `_Network` | packet protocol, DPSrvr dispatch, shared types | `@flyff/core` + `@flyff/ipc` |

**Porting note:** C++ dispatch is `ON_MSG(PACKETTYPE_X, &CDPSrvr::OnHandler)` tables in each `DPSrvr.cpp`. Port each `ON_MSG` row → one `*.handler.ts` under the matching server, wired in `compose.ts`. This is data, not a line-by-line transliteration — reproduce **observable behavior + wire format**, verified against C++.

---

## Milestone 0 — Unblock the build (BLOCKER, do first)

All 3 `compose.test.ts` fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Nothing else can be TDD'd until green.

**Root cause:** `packages/core/package.json` `exports` map is wrong for how handlers import:
- Handlers import subpaths: `@flyff/core/net/PacketReader.js`, `@flyff/core/errors.js`, `@flyff/core/constants/opcodes.js`.
- Map only exposes `./net` barrel; `./errors` → `dist/errors/index.js` (real file is `src/errors.ts`, single file); every target points at `dist/` with **no build present** and no dev condition for `src`.

### Tasks (TDD)
1. **RED** — `pnpm test:login` → observe `ERR_PACKAGE_PATH_NOT_EXPORTED` (already reproduced). This is the failing gate.
2. **GREEN** — fix `@flyff/core` `exports`:
   - Add subpath patterns handlers actually use: `./net/*`, `./errors`, `./constants/*` already partial — align target files (`errors` is a single file, not `errors/index`).
   - Add a **`development` / `import` condition pointing at `./src/*.ts`** (tsx resolves TS) OR standardize all handler imports to existing barrels (`@flyff/core` root + `@flyff/core/net`). Prefer **barrel imports** — smallest diff, no dist dependency in dev.
   - Decide once: dev runs off `src` via tsx; `dist` only for `pnpm build`. Wire `exports` with `"development"` condition → `src`, default → `dist`.
3. **GREEN** — fix broken `test:coverage` script: `node_modulestsx` → `node_modules/.bin/tsx` (or use `tsx --test --experimental-test-coverage`).
4. Re-run all `test:*` — establish the current green baseline. Record pass/fail counts.
5. Prune stale `.d.ts`/`.js`/`.d.ts.map` committed under `src/` (e.g. `packages/core/src/net/*.js`) — source dirs must hold `.ts` only (rule 06). Confirm `.gitignore` covers build output.

**Gate:** `pnpm test` runs with 0 unexpected failures; import resolution works under tsx.
**Checkpoint commit:** `fix: repair @flyff/core exports map and test scripts`

---

## Milestone 1 — Vertical slice: Login → Char → World

Each feature = one RED→GREEN→refactor cycle. Layer order per feature: **repo → service → handler → compose wiring**, tests first at each layer. Every packet layout verified against the cited C++ file before coding.

### Phase 1.A — Protocol hardening (`@flyff/core`)
Foundation exists (`PacketReader/Writer/Buffer`, `LSFRCipher`, opcodes). Verify + close gaps against C++.

- [ ] **Verify LSFR cipher** matches C++ (`_Network` / `_Common` encode path). RED: known-vector test (plaintext↔ciphertext pair captured from C++ logic) → GREEN.
- [ ] **Verify frame format**: `[DWORD size][WORD 0x5E80 header][WORD opcode][payload]`, DWORD-length-prefixed strings, LE ints. Test `PacketBuffer.drain()` partial-frame reassembly + `<4` byte guard (known past bug, see MEMORY lessons).
- [ ] **Opcode audit**: current file has 74. Cross-check names/values against `define*.h` `PACKETTYPE_*`. Add any needed for the slice (CERTIFY, SRVR_LIST, GETPLAYERLIST, CREATE_PLAYER, SEL_PLAYER, PRE_JOIN, JOIN, ADDOBJ).
- [ ] Add `Validate.*` helpers (name 3–16 alnum, slot bounds, dword range, pos finite) — rule 03. Full unit coverage of boundaries.

### Phase 1.B — Database layer (`@flyff/database`)
Repos exist (account, character, inventory). Verify schema vs C++ DB (`_Database`, `CACHESERVER/Player.cpp`, `databaseserver`).

- [ ] Migration `001_initial`: `accounts`, `characters`, `character_items`. Fields mirror C++ (`m_szName`, `m_nLevel`, job, stats, position, gold). Test: migrate up on `:memory:` sqlite, assert columns.
- [ ] `account.repo` — `findByUsername`, `create`. Test CRUD + not-found on in-memory sqlite.
- [ ] `character.repo` — `listByAccount`, `create`, `findById`, `delete`. Test list-by-account isolation.
- [ ] Argon2id password hashing (rule 03; store argon2(md5) for v19 clients). Test hash/verify round-trip.

### Phase 1.C — Login server (from `CERTIFIER`/`LOGINSERVER`)
Port `ON_MSG(PACKETTYPE_CERTIFY,...)` and server-list flow.

- [ ] `auth.service` — validate credentials, issue handoff token (32-char), cache `token:{token}` TTL 30s. Test: happy path, bad password → `AuthError`, unknown user.
- [ ] `auth.handler` — parse CERTIFY (key:DWORD, user:String, pw:String, version:DWORD — **verify field order in `DPCertifier.cpp`**), call service, emit `login:success`, write result packet. Test: valid→SRVR_LIST, invalid→ERROR opcode, malformed→`PacketError`, rate-limit.
- [ ] `serverList.service`/`.handler` — return world list (from cluster registry via IPC). Test: formats SRVR_LIST payload correctly.
- [ ] Wire in `compose.ts`. Test: compose returns wired deps (fix the failing test meaningfully, not just `typeof === function`).

### Phase 1.D — Cluster server (from `CACHESERVER`)
Char select/create. Port `GETPLAYERLIST`, `CREATE_PLAYER`, `DELETE_PLAYER`, `SEL_PLAYER`.

- [ ] `charList.service` — list chars for account (validate handoff token from login via IPC/cache). Test: token valid→list, expired→reject.
- [ ] `charList.handler` — GETPLAYERLIST → PLAYER_LIST packet. Verify layout in `CACHESERVER/DPClient.cpp`. Test.
- [ ] `charCreate.service`/`.handler` — CREATE_PLAYER: validate name (`InvalidName*.inc`), job, starting stats/pos from `define*.h`. **WAL journal before response** (rule 04). Test: valid create, dup name, invalid name, bad job.
- [ ] `charSelect.handler` — SEL_PLAYER: issue world handoff token, IPC `player:handoff` → world. Test.

### Phase 1.E — World server (from `WORLDSERVER`)
Enter-world only for this milestone. Port `ON_MSG(PACKETTYPE_JOIN, &CDPSrvr::OnAddUser)` (`DPSrvr.cpp:122`) + `PRE_JOIN`.

- [ ] `player.manager` (in-memory `Map<charId, CPlayer>`) — add/get/remove. Test O(1) ops + cleanup on remove.
- [ ] `zone.manager` — spatial bucket, `broadcastAround(pos, radius, packet)` (rule 05, zone-scoped). Test: only in-radius players receive.
- [ ] `join.service` — verify world handoff token (IPC from cluster), load character from DB, place in start zone. Test: valid handoff→player spawned, bad token→reject.
- [ ] `join.handler` — PRE_JOIN/JOIN: build player, send SNAPSHOT/ADDOBJ self (`WORLDSERVER/Snapshot.cpp`, `User.cpp:308`). Test: player sees self spawn packet.
- [ ] IPC `clusterListener` — consume `player:handoff`. Test: HMAC-verified envelope accepted, tampered rejected, `ts` >30s rejected (rule 07).

### Phase 1.F — End-to-end verification
- [ ] Integration test: mock socket drives CERTIFY → SRVR_LIST → (cluster) GETPLAYERLIST → SEL_PLAYER → (world) JOIN → self-ADDOBJ. Assert byte-level packets at each hop.
- [ ] Manual smoke: three servers boot, IPC connects, a scripted TCP client (or real Flyff v19 client if available) completes login→world. Use `/verify` skill.
- [ ] Coverage ≥80% across touched packages (`pnpm test:coverage`).
- [ ] Write TDD evidence report → `docs/testing/login-to-world.tdd.md` (journeys, RED/GREEN per feature, coverage, C++ source citations).

**Checkpoint commits:** one per phase (`feat: login CERTIFY handler`, `feat: char select/create`, `feat: world join`, …), each noting RED/GREEN evidence.

---

## Guardrails (every feature)
- No phase skipped: RED (compiled + executed + fails for the intended reason) before any production edit.
- Layer law (rule 02): Handler parses+validates+one service call; Service = logic+repos+WAL; Repo = Knex only.
- Security checklist (rule 03) on every new handler: bounds-check all fields, session-state guard, WAL-before-ack for mutations, rate limit, server-side compute.
- Strict TS, ESM, no `any`, files <300 lines, fns <50 lines.
- Verify packet layout against the cited C++ file — **never fabricate a wire format**; if unclear, grep `game/source` or ask.

---

## Out of scope (later milestones)
Movement/combat/AI systems, skills, drops/spawns, quests, trade, guilds, mini-games, party/dungeon, full crash-recovery replay, PG/MySQL prod adapters. Milestone 1 stops at "spawned in world, see self."
