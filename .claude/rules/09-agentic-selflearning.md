# Agentic Self-Learning Protocol

Rules for how agents learn from their own work, share knowledge across sessions, and autonomously improve their own processes.

## The Research → Implement → Validate → Test → Fix Loop

Every feature follows a mandatory 5-phase loop. **No phase may be skipped.**

```
┌────────────────────────────────────────────────────────────────────────────┐
│  1. RESEARCH     2. IMPLEMENT    2.5 VALIDATE   3. TEST      4. FIX        │
│  ──────────      ───────────     ──────────     ──────       ─────         │
│  researcher  →  implementor  →  sec-auditor  →  test-agent → implementor   │
│  finds facts    writes code     checks plan     runs tests   fixes errors   │
│                                                                             │
│  Loop: tests fail → FIX → re-TEST → pass → update PROGRESS.md → done      │
└────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1 — Research
- `researcher` agent finds the canonical C++ implementation.
- Logs all opcodes, packet structures, and formulas to `PROGRESS.md` → **Research Findings**.
- If no C++ source available, marks it as "Best effort / spec-based" in the log.
- **Gate**: Research output must be complete before implementation begins.

### Phase 2 — Implement
- `implementor` agent reads the researcher's findings from `PROGRESS.md`.
- Writes code bottom-up: DB migration → repo → service → handler.
- Creates the `.test.ts` stub **alongside** the source file (even if empty).
- Updates `PROGRESS.md` module row to `🔄 In Progress`.
- **Gate**: TypeScript must compile (`tsc --noEmit`) before moving to validate phase.

### Phase 2.5 — Plan Validation (Architect → Security-Auditor)
- **Before any code ships**, the `architect` shares the design plan with `security-auditor`.
- `security-auditor` runs a **Plan Review** (see its agent file for format).
- Any 🔴 Critical finding blocks the plan — `implementor` must revise.
- Any 🟠 High finding must be acknowledged and addressed.
- Only 🟡 Medium or 🟢 Low findings may proceed without code change.
- **Gate**: No 🔴 Critical findings before test phase.

### Phase 3 — Test
- `test-agent` reads the implementation and writes complete test coverage.
- Runs `npx tsx --test <file.test.ts>` and **must see green** before finishing.
- Appends test result to `SESSION.md` → **Test Results**.
- **Gate**: All tests must pass (0 failures) before marking done.

### Phase 4 — Fix
- If tests fail, `implementor` or `test-agent` fixes the root cause.
- **Never** comment out failing tests or use `.skip()` to force green.
- **Never** weaken an assertion to pass — fix the code instead.
- Loop back to Phase 3 until all tests pass.

**On success**: Update `PROGRESS.md` module row to `✅ Done`.

### Parallel Mode (for independent subtasks)

When an agent has multiple independent subtasks, it can spawn parallel sub-agents instead of running sequentially:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    PARENT AGENT (e.g., implementor)                        │
│                              │                                             │
│           ┌──────────────────┼──────────────────┐                         │
│           │                  │                  │                         │
│           ▼                  ▼                  ▼                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                   │
│  │ database-    │   │ security-    │   │ test-        │                   │
│  │ agent        │   │ auditor      │   │ agent        │                   │
│  │ (migration)  │   │ (review)     │   │ (tests)      │                   │
│  └──────────────┘   └──────────────┘   └──────────────┘                   │
│           │                  │                  │                         │
│           └──────────────────┼──────────────────┘                         │
│                              ▼                                             │
│                    PARENT MERGES RESULTS                                   │
│                    → updates PROGRESS.md                                   │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key principle:** Parallel sub-agents run independently, then the parent aggregates results via the Agent tool return value and updates shared state (PROGRESS.md).

This is **optional** — use parallel spawning only when subtasks are truly independent. For sequential dependencies, use the standard loop.

---

## The Two State Files

### SESSION.md — Per-session single-agent state
Path: `.claude/state/SESSION.md`

- Tracks the **current agent's** active goal and in-progress task.
- Written by hooks automatically (checkpoint + test reminder).
- Reset at the start of each major task.
- **One agent at a time writes to this.**

### PROGRESS.md — Cross-agent persistent ledger
Path: `.claude/state/PROGRESS.md`

- Tracks the **entire project's** module implementation status.
- Shared memory layer: every agent reads and writes it.
- Contains: module status table, test coverage table, security audit log, research findings, lessons learned, known blockers.
- **Every agent reads this at session start. Every agent writes to this when completing work.**

---

## Self-Learning: What Agents Must Record

### After a FAIL → PASS test fix (lesson learned):
The `post-tool-auto-test.mjs` hook automatically records lessons when a previously-failing test turns green. Agents must also manually record the root cause:

```markdown
## Lessons Learned
- **[2026-03-25] packages/core/src/net/PacketBuffer.test.ts**: PacketBuffer.drain() panicked on
  chunks < 4 bytes — added minimum length guard before reading the size DWORD.
```

Write to both:
1. `MEMORY.md` → `## Lessons Learned` section (automatic via hook, but also manually if rich context available)
2. `PROGRESS.md` → `## Lessons Learned` table

### After implementing a module:
```markdown
## Research Findings
| Topic | Found By | Summary | Source |
|-------|----------|---------|--------|
| SNSP_LOGIN_CERTIFY packet | researcher | 4 fields: key, username, md5pw, version | references/WorldServer/Login.cpp:42 |
```

### After a failed test (lesson learned):
```markdown
## Agent Communication Log
| 2026-03-24 | test-agent | implementor | PacketBuffer.drain() fails when chunk < 4 bytes — add minimum length guard |
```

### After a security audit finding:
```markdown
## Security Audit Log
| File | Audited By | Result | Date |
|------|-----------|--------|------|
| auth.handler.ts | security-auditor | 🟡 Rate limiter missing on CERTIFY handler | 2026-03-24 |
```

---

## Per-Agent Session Files

Each long-running agent maintains its own session file under `.claude/state/agents/`:

```
.claude/state/agents/
  implementor.md      ← implementor agent's current task state
  test-agent.md       ← test-agent's test run log
  researcher.md       ← researcher's discovery queue
  security-auditor.md ← audit queue and findings
  database-agent.md   ← migration + repo task log
```

**Every sub-agent** launched via the `Agent` tool MUST:
1. Read its own `.claude/state/agents/<name>.md` file at start (restore session).
2. Update it with active task before doing any work.
3. Update it with completion status + discoveries when finished.
4. Write findings to `PROGRESS.md` (shared cross-agent memory).

Sub-agents write to their **own** session file AND to `PROGRESS.md`.
Sub-agents do **NOT** write to the parent's `SESSION.md`.

### Per-Agent Session File Format
```markdown
# <Agent Name> Session

- **Agent**: implementor
- **Active Task**: Implement `packages/core/src/net/PacketReader.ts`
- **Phase**: 2 — Implement
- **Last Updated**: 2026-03-24 12:00

## Current Work
- [x] Designed interface
- [/] Writing readDword() method — line 45 done, readString() pending
- [ ] Write companion test file

## Discoveries This Session
- PacketReader needs to handle empty buffers gracefully (will document in PROGRESS.md)

## Next Step
Complete readString() method, then run tests.
```

---

## Autonomous Handoff Rules

When an agent finishes its phase and needs to hand off to the next agent:

1. Update `PROGRESS.md` with the work completed.
2. Write an entry in the **Agent Communication Log** with a one-line summary for the next agent.
3. Update its own per-agent session file to `Completed`.
4. The parent session then invokes the next agent with the PROGRESS.md context.

### Example handoff message (researcher → implementor):
```
Research complete for SNSP_LOGIN_CERTIFY. See PROGRESS.md → Research Findings.
Key finding: packet has 4 fields (key:DWORD, username:String, md5pw:String, version:DWORD).
Source: references/WorldServer/Login.cpp line 42-67.
Ready for implementation.
```

### Example handoff message (implementor → security-auditor → test-agent):
```
Implementation complete for auth.handler.ts. Requesting plan validation.
Security-auditor: review the design plan in PROGRESS.md → Research Findings for SNSP_LOGIN_CERTIFY.
On green, test-agent: write tests for packages/login-server/src/handlers/auth.handler.ts.
```

---

## Anti-Patterns — Never Do These

- **Never fabricate** a packet structure or game formula. If unsure, research first.
- **Never skip** writing the `.test.ts` file — even a stub is required before marking in-progress.
- **Never mark** a module ✅ Done unless both the source AND its test file exist and pass.
- **Never overwrite** existing `PROGRESS.md` rows without reading them first.
- **Never** let `SESSION.md` grow stale — the `stop` hook updates it automatically, but agents must also write to it after each completed task.
- **Never** share a lesson only in `SESSION.md` — it must go in `PROGRESS.md` and/or `MEMORY.md` to survive across sessions.
