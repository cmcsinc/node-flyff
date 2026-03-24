---
name: flyff-agent-workflow
description: >
  Standard operating procedures for Flyff emulator agents: session restoration,
  checkpointing, task tracking, and autonomous handoffs. Use this skill to
  ensure work continues seamlessly after a session restart or when handing
  off tasks to a sub-agent. Trigger on: "restore session", "checkpoint",
  "resume", "handoff", "workflow", "agent state", "save progress".
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

## 7. The Full Agentic Loop

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
