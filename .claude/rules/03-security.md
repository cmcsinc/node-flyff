# Security Rules

All code paths that touch player data, authentication, or network input must follow these rules without exception.

## Input Validation — Never Trust the Client

Every single field read from a `PacketReader` must be validated before use:

```ts
// WRONG — never do this
const slot = reader.readByte();
inventory.moveItem(slot, dst); // slot could be 9999

// CORRECT
const slot = reader.readByte();
Validate.slot(slot);           // throws PacketError if out of range
inventory.moveItem(slot, dst);
```

Required validations by type:
- **Strings:** `Validate.name()` (3–16 alphanumeric) or `Validate.chat()` (≤ 128 chars)
- **Slot indices:** `Validate.slot()` (0 ≤ slot < MAX_INVEN_SLOTS)
- **Numeric IDs:** `Validate.dword()` (0 ≤ n ≤ 0xFFFFFFFF)
- **Positions:** `Validate.pos()` (all coords must be finite floats)

## WAL-First for Critical Mutations

Any handler that changes items, gold, or experience **must** call `appendJournal()` synchronously BEFORE sending the success response to the client:

```ts
// WRONG — crash after this line = item dupe
await inventoryRepo.removeItem(charId, srcSlot);
socket.write(responsePacket);

// CORRECT — journal survives crash
appendJournal(charId, 'ITEM_REMOVED', { slot: srcSlot, itemId });
await inventoryRepo.removeItem(charId, srcSlot);
socket.write(responsePacket);
```

## Session State Guard

Every handler that operates on in-world data must check session state first:

```ts
assert(socket.session.state === SessionState.IN_WORLD, 'Not in world');
const player = playerManager.get(socket.session.charId);
assert(player !== null, 'Player not found');
```

## SQL Injection Prevention

**Never** interpolate variables into Knex raw queries:

```ts
// FORBIDDEN ❌
db.raw(`SELECT * FROM accounts WHERE username = '${username}'`);

// REQUIRED ✅
db('accounts').where({ username });
db.raw('SELECT * FROM accounts WHERE username = ?', [username]);
```

## Password Handling

- Passwords are **never stored or compared in plaintext**.
- Hash with `argon2id` (see `flyff-security` skill for config).
- If the client sends MD5 (Flyff v19 vanilla), store the argon2 hash of the MD5 string.

## IPC Message Security

- All inter-server messages must be HMAC-SHA256 signed via `signIpcMessage()`.
- Reject any message where: signature is invalid, `ts` is missing, or `Date.now() - ts > 30_000`.
- Never send plain-text secrets over IPC channels.

## Rate Limiting

- Every handler that can be called repeatedly by the client must have a rate limiter check.
- Use `socket.session.rateLimiter.check(packetSize)` — destroy socket if exceeded.

## Anti-Cheat

- **All stats are computed server-side.** Never trust client-sent HP, ATK, DEF values.
- **Movement validation:** reject positions where `distance / dt > MAX_SPEED * 1.2`.
- **Gold/count overflow:** clamp with `Math.min(value, MAX_GOLD)` before assignment.
- **Negative values:** always check `count > 0` before item operations.

## Security Checklist (apply to every new handler)

- [ ] All string fields length-bounded?
- [ ] All numeric fields range-checked?
- [ ] All slot indices bounds-checked?
- [ ] Session state validated before use?
- [ ] Critical mutation journaled to WAL before response?
- [ ] DB query using Knex builder (no raw interpolation)?
- [ ] Rate limit applied?
- [ ] Result computed server-side (not from client packet)?
