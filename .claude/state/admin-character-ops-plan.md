# Admin character ops: presence / kick / teleport / mail

Branch: `master` (working in place, no worktree)
Status: **in_progress — code complete, awaiting user test.** All 7 sections built.

## Verification observed (2026-07-29)

- `pnpm -r build` → exit 0, 17/17 packages `Build success`.
- `@flyff/mail` → tests 25, pass 25, fail 0.
- `@flyff/world-server` → tests 243, pass 241, fail 2. Both failures are the
  pre-existing `/ci` `CommandService` tests — they fail identically with every
  world-server edit from this task stashed, so they are not caused by it.
- `@flyff/database` → tests 134, pass 133, fail 1. `migrate.test.ts` chokes on
  `015_normalize_buffs.ts` (`Refusing to create transaction: unable to change
  foreign_keys pragma inside a nested transaction`). Pre-existing: removing
  migration 017 makes it worse (3 failures), not better. The dev DB uses
  `seed.ts`, not knex migrate, so this path is untested by design.
- `@flyff/admin` → `✓ Compiled successfully`, tests 47, pass 47, fail 0.

**Untested by anyone:** real IPC delivery to a live world process, and the game
client's handling of an actual mail row. No world server was running.


## Decisions (user-approved)

- **Transport**: IPC bus (`@flyff/ipc`). Admin publishes signed `admin:command`; world subscribes.
  Rejected DB-queue alternative. Admin needs `@flyff/ipc` dep + `IPC_SECRET` + node runtime route.
- **Presence**: `online_players` table. World upserts on JOIN, deletes on disconnect, bumps
  `last_seen_ms` from the 30 s checkpoint. Admin: online iff `last_seen_ms > now - 60s`.
- **Mail scope**: admin→player only. Port list/read/take-item/take-gold/delete. NO player→player
  `QUERYPOSTMAIL` send, no postage fee, no stamp rules.

## Done

- `packages/database/src/migrations/017_presence_and_mail.ts` — `online_players` + `mail` tables.

## Remaining work

### 1. DB layer
- Register 017 in `packages/login-server/src/seed.ts` `MIGRATIONS` (marker `'mail'`) — dev DB uses
  seed.ts, NOT knex migrate (memory `dev-db-seed-not-migrate`).
- `packages/database/src/repositories/presence.repo.ts` — `upsert`, `remove`, `touch`, `listOnline`.
- `packages/database/src/repositories/mail.repo.ts` — `create`, `listByReceiver`, `findById`,
  `markRead`, `markTakenItem`, `markTakenGold`, `remove`, `countUnread`.
- Export both from `packages/database/src/index.ts`.
- Mirror both tables in `packages/admin/drizzle/schema.ts`.

### 2. Opcodes (`packages/core/src/constants/opcodes.ts`)
C→S (all `[nMail:DWORD]` except QUERYMAILBOX which is empty):
```
QUERYMAILBOX      0x0000001d   (no payload)
QUERYREMOVEMAIL   0x0000001b
QUERYGETMAILITEM  0x0000001c
QUERYGETMAILGOLD  0x0000001f
READMAIL          0x00000024
```
S→C snapshot types (`packages/world-core/src/snapshot-constants.ts`):
```
SNAPSHOTTYPE_QUERYMAILBOX 0x00e9
SNAPSHOTTYPE_REMOVEMAIL   0x00e7
(SNAPSHOTTYPE_MODIFYMODE 0x00d3 already exists)
```
Do NOT add/emit `SNAPSHOTTYPE_POSTMAIL 0x00e6` (vanilla never sends it — `SetPosting` has no
caller) and NEVER `0x8860 QUERYMAILBOX_REQ` (TRUE → 5 s client poll loop).

`MODE.MAILBOX = 0x00008000` → add to `packages/entities/src/constants/mode.ts`
(`_Common/authorization.h:35`). This is the ONLY new-mail indicator.

### 3. New package `@flyff/mail` (mirror `packages/party/` layout + package.json/tsup)
- `src/services/mail.service.ts` — list/read/takeItem/takeGold/remove/send(admin).
  takeItem must check `inventory.getEmptyCount() >= 1` first (`DPSrvr.cpp:7425`), then
  `InventoryService.addItem`. takeGold: overflow-check before add. Neither deletes the row.
  On read/remove: if no unread+unclaimed mail left → clear `MODE.MAILBOX` + MODIFYMODE.
- `src/net/snapshot/mailBox.serializer.ts`, `removeMail.serializer.ts`.
- `src/handlers/mail.handler.ts` — 5 handlers above.
- Register in `packages/world-server/src/clientServer.ts` + `compose.ts`.

### 4. Wire format (EXACT — verified against game/source)
```
[objid:DWORD][0x00e9:WORD]
  [idReceiver:DWORD][count:int32]
  per mail: [nMail:DWORD][idSender:DWORD][hasItem:BYTE]
            [CItemElem body 78B if hasItem]     ← reuse writeCItemElemBody (@flyff/world-core)
            [gold:DWORD][ageSecs:uint32][byRead:BYTE]
            [title: DWORD len + chars][text: DWORD len + chars]

[objid:DWORD][0x00e7:WORD][nMail:DWORD][nType:int32]   nType: 0=mail 1=item 2=gold 3=read
```
Traps: create field is an **age** (`now - created`), not a timestamp. `nType` is 4B not BYTE.
`CMailBox::Serialize` (client form) has NO per-mail nMail prefix duplication — that extra prefix
is only `CMailBox::Write` (DB↔world link); using it shifts every field 4B.
Title ≤31 / text ≤255 chars or the client discards the rest of the archive.
`sender_id = 0` renders as literal "FLYFF" (`WndField.cpp:16700`).
Mailbox is a full replace (client `Clear()`s first). Cap 50 (`MAX_MAIL`).
Never reply to QUERYMAILBOX with count 0 while a request-box wait flag is up → poll loop; we never
set that flag since we never send 0x8860.

### 5. World presence + admin command listener
- `packages/world-server/src/ipc/adminListener.ts` — new, modeled on `clusterListener.ts`.
  Channel `admin:command`. Shape-validate payload; HMAC already verified by IpcBus.
  Wire in `index.ts` `startClusterListener` (rename/extend to also `setBus` on the new listener —
  the same `IpcBus` instance can carry both channels).
- Commands: `{kind:'kick', charId}`, `{kind:'teleport', charId, x, z}` (or `kind:'teleport_town'`),
  `{kind:'mail_pushed', charId}` (nudge → set MODE.MAILBOX + MODIFYMODE so an online player sees
  new admin mail immediately).
- Kick: `socket.destroy()` and let `index.ts` `onDisconnect` run (party cleanup + flush). Do NOT
  copy `/out` (`command.service.ts:570`) — it skips the checkpoint flush.
- Teleport: reuse the SETPOS path — `SetPosSerializer.build` → `playerManager.sendTo` →
  `vicinityService.resendAt`. Never REPLACE (nulls client `g_pPlayer`).
  "Town" = `zoneManager` zone's `revival.position` (same source as
  `revival.service.ts:221 teleportToRevival`). Refactor that into a shared helper.
- Presence writes: `join.service.ts` `join()` after `playerManager.add` → `presenceRepo.upsert`;
  `leave()` → `presenceRepo.remove`; `flushAll()` (checkpoint) → `touch`.

### 6. Admin panel
- Add `@flyff/ipc` to `packages/admin/package.json` deps.
- `packages/admin/lib/ipc.ts` — lazily construct one `IpcBus` (redis or `createLocalBus`),
  module-level singleton, node runtime only.
- `app/api/characters/[id]/action/route.ts` — `POST {action:'kick'|'teleport_town'}`.
  `export const runtime='nodejs'`, `dynamic='force-dynamic'`.
- `app/api/mail/route.ts` — `POST` compose admin mail (receiverId, title, text, gold, itemId,
  itemCount) → `mail` row → publish `mail_pushed` nudge if online.
- Character detail page (`app/characters/[id]/page.tsx`): online badge (from `online_players`),
  Kick / Teleport-to-town buttons, Send-Mail form. Also a status column on
  `app/characters/page.tsx`.
- **Security**: `lib/auth.ts:26` gate is binary `account.gm`. `IPC_SECRET` in the web process means
  the route is the ONLY authorization — world trusts any signed envelope. Write `admin_audit_log`
  rows for kick/teleport/mail (no existing route does this yet).

### 7. Tests (node:test + tsx, in `test/` mirroring `src/`)
- `mail.service.test.ts` (take-item bag-full reject, take doesn't delete row, mode-bit clear)
- `mailBox.serializer.test.ts` (byte-exact layout, age field, empty + with-attachment)
- `adminListener.test.ts` (malformed payload dropped)
- `presence.repo.test.ts` (in-memory sqlite)

## Reminders
- Never mark complete / say "fixed" — user is sole source of truth (memory
  `no-complete-without-user-approval`). Leave `in_progress`, ask user to test.
- User tests only on `master` (memory `user-tests-only-on-master`).
