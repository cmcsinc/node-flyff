# Database Agent Session

- **Agent**: database-agent
- **Active Task**: None — ready for database tasks
- **Phase**: Idle
- **Last Updated**: 2026-03-24

## Current Work

_No active database work. Check PROGRESS.md @flyff/database module rows for ⏳ Pending._

## Restore Protocol

1. Read `.claude/state/PROGRESS.md` → `@flyff/database` section — find pending modules
2. Read `.claude/rules/04-persistence.md` — WAL + Knex rules
3. Read existing migrations in `packages/database/src/migrations/` to understand current schema
4. Update this file to `🔄 In Progress` before starting

## Completion Protocol

When a migration or repo is complete:
1. Update `PROGRESS.md` → `@flyff/database` module row to `✅ Done`
2. Update `PROGRESS.md` → **Test Coverage** table with the companion test file status
3. Add entry to PROGRESS.md → **Agent Communication Log**
4. Update this file: Active Task → "None", Phase → "Idle"

## Quality Gates

- [ ] Migration uses Knex schema builder (never raw DDL strings)
- [ ] All tables have indexes on foreign keys and commonly queried fields
- [ ] Repository returns plain typed objects (interfaces, not classes)
- [ ] All mutations use `db.transaction()` where atomicity is needed
- [ ] Slow query threshold 200ms logged at `warn` level
- [ ] Companion `.test.ts` uses in-memory SQLite with `await db.migrate.latest()`

## Parallel Spawning Capability

The `database-agent` agent can spawn parallel sub-agents for independent database tasks:

**When to spawn parallel database agents:**
- Creating migrations for multiple tables (spawn one `database-agent` per table)
- Building multiple repositories for the same feature (spawn one per repo)
- Running migration validation + query optimization (spawn one for each task)

**Spawn pattern:**
```
database-agent (parent)
  ├─ database-agent (accounts migration + repo)
  ├─ database-agent (characters migration + repo)
  └─ database-agent (inventory migration + repo)
→ Aggregate results → Update PROGRESS.md @flyff/database section
```

**Safety limits:**
- maxDepth: 3 (database-agent → database-agent → database-agent)
- maxConcurrent: 5 (max 5 parallel database tasks at once)

**See:** skill `flyff-parallel-spawning` for full protocol.

## Schema Decisions Log

| Table | Decision | Reason |
|-------|----------|--------|
| `accounts` | `password_hash TEXT` stores argon2id of client MD5 | Flyff client sends MD5; we re-hash server-side |
| `characters` | `dirty_flags TEXT` stores JSON array | Enables partial flush (only changed fields) |
