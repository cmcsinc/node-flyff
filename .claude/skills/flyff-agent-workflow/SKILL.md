---
name: flyff-agent-workflow
description: >
  Standard operating procedures for Flyff emulator agents: the 5-phase
  Research→Implement→Validate→Test→Fix loop, per-agent responsibilities,
  quality/security gates, session restoration, checkpointing, task tracking,
  and autonomous handoffs. Read this before spawning a sub-agent, writing a
  plan, or resuming interrupted work. Trigger on: "restore session",
  "checkpoint", "resume", "handoff", "workflow", "agent state",
  "save progress", "which agent", "spawn an agent", "sub-agent",
  "phase gate", "quality gate", "PROGRESS.md", "SESSION.md".
---


# Flyff Emulator — Agent Workflow & Session Restoration

To ensure this project remains "fully agentic," every agent (main or sub-agent) must follow a strict checkpointing protocol. This allows any future agent instance to resume exactly where the previous one left off.

---

## 1. The Two State Files

### SESSION.md — Per-session single-agent state
Path: `.claude/state/SESSION.md`

- Tracks the **current (main) agent's** active goal and in-progress task.
- Written by hooks automatically (checkpoint + test reminder).
- **One agent at a time writes to this.**
- **Sub-agents do NOT write to SESSION.md** — they write to their own file + PROGRESS.md.

### PROGRESS.md — Cross-agent persistent ledger
Path: `.claude/state/PROGRESS.md`

- The **shared memory layer** used by ALL agents.
- Contains: module status table, test coverage, security audit log, research findings, **lessons learned**, and agent communication log.
- **Every agent reads this at session start.**
- **Every agent writes to this when completing work or recording a lesson.**

---

## 2. Per-Agent Session Files

Each specialized agent has its own session file:

```
.claude/state/agents/
  implementor.md
  test-agent.md
  researcher.md
  security-auditor.md
  database-agent.md
  architect.md
  devops-agent.md
```

### Session Restoration Protocol (every sub-agent must follow)

```
1. Read .claude/state/agents/<my-name>.md         ← restore my own state
2. Read .claude/state/PROGRESS.md                  ← shared cross-agent memory
3. Read CLAUDE.md                                  ← code standards
4. Update .claude/state/agents/<my-name>.md        ← set Active Task
5. Begin work
```

### Session Completion Protocol (every sub-agent must follow)

```
1. Update PROGRESS.md → module row status (⏳ → 🔄 → ✅)
2. Write to PROGRESS.md → Agent Communication Log (handoff message)
3. Write any lesson learned to PROGRESS.md → Lessons Learned
4. Update .claude/state/agents/<my-name>.md → Active Task = "None", Phase = "Idle"
```

---

## 3. The Main Session (SESSION.md) Structure

```markdown
# Current Session State

- **Active Goal**: [Brief description of the overall task]
- **Last Updated**: [Timestamp]
- **Status**: [In Progress / Blocked / Completed]

## Progress Log
- [x] Task A (Finished at 10:00)
- [x] Task B (Finished at 10:15)
- [/] Task C (Current focus - started at 10:20)
- [ ] Task D (Pending)

## Technical Context
- **Current Branch**: `main`
- **Current Task**: Modified `<file>` via Write at <time>
- **Key Decisions**: [Architecture decisions made]

## Test Results
- ✅ Test run [2026-03-25 12:00]: `packages/core/src/net/PacketBuffer.test.ts` — PASSED

## Pending Questions for User
1. Should we support item duration in the initial MVP?
```

---

## 4. Checkpointing Rules

1. **Mandatory Checkpoint**: Update `SESSION.md` (or your own agent session file) after every significant change.
2. **Context Preservation**: Before a context limit, write a "Deep Checkpoint" with exact internal state (e.g., "I was halfway through refactoring `Mover.ts`; line 450 done, line 500 needs the `updatePos` call updated").
3. **Atomic Tasks**: Break large tasks into small, checkpointable units.

---

## 5. Self-Learning Protocol

### When to record a lesson
- After fixing a bug that caused a test to fail
- After discovering a non-obvious edge case in the packet protocol
- After resolving a TypeScript error that revealed a design flaw

### Where to record it
| Where | When |
|-------|------|
| `PROGRESS.md` → **Lessons Learned** | Always — for agent-to-agent communication |
| `MEMORY.md` → `## Lessons Learned` | When the lesson applies broadly across sessions |

### The hook does it automatically
The `post-tool-auto-test.mjs` hook auto-detects when a test transitions FAIL → PASS and writes a brief entry to both `MEMORY.md` and `PROGRESS.md`. Agents should add the **root cause explanation** manually.

### Example lesson entry (PROGRESS.md)
```markdown
## Lessons Learned
| Date | Agent | File | Lesson |
|------|-------|------|--------|
| 2026-03-25 | implementor | PacketBuffer.ts | drain() panics on chunk < 4 bytes — guard with length check before readUInt32LE |
```

---

## 6. Sub-Agent Handoff Protocol

When the parent session spawns a sub-agent via the `Agent` tool:

1. Include the current `SESSION.md` state summary in the agent prompt.
2. Tell the agent which `PROGRESS.md` section to read for context.
3. The sub-agent works autonomously and updates `PROGRESS.md` + its own session file.
4. Sub-agents report back to the parent with a one-line summary + PROGRESS.md reference.
5. The parent session updates `SESSION.md` Progress Log with the sub-agent's result.

### Example handoff prompt to sub-agent
```
Context: See SESSION.md (Active Goal: implement auth system).
Read PROGRESS.md → Research Findings for SNSP_LOGIN_CERTIFY.
Your task: implement packages/login-server/src/handlers/auth.handler.ts.
Update PROGRESS.md on completion. Update .claude/state/agents/implementor.md.
```

---

## 8. Agent Roles — One Agent, One Responsibility

| Agent | Sole Responsibility |
| --- | --- |
| `architect` | Design plans only — no code |
| `implementor` | Write code from approved plans — no design |
| `researcher` | Find facts from C++ source or hex dumps — no code |
| `security-auditor` | Find vulnerabilities — no fixes |
| `database-agent` | Migrations + repositories only |
| `test-agent` | Test files only |
| `devops-agent` | Infrastructure and config only |

Never mix concerns. For fanning work out to several of these at once, use the
`flyff-parallel-spawning` skill (limits: maxDepth 3, maxConcurrent 5).

---

## 9. The 5-Phase Loop and Its Gates

```
1. RESEARCH → 2. IMPLEMENT → 2.5 VALIDATE → 3. TEST → 4. FIX
researcher     implementor    sec-auditor    test-agent  implementor
```

No phase may be skipped. Gates:

| Phase | Gate before moving on |
| --- | --- |
| 1 Research | C++ findings logged to `PROGRESS.md` → Research Findings (or marked "best effort") |
| 2 Implement | `tsc --noEmit` clean; `.test.ts` stub exists in `test/` |
| 2.5 Validate | Zero 🔴 Critical findings from `security-auditor` plan review; 🟠 High acknowledged |
| 3 Test | `tsx --test` green, 0 failures |
| 4 Fix | Loop back to 3 until green — never `.skip()`, never weaken an assertion |

**Code quality gate** (implementor, before handing off): no `any`, no
`console.log`, no skipped validation, companion test exists and passes.

**Security gate**: any new Handler or Service touching player state is reviewed
against `.claude/rules/03-security.md`. A 🔴 Critical finding sends the task
back to `in_progress`.

---

## 10. Anti-Patterns

- **Never fabricate** a packet structure or formula. Research it (`flyff-research`) or ask.
- **Never skip** the `.test.ts` file — a stub is required before marking in-progress.
- **Never overwrite** `PROGRESS.md` rows without reading them first.
- **Never** leave a lesson only in `SESSION.md` — it must reach `PROGRESS.md` and/or `MEMORY.md` to survive.
- **Never** mark anything complete — see the Task Completion override in `CLAUDE.md`. Only the user declares work done or fixed.

---

## 11. PROGRESS.md Section Formats

```markdown
## Research Findings
| Topic | Found By | Summary | Source |
|-------|----------|---------|--------|
| SNSP_LOGIN_CERTIFY | researcher | 4 fields: key, username, md5pw, version | game/source/.../Login.cpp:42 |

## Agent Communication Log
| Date | From | To | Message |
|------|------|----|---------|
| 2026-03-24 | test-agent | implementor | drain() fails on chunk < 4 bytes — add length guard |

## Security Audit Log
| File | Audited By | Result | Date |
|------|-----------|--------|------|
| auth.handler.ts | security-auditor | 🟡 Rate limiter missing on CERTIFY | 2026-03-24 |
```

### Per-agent session file format (`.claude/state/agents/<name>.md`)

```markdown
# <Agent Name> Session
- **Agent**: implementor
- **Active Task**: Implement packages/core/src/net/PacketReader.ts
- **Phase**: 2 — Implement
- **Current Depth**: 2
- **Active Spawns**: database-agent (task abc123) — COMPLETED

## Current Work
- [x] Designed interface
- [/] Writing readDword() — line 45 done, readString() pending

## Next Step
Complete readString(), then run tests.
```

---

## 12. The Full Agentic Loop


```
researcher  →  architect  →  security-auditor  →  implementor  →  test-agent
   (facts)      (design)        (plan review)        (code)          (tests)
                                                                        │
                                                              FAIL → implementor (fix)
                                                                        │
                                                              PASS → PROGRESS.md ✅
                                                                        │
                                                            MEMORY.md lesson recorded
```
