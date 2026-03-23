---
name: flyff-state-persistence
description: >
  Crash-proof state persistence architecture for the Flyff TypeScript emulator.
  Solves the "Rollback vs DB DDoS" MMORPG dilemma using an embedded SQLite Write-Ahead Log (WAL)
  pattern alongside the main Knex (Postgres/MySQL) database.
  Use this skill when designing how and when to save player data, implementing inventory transactions,
  preventing item duplication (dupes), crash recovery, and synchronising memory state to the database.
  Trigger on: "save character", "rollback", "dupe prevention", "persistence", "WAL", "journal",
  "crash recovery", "state management", "database sync", "save data".
---

# Flyff Emulator — State Persistence & Crash Recovery

The classic MMORPG problem:
- Saving to the DB on every action = DB DDoS / Lag.
- Saving to the DB every 5 minutes = Rollbacks and Duping exploits on crash.

**Solution:** The Hybrid WAL (Write-Ahead Log) Pattern.

## Architecture

1. **Main Database (Postgres/MySQL via Knex):** The source of truth. Updated every 30-60 seconds asynchronously or on player logout.
2. **Live Memory (`CPlayer`):** 0ms latency. The game loop reads/writes here.
3. **Local Journal (Embedded SQLite):** Every World Server process has its own local `world_{id}_journal.sqlite` database. Critical state changes are instantly appended here.

If the World Server crashes, upon reboot, it reads the journal and replays unprocessed events into the Main Database before accepting connections.

---

## The SQLite Journal (WAL)

The journal is exclusively for crash recovery. It is NOT queried during normal gameplay.

```ts
// packages/world-server/src/journal.ts
import Database from 'better-sqlite3';

export const journalDb = new Database(`data/world_${config.SERVER_ID}_journal.sqlite`);
journalDb.pragma('journal_mode = WAL'); // Crucial for extreme write performance
journalDb.pragma('synchronous = NORMAL');

journalDb.exec(`
  CREATE TABLE IF NOT EXISTS pending_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    char_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const insertStmt = journalDb.prepare(
  'INSERT INTO pending_events (char_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)'
);

export function appendJournal(charId: number, type: string, payload: unknown): void {
  // Synchronous execution, but takes < 0.1ms locally. Doesn't block the network.
  insertStmt.run(charId, type, JSON.stringify(payload), Date.now());
}

export function clearJournal(charId: number, upToTimestamp: number): void {
  journalDb.prepare('DELETE FROM pending_events WHERE char_id = ? AND created_at <= ?')
           .run(charId, upToTimestamp);
}
```

---

## Modifying State (The Flow)

When a player does something critical (e.g., gains an item):

```ts
// services/inventory.service.ts
import { appendJournal } from '../journal.js';

export class InventoryService {
  async addItem(player: CPlayer, itemId: number, count: number): Promise<void> {
    // 1. Update Live Memory (Instant)
    player.inventory.add(itemId, count);
    player._dirty.add('inventory'); // Mark for Main DB sync

    // 2. Append to Local Journal (Crash Protection)
    // If the server crashes 1ms after this, the item is not lost.
    appendJournal(player.m_dwCharId, 'ITEM_ADD', { itemId, count });

    // 3. Send packet to client
    sendItemAddPacket(player.socket, itemId, count);
  }
}
```

**What needs to be journaled?**
- Item gains/losses/trades (Dupe prevention)
- Penya (Gold) changes
- Level ups
- Quest progression
**What DOES NOT need to be journaled?**
- Taking 1 step forward
- Gaining 5 exp from a monster hit (just mark `_dirty`, if they lose 5 exp on crash, it's acceptable. If they level up, journal it).

---

## Background DB Sync (The Flusher)

Every 30 seconds, flush dirty memory to the Main Postgres/MySQL DB, then clear the journal.

```ts
// systems/persistence.system.ts
import { characterRepo } from '@flyff/database/repositories/character.repo.js';
import { clearJournal } from '../journal.js';

export class PersistenceSystem {
  tick(): void {
    // Run every 30s
    const dirtyPlayers = playerManager.all().filter(p => p.isDirty);

    for (const player of dirtyPlayers) {
      const syncTime = Date.now();

      // Async save to Main Postgres/MySQL
      characterRepo.save(player).then(() => {
        // Upon successful main DB save, clear the recovery journal
        player.clearDirty();
        clearJournal(player.m_dwCharId, syncTime);
      }).catch(err => {
        logger.error({ err, charId: player.m_dwCharId }, 'Failed to save player');
        // Do NOT clear dirty flag or journal. It will retry next tick.
      });
    }
  }
}
```

---

## Crash Recovery (On Server Boot)

Before the World Server opens its port (`:38180`) to accept players, it must process the journal:

```ts
// world-server/src/index.ts
import { journalDb } from './journal.js';
import { characterRepo } from '@flyff/database/repositories/character.repo.js';

async function recoverFromCrash(): Promise<void> {
  const pending = journalDb.prepare('SELECT * FROM pending_events ORDER BY id ASC').all();

  if (pending.length === 0) return;
  logger.info(`Recovering ${pending.length} unsynced events from crash...`);

  // Group events by character
  const byChar = new Map<number, any[]>();
  for (const row of pending) {
    if (!byChar.has(row.char_id)) byChar.set(row.char_id, []);
    byChar.get(row.char_id)!.push(row);
  }

  // Apply events to Main DB
  for (const [charId, events] of byChar.entries()) {
    const charData = await characterRepo.findById(charId);
    if (!charData) continue;

    // Apply the math to the snapshot
    for (const event of events) {
      const payload = JSON.parse(event.payload);
      if (event.event_type === 'ITEM_ADD') {
        // e.g. Add item to character's inventory JSON/table
      }
      // ... handle other critical events
    }

    // Save recovered state to Main DB
    await characterRepo.saveRecovered(charData);

    // Clear journal for this char
    clearJournal(charId, Date.now());
  }

  logger.info('Crash recovery complete.');
}

// Boot sequence
await recoverFromCrash();
await startServer();
```

## Why this is better than the C++ CacheServer:
1. **No External Dependencies:** Uses `better-sqlite3`. Works perfectly on a local dev laptop without Redis.
2. **Zero Network Overhead:** Writing to the WAL takes nanoseconds because it's on the local NVMe/SSD, not sent over a TCP socket.
3. **No Database DDoS:** Postgres/MySQL only sees one massive, efficient batch update every 30 seconds per player, instead of thousands of micro-queries.
4. **Complete Dupe Protection:** Because the WAL write is synchronous before the packet is sent to the client, a trade cannot complete in the client without being safely on disk.