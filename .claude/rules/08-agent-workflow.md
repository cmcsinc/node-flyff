# Agent Workflow Rules

Rules for how sub-agents operate, checkpoint, and hand off work.

## Session State is Mandatory

Every agent session **must** begin by reading `.claude/state/SESSION.md` to understand current progress. Every agent session **must** end by ensuring `SESSION.md` reflects what was accomplished.

```
Start of session:
  1. Read .claude/state/SESSION.md
  2. Read CLAUDE.md
  3. Sync TodoWrite list with the Progress Log

End of session (or after significant change):
  1. Update SESSION.md Progress Log
  2. Update "Current Task" in Technical Context
```

The `Stop` hook handles the final checkpoint automatically — but agents must also checkpoint manually after completing any subtask.

## One Agent, One Responsibility

Each sub-agent has a single clearly-defined role. Never mix concerns:

| Agent | Sole Responsibility |
| --- | --- |
| `architect` | Design plans only — no code |
| `implementor` | Write code from approved plans — no design |
| `researcher` | Find facts from C++ source or hex dumps — no code |
| `security-auditor` | Find vulnerabilities — no fixes |
| `database-agent` | Migrations + repositories only |
| `test-agent` | Test files only |
| `devops-agent` | Infrastructure and config only |

## Handoff Protocol

When the `architect` produces a plan, it must be structured as a numbered implementation checklist. The `implementor` works through that list item by item, checkpointing after each one.

## Parallel Sub-Agent Spawning

**All agents** can spawn helper sub-agents in parallel for independent subtasks. This enables faster task completion by delegating independent work to multiple specialized agents simultaneously.

### When to Use Parallel Spawning

✅ **Good use cases:**
- An `implementor` needs a database migration, security review, and tests — spawn `database-agent`, `security-auditor`, `test-agent` in parallel
- A `researcher` needs to analyze 5 different C++ source files — spawn multiple `researcher` sub-agents, one per file
- An `architect` needs to validate a plan across multiple domains — spawn `security-auditor`, `database-agent`, `performance` reviewers in parallel

❌ **Don't use for:**
- Sequential dependencies (use single agent chain instead)
- Simple tasks that take < 30 seconds (overhead not worth it)
- Tasks that share mutable state (risk of conflicts)

### Safety Limits

To prevent runaway agent chains, the following limits apply:

| Limit | Value | Description |
|-------|-------|-------------|
| **maxDepth** | 3 | Maximum nesting depth (parent → child → grandchild → great-grandchild) |
| **maxConcurrent** | 5 | Maximum sub-agents running simultaneously per parent |

Example of depth limit:
```
Level 0: Main Claude session
  └─ Level 1: implementor (spawned by Main)
       └─ Level 2: database-agent (spawned by implementor)
            └─ Level 3: test-agent (spawned by database-agent)
                 └─ BLOCKED ❌ (would exceed maxDepth=3)
```

Example of concurrency limit:
```
implementor spawns 7 sub-agents:
  ├─ database-agent (RUNNING)
  ├─ security-auditor (RUNNING)
  ├─ test-agent (RUNNING)
  ├─ researcher (RUNNING)
  ├─ performance-auditor (RUNNING)
  ├─ devops-agent (QUEUED) ← waiting
  └─ code-reviewer (QUEUED) ← waiting
```

### How to Spawn Parallel Sub-Agents

Use the `Agent` tool with a single message containing multiple tool calls:

```ts
// Spawn 3 agents in parallel
Agent("Create migration for inventory", { subagent_type: "database-agent" });
Agent("Review auth handler for security issues", { subagent_type: "security-auditor" });
Agent("Write tests for auth handler", { subagent_type: "test-agent" });
```

**Important:** Send all spawn requests in a single response for true parallelism.

### Result Aggregation Pattern

When spawning parallel sub-agents:

1. **Launch all agents in parallel** — single response with multiple `Agent` calls
2. **Wait for all to complete** — use `run_in_background: true` and track task IDs
3. **Aggregate results** — each agent returns structured output via the `Agent` tool result
4. **Merge and update** — parent processes all results, then updates `PROGRESS.md`

Example aggregation flow:
```ts
// Parent agent launches 3 parallel sub-agents
const dbTask = await Agent("Create migration", { subagent_type: "database-agent", run_in_background: true });
const secTask = await Agent("Security review", { subagent_type: "security-auditor", run_in_background: true });
const testTask = await Agent("Write tests", { subagent_type: "test-agent", run_in_background: true });

// Wait for all to complete
const dbResult = await TaskOutput(dbTask.task_id);
const secResult = await TaskOutput(secTask.task_id);
const testResult = await TaskOutput(testTask.task_id);

// Merge results
if (dbResult.status === 'completed' && secResult.status === 'completed' && testResult.status === 'completed') {
  // Update PROGRESS.md with combined results
  updateProgress({ migration: dbResult.output, security: secResult.output, tests: testResult.output });
}
```

### Communication Between Parallel Agents

- **No direct agent-to-agent communication** — all coordination flows through the parent
- **Shared state via PROGRESS.md** — spawned agents read/write to the shared ledger
- **No concurrent file edits** — if multiple agents touch the same file, serialize via parent

### Example: Implementor Spawning Parallel Helpers

Scenario: `implementor` is building a new `trade.handler.ts` and needs migration, security review, and tests.

```ts
// implementor's session file: .claude/state/agents/implementor.md
// Current Task: Implement trade.handler.ts

// Phase 1: Parallel delegation
Agent("database-agent: Create migration for trades table", {
  subagent_type: "database-agent",
  prompt: "Create migration 005_trades.ts with fields: id, from_char_id, to_char_id, items_json, gold, status, created_at",
  run_in_background: true
});

Agent("security-auditor: Review trade handler security", {
  subagent_type: "security-auditor",
  prompt: "Review packages/world-server/src/handlers/trade.handler.ts for: item dupe vulnerabilities, gold overflow, rate limiting, validation",
  run_in_background: true
});

Agent("test-agent: Write trade handler tests", {
  subagent_type: "test-agent",
  prompt: "Write test/handlers/trade.handler.test.ts with coverage for: happy path, invalid items, insufficient gold, concurrent trades",
  run_in_background: true
});

// Phase 2: Wait for all three, then merge results
```

### Tracking Nested Spawns

When an agent spawns sub-agents, it must track:

1. **Spawn record** — log in agent's session file which sub-agents were spawned
2. **Depth tracking** — include `currentDepth` in the agent context (starts at 0 for Main, increments each spawn)
3. **Task IDs** — store returned `task_id` for each spawned agent

Example session file update:
```markdown
# Implementor Session
- **Current Depth**: 2
- **Active Spawns**:
  - database-agent (task: abc123) — COMPLETED
  - security-auditor (task: def456) — COMPLETED
  - test-agent (task: ghi789) — IN_PROGRESS
```

## Code Quality Gate

The `implementor` must not mark a task complete until:
- [ ] All TypeScript errors are resolved (`tsc --noEmit` passes)
- [ ] A companion `.test.ts` file exists
- [ ] The test passes (`tsx --test`)
- [ ] No `any`, no `console.log`, no skipped validation

## Security Gate

Any new Handler or Service that touches player state must be reviewed against the security checklist in `03-security.md` before the task is marked complete. If the `security-auditor` agent finds a 🔴 Critical issue, the implementation task is reverted to `in_progress`.

## No Guessing

If an agent does not know how the original Flyff C++ server implements a feature, it must invoke the `researcher` agent or ask the user — never fabricate a protocol or formula.
