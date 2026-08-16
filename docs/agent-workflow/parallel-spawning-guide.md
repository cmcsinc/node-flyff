# Parallel Sub-Agent Spawning Guide

**Version:** 1.0
**Added:** 2026-03-24
**Status:** ✅ Active

## Overview

The Flyff emulator agentic workflow now supports **parallel sub-agent spawning** — a capability that allows any agent to spawn multiple helper sub-agents simultaneously to complete independent subtasks in parallel. This dramatically speeds up development by enabling concurrent work on different aspects of a feature.

---

## Quick Start

### When to Use Parallel Spawning

✅ **Use when:**
- An agent has **multiple independent subtasks** that don't depend on each other
- Tasks can run **simultaneously** without conflicts
- You want to **speed up** development by parallelizing work

❌ **Don't use when:**
- Tasks have **sequential dependencies** (output of one is input to another)
- Tasks are **too simple** (< 30 seconds — overhead not worth it)
- Tasks share **mutable state** (risk of conflicts)

---

## Basic Example

### Scenario: Implementor Building a New Handler

```ts
// Old way (sequential): ~15 minutes total
database-agent: migration     (5 min)
→ security-auditor: review   (5 min)
→ test-agent: tests          (5 min)

// New way (parallel): ~5 minutes total
implementor spawns all 3 agents simultaneously
→ Wait for all 3 to complete
→ Merge results
```

---

## How It Works

### Step 1: Spawn Parallel Agents

```ts
// Send all spawn requests in a SINGLE response for true parallelism
Agent("database-agent: Create trades table migration", {
  subagent_type: "database-agent",
  prompt: "Create migration 005_trades.ts with fields: id, from_char_id, to_char_id, items_json, gold, status, created_at",
  run_in_background: true
});

Agent("security-auditor: Review trade handler", {
  subagent_type: "security-auditor",
  prompt: "Review packages/world-server/src/handlers/trade.handler.ts for: item dupe vulnerabilities, gold overflow, validation",
  run_in_background: true
});

Agent("test-agent: Write trade handler tests", {
  subagent_type: "test-agent",
  prompt: "Write test/handlers/trade.handler.test.ts with coverage for: happy path, invalid items, insufficient gold",
  run_in_background: true
});
```

### Step 2: Wait for Completion

```ts
// Store task IDs
const tasks = await Promise.all([
  Agent(...),
  Agent(...),
  Agent(...)
]);

// Wait for all to complete
const results = await Promise.all([
  TaskOutput(tasks[0].task_id, { block: true }),
  TaskOutput(tasks[1].task_id, { block: true }),
  TaskOutput(tasks[2].task_id, { block: true })
]);
```

### Step 3: Aggregate Results

```ts
// Merge all results
if (results.every(r => r.status === 'completed')) {
  updateProgress({
    migration: results[0].output,
    security: results[1].output,
    tests: results[2].output
  });
}
```

---

## Safety Limits

To prevent runaway agent chains, the following limits are enforced:

| Limit | Value | Purpose |
|-------|-------|---------|
| **maxDepth** | 3 | Maximum nesting depth (parent → child → grandchild → great-grandchild) |
| **maxConcurrent** | 5 | Maximum sub-agents running simultaneously per parent |

### Depth Limit Example

```
Level 0: Main Claude session
  └─ Level 1: implementor
       └─ Level 2: database-agent
            └─ Level 3: test-agent
                 └─ BLOCKED ❌ (exceeds maxDepth=3)
```

### Concurrency Limit Example

```
Parent spawns 7 sub-agents:
  ├─ Agent 1 (RUNNING)
  ├─ Agent 2 (RUNNING)
  ├─ Agent 3 (RUNNING)
  ├─ Agent 4 (RUNNING)
  ├─ Agent 5 (RUNNING)
  ├─ Agent 6 (QUEUED) ← waiting for slot
  └─ Agent 7 (QUEUED) ← waiting for slot
```

---

## Per-Agent Patterns

### Implementor Agent

**Spawn pattern for new feature:**
```
implementor (parent)
  ├─ database-agent (migration + repo)
  ├─ security-auditor (security review)
  └─ test-agent (tests)
→ Merge → Update PROGRESS.md
```

**When to use:**
- Building a feature requiring: DB + security + tests
- Multiple independent modules in same feature
- Code review + performance analysis

### Security-Auditor Agent

**Spawn pattern for multi-file audit:**
```
security-auditor (parent)
  ├─ security-auditor (auth.handler.ts)
  ├─ security-auditor (serverList.handler.ts)
  └─ security-auditor (token.service.ts)
→ Aggregate findings → Update Security Audit Log
```

**When to use:**
- Reviewing multiple handlers in same server
- Plan review for multiple features
- Full security audit of a server

### Test-Agent

**Spawn pattern for multi-module testing:**
```
test-agent (parent)
  ├─ test-agent (auth.handler.test.ts)
  ├─ test-agent (token.service.test.ts)
  └─ test-agent (account.repo.test.ts)
→ Aggregate results → Update Test Coverage table
```

**When to use:**
- Writing tests for multiple modules
- Running test suites for multiple packages
- Test-fix-validate loop

### Database-Agent

**Spawn pattern for multi-table schema:**
```
database-agent (parent)
  ├─ database-agent (accounts migration + repo)
  ├─ database-agent (characters migration + repo)
  └─ database-agent (inventory migration + repo)
→ Aggregate results → Update @flyff/database section
```

**When to use:**
- Creating migrations for multiple tables
- Building multiple repositories
- Migration validation + query optimization

### Researcher Agent

**Spawn pattern for multi-file analysis:**
```
researcher (parent)
  ├─ researcher (analyze Login.cpp)
  ├─ researcher (analyze Character.cpp)
  └─ researcher (analyze Combat.cpp)
→ Aggregate findings → Update Research Findings
```

**When to use:**
- Analyzing multiple C++ source files
- Reverse-engineering multiple packet structures
- Finding multiple game mechanics

---

## Communication Rules

### No Direct Agent-to-Agent Communication

**Never** have sub-agents communicate directly. All coordination flows through the parent agent.

### Shared State via PROGRESS.md

All spawned agents read/write to `.claude/state/PROGRESS.md` — the shared coordination layer.

### No Concurrent File Edits

If multiple agents might edit the same file, serialize through the parent:
1. Parent spawns Agent A → A finishes
2. Parent spawns Agent B → B uses A's output
3. Parent merges both results

---

## Tracking Spawns

When an agent spawns sub-agents, it must track in its session file:

```markdown
# <Agent Name> Session

- **Current Depth**: 2
- **Active Spawns**:
  - database-agent (task: abc123) — COMPLETED
  - security-auditor (task: def456) — COMPLETED
  - test-agent (task: ghi789) — IN_PROGRESS
```

---

## Result Reporting

### Return via Agent Tool

Sub-agents return structured results via the Agent tool. Parent receives these in `TaskOutput`.

### Parent Updates PROGRESS.md

After all sub-agents complete, the parent:
1. Aggregates all results
2. Updates `PROGRESS.md` with merged outcome
3. Adds entry to **Agent Communication Log**

---

## Error Handling

### If One Sub-Agent Fails

1. Log the failure in the parent's session file
2. Decide whether to continue (if independent) or abort (if dependency)
3. Add entry to PROGRESS.md → **Known Blockers** if critical

### Timeout Handling

Default timeout is 120 seconds per sub-agent:
1. Mark as failed in parent's session
2. Decide whether to re-spawn or continue without it
3. Log the timeout for analysis

---

## Files Reference

### Core Documentation
- skill `flyff-parallel-spawning` → Full parallel spawning protocol
- skill `flyff-agent-workflow` → the 5-phase loop and its gates
- `.claude/skills/flyff-parallel-spawning/SKILL.md` → Comprehensive skill guide

### Agent Session Files
- `.claude/state/agents/implementor.md` → Implementor's parallel patterns
- `.claude/state/agents/security-auditor.md` → Security auditor's parallel patterns
- `.claude/state/agents/test-agent.md` → Test agent's parallel patterns
- `.claude/state/agents/database-agent.md` → Database agent's parallel patterns

### Shared State
- `.claude/state/PROGRESS.md` → Cross-agent coordination ledger
- `.claude/state/SESSION.md` → Current session state

---

## Trigger Keywords

The parallel spawning skill is triggered by:
- "parallel", "concurrent", "simultaneous", "at the same time"
- "multiple agents", "spawn helpers", "delegate tasks"
- "independent subtasks", "can run in parallel"
- "speed up", "faster", "optimize workflow"

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-24 | Initial implementation — task-based parallel spawning with maxDepth=3, maxConcurrent=5 |

---

## Support

For questions or issues with parallel spawning:
1. Check `.claude/skills/flyff-parallel-spawning/SKILL.md` for detailed patterns
2. Review skill `flyff-parallel-spawning` for protocol details
3. Check `.claude/state/PROGRESS.md` → Agent Communication Log for examples from other agents
