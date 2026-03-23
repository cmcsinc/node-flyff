# Layer Architecture Rules

Enforces the strict Handler → Service → Repository separation that is the backbone of this codebase.

## The Law of Layers

Each layer has exactly one job. **Skipping layers is forbidden.**

```
Network → Handler → Service → Repository → Database
                 ↘ Manager (in-memory state)
                 ↘ System  (per-tick simulation)
```

### Handler (`*.handler.ts`)

**Allowed:**
- Read fields from the `PacketReader`
- Validate every field with `Validate.*` or Zod
- Call **exactly one** service method
- Write the response packet back via `socket.write()`
- Check session state (`session.state === SessionState.IN_WORLD`)

**Forbidden:**
- Importing `knex` or any repository directly
- Containing game logic, formulas, or business rules
- Calling more than one service (orchestration belongs in the service)
- Catching errors silently — let the dispatcher catch and log them

### Service (`*.service.ts`)

**Allowed:**
- All business logic and game rules
- Calling one or more repositories
- Emitting `EventBus` events to communicate results back to handlers
- Calling `appendJournal()` for WAL persistence before any critical mutation
- Calling other services (with care — avoid circular deps)

**Forbidden:**
- Importing `net.Socket` or calling `socket.write()` directly
- Writing raw Knex queries — must use repository methods
- Accessing `process.env` directly — use the validated `config` object

### Repository (`*.repo.ts`)

**Allowed:**
- All Knex query builder calls
- Returning plain typed objects (interfaces, not class instances)
- Using `db.transaction()` for multi-step mutations
- Logging slow queries (> 200ms) at `warn` level

**Forbidden:**
- Any game logic or business rules
- Calling services or emitting events
- Using raw SQL string interpolation — always use Knex query builders or `?` bindings

### Manager (`*.manager.ts`)

**Allowed:**
- Holding in-memory state (`Map<id, Entity>`, `Set<id>`, etc.)
- Providing fast O(1) lookups for live game objects
- Zone-based spatial queries

**Forbidden:**
- Writing to the database (that is the repository's job)
- Containing packet logic

### System (`*.system.ts`)

**Allowed:**
- Per-tick game simulation logic
- Reading from managers
- Emitting events to trigger handler responses

**Forbidden:**
- Any `await` calls inside the tick loop body (defer to a queue)
- Direct socket writes or packet construction

## Dependency Injection

- All singletons are wired in each server's `compose.ts` (composition root).
- Use the `init({ dep1, dep2 }: Deps)` factory pattern — never `new` inside modules.
- Never use global singletons accessible via import — always inject via `compose.ts`.
