# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub's [private vulnerability reporting][gh-pvr]
on this repository (Security → Report a vulnerability). If that is unavailable,
open an issue titled "Security contact request" with no technical detail and a
maintainer will reply with a private channel.

[gh-pvr]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

Please include:

- What the vulnerability lets an attacker do (dupe an item, crash the world
  server, read another account's data, escalate to GM).
- The packet, handler, or endpoint involved — opcode hex and file path if you
  have them.
- Steps or a hex dump that reproduces it.
- Which commit you tested.

Expect an acknowledgement within a few days. There is no bounty program; this is
a hobby project.

## Scope

This is an unofficial, educational game-server emulator. Security work in scope:

- **Server-authority bypasses** — anything where a crafted client packet changes
  state the server should own (HP, damage, item counts, gold, stats, GM level).
- **Item / currency duplication** — races or crash windows in the WAL journal,
  inventory moves, trade, bank, mail, or vending.
- **Remote crashes / DoS** — a packet that kills the world server or wedges the
  50 ms tick for every connected player.
- **Injection** — SQL injection through a repository, or command injection in
  admin/supervisor tooling.
- **AuthN / AuthZ** — login bypass, session hijacking via the handoff token,
  privilege escalation to `ADMINISTRATOR`, IPC message forgery.
- **Admin panel** — auth bypass, SSRF, path traversal in the resource or client-patch
  writers.

Out of scope:

- Weaknesses in the original Flyff client or its protocol. The protocol is
  reproduced faithfully on purpose; "the client trusts the server" is by design.
- The seeded `test` / `test` development account at `ADMINISTRATOR` tier. It is
  intentional for local development, not a backdoor. Do not deploy the dev seed
  to a public server.
- Default development configuration (`IPC_SECRET=change-me-in-production`,
  SQLite, no TLS). These are documented placeholders — see
  [Deployment hardening](#deployment-hardening).
- Anything requiring host access to the machine already running the server.

## Supported versions

Only `master` is supported. There are no tagged releases or backports yet.

## Deployment hardening

If you run this on a public network, at minimum:

| Setting | Development default | Production requirement |
| --- | --- | --- |
| `IPC_SECRET` | `change-me-in-production` | 32+ random bytes, unique per deployment |
| Database | SQLite file | PostgreSQL or MySQL with a scoped user |
| IPC transport | plain TCP on localhost | TLS with mutual certificate auth, private VLAN only |
| IPC / DB / Redis ports | bound broadly | never reachable from the internet |
| Dev seed account | `test` / `test` at `ADMINISTRATOR` | removed |
| Admin panel | no auth assumptions | behind auth and a private network |
| Supervisor daemon token | `data/supervisor.token` on disk | restricted file permissions, rotated |

Only ports 23000 (login), 38100 (cluster), and 38180 (world) should face
players. Everything else — Redis, the database, the IPC TCP listener, the admin
panel, the supervisor daemon — belongs on a private interface.

Passwords are hashed with argon2id. If the client sends an MD5 digest (vanilla
v19 behaviour), the argon2 hash of that digest is what gets stored; the plaintext
password never reaches the server and is never stored either way.

## Internal security rules

Contributors: the enforced rules are in
[`.claude/rules/03-security.md`](.claude/rules/03-security.md) — input validation
at the packet boundary, WAL-journal-before-acknowledge, session-state guards,
server-side stat computation, and the per-handler checklist. A PR touching a
handler is reviewed against that checklist.
