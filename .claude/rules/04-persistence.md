# Persistence & WAL Rules

Governs how and when data is written to the WAL journal and the main Knex database.

## The Hybrid WAL Pattern

This project solves the "rollback vs. DB DDoS" problem with a two-tier persistence model:

| Tier | Storage | Latency | When |
| --- | --- | --- | --- |
| **Hot (WAL)** | `better-sqlite3` WAL journal on local SSD | < 0.1ms | Immediately, before response is sent |
| **Cold (Main DB)** | Knex → SQLite3 / PostgreSQL / MySQL | ~5–200ms | Every 30s batch flush, or on disconnect |

## Rules for WAL Usage

1. **Journal BEFORE acknowledging.** The client must not receive a success response until the WAL entry is written.
2. **Journal AFTER validation.** Do not journal if the action will be rejected (e.g., invalid slot). Check first, journal second, persist third.
3. **Journal in the Service layer.** Never call `appendJournal()` from a Handler or Repository.
4. **Include enough context to replay.** The journal payload must contain everything needed to reconstruct the state without reading from the main DB.

### What MUST be journaled

- Any inventory mutation (add, remove, move, split, merge)
- Gold changes (gain, spend, trade)
- Experience / level-up events
- Skill point / stat point changes
- Quest state transitions
- Trade completions

### What does NOT need journaling

- Chat messages
- Movement / position updates (position is checkpoint-saved every 30s)
- NPC dialogue state
- UI-only packets

## Dirty Flags

In-memory entities use a `_dirty` Set to track which fields have been modified:

```ts
player._dirty.add('m_nGold');
player._dirty.add('m_nLevel');
// Only these fields are flushed to the DB on the next 30s sync
```

- Always call `player._dirty.add('fieldName')` after modifying a persistent field.
- The flush loop reads `_dirty`, builds a partial `UPDATE`, then clears the set.
- On disconnect, flush immediately regardless of the 30s timer.

## Crash Recovery

On World Server startup, before accepting connections:

1. Open the local WAL journal (`world_X_journal.sqlite`).
2. Read all rows where `replayed = 0`.
3. Re-apply each event to the main DB in order.
4. Mark them `replayed = 1`.
5. Only then open the TCP listener.

## Main DB Sync Rules

- Use `knex.batchInsert()` for bulk operations (inventory saves on disconnect).
- Use dirty-flag partial updates — never re-save the entire character row every 30s.
- The 30s flush is `setInterval` — never `await` inside the callback. Use a queue.
- Log if any flush takes > 200ms.
