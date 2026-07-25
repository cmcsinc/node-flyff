---
name: flyff-security
description: >
  Security architecture for the Flyff Node.js server emulator: input validation, rate
  limiting, anti-cheat detection, session token security, password hashing, SQL injection
  prevention, DoS protection, and privilege separation. Use this skill whenever the user
  asks about authentication security, how to prevent cheating, validating packet data,
  banning players, protecting the server from abuse, handling malformed packets, or any
  security-sensitive code path. Trigger on: "security", "auth", "password", "hash",
  "token", "ban", "cheat", "exploit", "rate limit", "validation", "injection", "sanitize",
  "JWT", "session", "anti-cheat", "speed hack", "teleport hack", "buffer overflow", "DoS".
---

# Flyff Emulator — Security

## Authentication Security

### Password Hashing

Never store or compare plaintext passwords. Use **argon2** (preferred) or bcrypt:

```js
// services/auth.service.js
import argon2 from 'argon2';

const ARGON2_OPTIONS = {
  type:        argon2.argon2id,
  memoryCost:  65536, // 64 MB
  timeCost:    3,
  parallelism: 2,
};

export async function hashPassword(plaintext) {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hash, plaintext) {
  return argon2.verify(hash, plaintext);
}
```

> **Legacy note**: Flyff v19 clients send MD5-hashed passwords. If targeting a vanilla client, you may need to accept MD5 from the client but store argon2 hashes in the DB. Bridge: store the argon2 hash of the MD5 string, not the plaintext.

---

## One-Time Session Tokens (Login → World Handoff)

The cluster server issues a single-use token when a player selects their character. The world server redeems it exactly once:

```js
// services/token.service.js
import crypto from 'crypto';

const TOKEN_TTL_MS = 30_000; // 30 seconds
const pending = new Map(); // token → { accountId, charId, expiry }

export function issueToken(accountId, charId) {
  const token = crypto.randomBytes(16).toString('hex');
  pending.set(token, {
    accountId,
    charId,
    expiry: Date.now() + TOKEN_TTL_MS,
  });
  // Auto-expire
  setTimeout(() => pending.delete(token), TOKEN_TTL_MS);
  return token;
}

export function redeemToken(token) {
  const entry = pending.get(token);
  if (!entry) throw new AuthError('Invalid or expired token', 'TOKEN_INVALID');
  if (Date.now() > entry.expiry) {
    pending.delete(token);
    throw new AuthError('Token expired', 'TOKEN_EXPIRED');
  }
  pending.delete(token); // single-use — delete immediately
  return entry;
}
```

---

## Packet Input Validation

Every incoming packet field must be validated **before** use. Never trust the client:

```js
// utils/validate.js

/**
 * Asserts condition; throws PacketError if false.
 * Use for all packet field validation.
 */
export function assert(condition, message) {
  if (!condition) throw new PacketError(message, 'INVALID_PACKET');
}

export const Validate = {
  byte:   v => assert(Number.isInteger(v) && v >= 0 && v <= 0xFF,   `Invalid byte: ${v}`),
  word:   v => assert(Number.isInteger(v) && v >= 0 && v <= 0xFFFF, `Invalid word: ${v}`),
  dword:  v => assert(Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF, `Invalid dword: ${v}`),
  name:   s => assert(typeof s === 'string' && /^[a-zA-Z0-9_]{3,16}$/.test(s), `Invalid name: ${s}`),
  chat:   s => assert(typeof s === 'string' && s.length <= 128, 'Chat too long'),
  slot:   v => assert(Number.isInteger(v) && v >= 0 && v < MAX_INVEN_SLOTS, `Invalid slot: ${v}`),
  pos:    p => {
    assert(typeof p.x === 'number' && isFinite(p.x), 'Invalid pos.x');
    assert(typeof p.y === 'number' && isFinite(p.y), 'Invalid pos.y');
    assert(typeof p.z === 'number' && isFinite(p.z), 'Invalid pos.z');
  },
};
```

### Handler with validation

```js
async function handleChat(socket, reader) {
  const msg = reader.readString();
  Validate.chat(msg);                          // length & type check
  assert(socket.session.state === IN_WORLD, 'Not in world');
  const player = playerManager.get(socket.session.charId);
  assert(player !== null, 'Player not found');
  // safe to proceed
}
```

---

## Rate Limiting (Per-Socket)

Prevent packet flooding that could crash or lag the server:

```js
// net/rateLimiter.js
const WINDOW_MS     = 1000;  // 1-second window
const MAX_PACKETS   = 100;   // max packets per second per client
const MAX_BYTES     = 65536; // max bytes/sec (64 KB)

export class RateLimiter {
  constructor() {
    this.packets = 0;
    this.bytes   = 0;
    this.reset   = Date.now() + WINDOW_MS;
  }

  /** Returns true if rate exceeded (should drop/ban) */
  check(packetSize) {
    const now = Date.now();
    if (now > this.reset) {
      this.packets = 0;
      this.bytes   = 0;
      this.reset   = now + WINDOW_MS;
    }
    this.packets++;
    this.bytes += packetSize;
    return this.packets > MAX_PACKETS || this.bytes > MAX_BYTES;
  }
}
```

```js
// In onData handler
function onData(socket, chunk) {
  if (socket.session.rateLimiter.check(chunk.length)) {
    logger.warn({ ip: socket.remoteAddress }, 'Rate limit exceeded — banning');
    banManager.tempBan(socket.remoteAddress, 60_000);
    socket.destroy();
    return;
  }
  // ...process packet normally
}
```

---

## Anti-Cheat Detection

### Speed Hack Detection

```js
// systems/anticheat.js
const MAX_SPEED         = 80;   // units/second (adjust to Flyff movement speed)
const TELEPORT_THRESHOLD = 500; // units — suspicious jump distance

export function checkMovement(player, newPos, dt) {
  const dist = distance3d(player.m_vPos, newPos);
  const speed = dist / (dt / 1000);

  if (dist > TELEPORT_THRESHOLD) {
    flag(player, 'TELEPORT', { from: player.m_vPos, to: newPos, dist });
    return false; // reject position
  }

  if (speed > MAX_SPEED * 1.2) { // 20% tolerance
    flag(player, 'SPEED_HACK', { speed, max: MAX_SPEED });
    return false;
  }

  return true;
}
```

### Exploit Flags & Auto-action

```js
// systems/flagSystem.js
const flags = new Map(); // charId → { count, violations[] }

export function flag(player, type, data) {
  const entry = flags.get(player.m_dwCharId) ?? { count: 0, violations: [] };
  entry.count++;
  entry.violations.push({ type, data, ts: Date.now() });
  flags.set(player.m_dwCharId, entry);

  logger.warn({ charId: player.m_dwCharId, type, data }, 'Anti-cheat flag');

  // Progressive response
  if (entry.count >= 3 && entry.count < 10) {
    // Silently correct position — don't tip off the cheater
    snapPlayerBack(player);
  } else if (entry.count >= 10) {
    kickPlayer(player, 'Suspicious activity');
  } else if (entry.count >= 20) {
    banManager.ban(player.m_dwCharId, 'Auto-ban: cheat detected');
  }
}
```

### Stat Sanity Checks

```js
// Verify calculated stats server-side — never trust client-sent stats
export function validatePlayerStats(player) {
  const expected = StatCalculator.computeStats(player);
  const atk = Math.abs(player.m_nAtk - expected.atk);
  if (atk > 10) {
    flag(player, 'STAT_HACK', { clientAtk: player.m_nAtk, expected: expected.atk });
  }
}
```

---

## SQL Injection Prevention

**Never** interpolate user data into Knex query strings. Always use Knex's built-in parameterization or `.where({ key: val })` objects:

```js
// WRONG ❌
const rows = await db.raw(`SELECT * FROM accounts WHERE username = '${username}'`);

// CORRECT ✅ — parameterized via object
const rows = await db('accounts').where({ username }).select('id', 'password_hash');

// CORRECT ✅ — parameterized via raw array
const rows = await db.raw(
  'SELECT id, password_hash FROM accounts WHERE username = ?',
  [username]
);
```

All repository functions must use Knex query builders securely.

---

## IP Banning & Account Banning

```js
// managers/banManager.js
const ipBans  = new Map(); // ip → expiry (ms)
const accBans = new Set(); // accountId

export const banManager = {
  tempBan(ip, durationMs) {
    ipBans.set(ip, Date.now() + durationMs);
    setTimeout(() => ipBans.delete(ip), durationMs);
  },

  permBan(ip) { ipBans.set(ip, Infinity); },

  banAccount(accountId) {
    accBans.add(accountId);
    db.query('UPDATE accounts SET status = 0 WHERE id = $1', [accountId]);
  },

  isIpBanned(ip) {
    const expiry = ipBans.get(ip);
    if (!expiry) return false;
    if (expiry !== Infinity && Date.now() > expiry) { ipBans.delete(ip); return false; }
    return true;
  },

  isAccountBanned(accountId) { return accBans.has(accountId); },
};
```

Check on connection and on login:
```js
server.on('connection', socket => {
  if (banManager.isIpBanned(socket.remoteAddress)) {
    socket.destroy();
    return;
  }
  // ...proceed
});
```

---

## Internal Server Security

Secure the internal ports (login↔cluster↔world) so only trusted processes connect:

```js
// Internal server: bind only to localhost, require shared secret
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'change-me-in-prod';

internalServer.on('connection', socket => {
  socket.once('data', chunk => {
    const secret = chunk.toString('ascii', 0, 64).trim();
    if (secret !== INTERNAL_SECRET) {
      logger.warn({ ip: socket.remoteAddress }, 'Internal auth failed');
      socket.destroy();
      return;
    }
    // ...register as a trusted internal connection
  });
});
```

- **Never** expose internal ports (e.g. 29000, 38180) to the public internet
- Use firewall rules (iptables / ufw) to allow only localhost or private VLAN

---

## Dependency Security

```bash
# Audit dependencies weekly
npm audit

# Lock versions in production
npm ci  # not npm install

# Environment variable validation at startup
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
```

---

## Security Checklist per Feature

When implementing any new handler, ask:
- [ ] Is the player state validated (must be IN_WORLD, etc.)?
- [ ] Are all string fields length-bounded?
- [ ] Are all numeric fields range-checked?
- [ ] Is the action rate-limited?
- [ ] Is the result computed server-side (not trusting client values)?
- [ ] Are DB queries parameterized?
- [ ] Is the action logged at appropriate level?

See `references/cheat-patterns.md` for known Flyff exploit patterns and mitigations.
