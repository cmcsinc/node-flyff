# Real-Client Smoke Runbook

Boot the 3 servers + connect a real v19 client, with packet-level visibility so
you can see every byte the client sends and confirm our server handles it.

## Prerequisites

- **Node 20+**, **pnpm**, **Redis** running on `localhost:6379`.
- A **v19 Flyff client** (`Neuz.exe`) on Windows, pointed at `127.0.0.1`.
- `pnpm install` done at the repo root.

## 1. Secrets + DB

```bash
cp .env.example .env
# set IPC_SECRET to a long random hex (the line shows how to generate it)
```

**Run all commands from the repo root** (`h:\flyff\node-flyff`) — the config
loader + DB path (`./data/flyff_dev.sqlite3`) resolve relative to `cwd`, so the
three servers must share one cwd. (`pnpm --filter X dev` sets cwd to the
package — don't use it for the servers.)

Seed a loggable account + character (the seed auto-applies the migration on a
fresh DB and is idempotent):

```bash
DB_FILENAME=./data/flyff_dev.sqlite3 npx tsx packages/login-server/src/seed.ts
```

Seed creates **account `test` / password `test`** + a character `Tester`. The
stored hash is `argon2(md5("kikugalanet"+"test"))` — exactly what the certifier
expects after decrypting the client's Rijndael blob.

## 2. Enable Redis for cross-server IPC + packet trace

The cluster→world handoff only works over Redis (the in-memory cache is
per-process). Add a local override — create `config/default.local.yml`:

```yaml
cache:
  adapter: redis
  redisUrl: redis://localhost:6379
log:
  level: debug        # shows every inbound frame (opcode + hex)
  pretty: true
```

`log.level: debug` turns on the dispatcher's per-frame trace
(`{ dir: 'in', opcode, len, hex }`) — **this is how you see the real client
packets.**

## 3. Boot the three servers (separate terminals, each from the repo root)

Export the `.env` secrets into your shell first (`IPC_SECRET` is required), then:

```bash
npx tsx packages/login-server/src/index.ts    # :23000  (PN_CERTIFIER: CERTIFY → SRVR_LIST)
npx tsx packages/cluster-server/src/index.ts  # :28000  (PN_LOGINSRVR: GETPLAYERLIST, PRE_JOIN)
npx tsx packages/world-server/src/index.ts    # :2000   (PN_WORLDSRVR: JOIN → self-spawn)
```

Each should log `… client server listening` on its port.

## 4. Connect the client

Point `Neuz.exe` at `127.0.0.1` and log in as **test / test**.

## 5. What to look for (success vs failure)

In the **login-server** terminal, on a successful CERTIFY you should see:

```
… frame … { dir:'in', opcode:'0xfc', len:…, hex:'…' }      # the real CERTIFY
… protocolId negotiated … { protocolId: … }                # the hello handshake
… Authentication successful
… Login successful
```

The client then disconnects from `:23000` and connects to the cluster `:28000`
(hardcoded `PN_LOGINSRVR`; the IP comes from `SRVR_LIST` — `server.publicHost`,
**not** the `0.0.0.0` bind `host`). Watch the **cluster-server** terminal for
`opcode:'0xf6'` (GETPLAYERLIST), then `0xff05` (PRE_JOIN). On PRE_JOIN the
cluster publishes `player:handoff` over Redis; the **world-server** terminal
should log `Listening for player handoffs` then `Player handoff received`. The
client's JOIN (`0xff00`) to `:2000` (`PN_WORLDSRVR`) produces the JOIN/ADD_OBJ
snapshot and `Player entered world`.

### If it breaks — the packet trace tells you where

| Symptom in the log | Cause |
| --- | --- |
| `Unknown opcode — dropping { opcode:'0xffffffff' }` | `leadsWithDpid` not applied on that server (cluster/world must skip the DPID DWORD). |
| `CRC frame verification failed — dropping socket` | Our CRC vs the client's disagree — frame/protocolId handshake mismatch. Compare the first frame hex against `_Network/Net/Src/buffer.cpp`. |
| `Undersized payload — dropping` | The hello handshake didn't complete before the first real packet. |
| `Login failed: invalid credentials` | Stored hash ≠ `argon2(md5("kikugalanet"+typed))`. Re-seed. |
| `Login failed: packet/auth error` | Field-order mismatch in CERTIFY — the client's bytes don't match `[str ver][str acct][672B blob]`. |

## 6. Capturing a frame for a regression test

When a real CERTIFY frame is visible in the debug hex, paste the `0xfc` frame's
full bytes (plus the hello's `protocolId`) into a hex literal in
`packages/login-server/test/e2e/` — that turns a one-off live check into a
permanent known-vector test (closing the circularity of the self-built smokes).
