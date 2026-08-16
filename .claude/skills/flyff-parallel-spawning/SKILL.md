---
name: flyff-parallel-spawning
description: Parallel sub-agent spawning protocol for this repo — safety limits (maxDepth 3, maxConcurrent 5), per-agent fan-out patterns, result aggregation into PROGRESS.md, and failure/timeout handling. Trigger on: "parallel", "concurrent", "simultaneous", "multiple agents", "spawn helpers", "delegate tasks", "independent subtasks", "fan out", "can I spawn multiple agents".
---

# Parallel Sub-Agent Spawning

Expert knowledge of the parallel sub-agent spawning workflow for the Flyff TypeScript server emulator. Use this skill when an agent needs to delegate independent subtasks to multiple specialized agents simultaneously.

## When to Use This Skill

Trigger this skill when an agent (implementor, researcher, security-auditor, test-agent, database-agent, or any other agent) has **multiple independent subtasks** that can be completed in parallel by spawning helper sub-agents.

**Good use cases:**
- An `implementor` needs: database migration + security review + tests → spawn all 3 agents in parallel
- A `researcher` needs to analyze 5 different C++ source files → spawn multiple `researcher` sub-agents, one per file
- A `security-auditor` needs to review 10 handler files → spawn multiple `security-auditor` sub-agents
- A `test-agent` needs to write tests for 5 modules → spawn multiple `test-agent` sub-agents

**Don't use for:**
- Sequential dependencies (tasks that depend on each other's output)
- Simple tasks that take < 30 seconds (overhead not worth it)
- Tasks that share mutable state (risk of conflicts)

---

## The Parallel Spawning Model

### Architecture

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

### Key Principle

**Parallel sub-agents run independently, then the parent aggregates results via the Agent tool return value and updates shared state (PROGRESS.md).**

---

## Safety Limits

To prevent runaway agent chains, the following limits are enforced:

| Limit | Value | Description |
|-------|-------|-------------|
| **maxDepth** | 3 | Maximum nesting depth (parent → child → grandchild → great-grandchild) |
| **maxConcurrent** | 5 | Maximum sub-agents running simultaneously per parent |

### Depth Limit Example

```
Level 0: Main Claude session
  └─ Level 1: implementor (spawned by Main)
       └─ Level 2: database-agent (spawned by implementor)
            └─ Level 3: test-agent (spawned by database-agent)
                 └─ BLOCKED ❌ (would exceed maxDepth=3)
```

### Concurrency Limit Example

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

---

## How to Spawn Parallel Sub-Agents

### Step 1: Launch Agents in Parallel

Use the `Agent` tool with a single message containing multiple tool calls:

```ts
// Spawn 3 agents in parallel
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
```

**Important:** Send all spawn requests in a single response for true parallelism.

### Step 2: Wait for All to Complete

Store the returned task IDs and wait for completion:

```ts
const dbTask = await Agent("Create migration", { subagent_type: "database-agent", run_in_background: true });
const secTask = await Agent("Security review", { subagent_type: "security-auditor", run_in_background: true });
const testTask = await Agent("Write tests", { subagent_type: "test-agent", run_in_background: true });

// Wait for all three to complete
const dbResult = await TaskOutput(dbTask.task_id, { block: true, timeout: 120000 });
const secResult = await TaskOutput(secTask.task_id, { block: true, timeout: 120000 });
const testResult = await TaskOutput(testTask.task_id, { block: true, timeout: 120000 });
```

### Step 3: Aggregate Results

Process all agent outputs and merge into a coherent result:

```ts
if (dbResult.status === 'completed' && secResult.status === 'completed' && testResult.status === 'completed') {
  // Merge results
  const migrationPath = dbResult.output.match(/Created: (.+)/)?.[1];
  const securityIssues = JSON.parse(secResult.output).issues;
  const testCount = testResult.output.match(/(\d+) tests passing/)?.[1];

  // Update PROGRESS.md with combined results
  updateProgress({
    migration: migrationPath,
    security: securityIssues,
    tests: testCount
  });
}
```

---

## Per-Agent Parallel Spawning Patterns

### Implementor Agent

**When to spawn parallel helpers:**
- Building a new feature that requires: migration + security review + tests (spawn all 3 in parallel)
- Multiple independent modules in the same feature (spawn multiple `implementor` sub-agents)
- Code review + performance analysis (spawn `security-auditor` + researcher)

**Spawn pattern:**
```
implementor (parent)
  ├─ database-agent (migration)
  ├─ security-auditor (review)
  └─ test-agent (tests)
→ Wait for all 3 → Merge results → Update PROGRESS.md
```

### Security-Auditor Agent

**When to spawn parallel auditors:**
- Reviewing multiple handlers in the same server (spawn one `security-auditor` per file)
- Plan review for multiple features (spawn one reviewer per feature)
- Full security audit of a server (spawn reviewers for: handlers, services, repositories)

**Spawn pattern:**
```
security-auditor (parent)
  ├─ security-auditor (auth.handler.ts review)
  ├─ security-auditor (serverList.handler.ts review)
  └─ security-auditor (token.service.ts review)
→ Aggregate findings → Update PROGRESS.md Security Audit Log
```

### Test-Agent

**When to spawn parallel test runners:**
- Writing tests for multiple modules at once (spawn one `test-agent` per module)
- Running test suites for multiple packages in parallel (spawn one per package)
- Test-fix-validate loop (spawn one runner for tests, one for lint, one for type-check)

**Spawn pattern:**
```
test-agent (parent)
  ├─ test-agent (auth.handler.test.ts)
  ├─ test-agent (token.service.test.ts)
  └─ test-agent (account.repo.test.ts)
→ Aggregate results → Update PROGRESS.md Test Coverage table
```

### Database-Agent

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

### Researcher Agent

**When to spawn parallel researchers:**
- Analyzing multiple C++ source files (spawn one `researcher` per file)
- Reverse-engineering multiple packet structures from hex dumps (spawn one per packet)
- Finding multiple game mechanics (spawn one per mechanic: combat, stats, skills)

**Spawn pattern:**
```
researcher (parent)
  ├─ researcher (analyze Login.cpp for auth protocol)
  ├─ researcher (analyze Character.cpp for creation flow)
  └─ researcher (analyze Combat.cpp for damage formulas)
→ Aggregate findings → Update PROGRESS.md Research Findings
```

---

## Communication Between Parallel Agents

### No Direct Agent-to-Agent Communication

**Never** have sub-agents communicate directly. All coordination flows through the parent agent.

### Shared State via PROGRESS.md

All spawned agents can read and write to `PROGRESS.md`. This is the shared coordination layer.

### No Concurrent File Edits

If multiple agents might edit the same file, serialize through the parent:
1. Parent spawns Agent A → A finishes
2. Parent spawns Agent B → B uses A's output
3. Parent merges both results

---

## Tracking Nested Spawns

When an agent spawns sub-agents, it must track:

### 1. Spawn Record

Log in agent's session file which sub-agents were spawned:

```markdown
# Implementor Session

- **Current Depth**: 2
- **Active Spawns**:
  - database-agent (task: abc123) — COMPLETED
  - security-auditor (task: def456) — COMPLETED
  - test-agent (task: ghi789) — IN_PROGRESS
```

### 2. Depth Tracking

Include `currentDepth` in the agent context:
- Level 0: Main Claude session
- Level 1: Agents spawned by Main
- Level 2: Agents spawned by Level 1
- Level 3: Maximum depth (blocked beyond this)

### 3. Task IDs

Store returned `task_id` for each spawned agent to poll for completion.

---

## Result Reporting

### Return via Agent Tool

Sub-agents return structured results via the Agent tool. The parent receives these in the `TaskOutput` result.

### Parent Updates PROGRESS.md

After all sub-agents complete, the parent:
1. Aggregates all results
2. Updates `PROGRESS.md` with the merged outcome
3. Adds entry to **Agent Communication Log**

---

## Error Handling

### If One Sub-Agent Fails

If any spawned sub-agent fails:
1. Log the failure in the parent's session file
2. Decide whether to continue (if independent) or abort (if dependency)
3. Add entry to PROGRESS.md → **Known Blockers** if critical

### Timeout Handling

If a sub-agent exceeds the timeout (default 120s):
1. Mark as failed in parent's session
2. Decide whether to re-spawn or continue without it
3. Log the timeout for analysis

---

## Example: Complete Parallel Spawning Workflow

### Scenario: `implementor` building trade.handler.ts

```ts
// Step 1: implementor spawns 3 parallel sub-agents
const dbTask = await Agent("database-agent: Create trades table migration", {
  subagent_type: "database-agent",
  prompt: "Create migration 005_trades.ts with fields: id, from_char_id, to_char_id, items_json (JSON), gold (BIGINT), status (VARCHAR), created_at",
  run_in_background: true
});

const secTask = await Agent("security-auditor: Review trade handler for vulnerabilities", {
  subagent_type: "security-auditor",
  prompt: "Review packages/world-server/src/handlers/trade.handler.ts against the checklist in .claude/rules/03-security.md. Focus on: item dupe exploits, gold overflow, race conditions, validation of item counts",
  run_in_background: true
});

const testTask = await Agent("test-agent: Write comprehensive trade handler tests", {
  subagent_type: "test-agent",
  prompt: "Write test/handlers/trade.handler.test.ts covering: happy path trade, insufficient gold, invalid item slot, trading equipped items, concurrent trade attempts, item count validation",
  run_in_background: true
});

// Step 2: implementor waits for all to complete
const [dbResult, secResult, testResult] = await Promise.all([
  TaskOutput(dbTask.task_id, { block: true }),
  TaskOutput(secTask.task_id, { block: true }),
  TaskOutput(testTask.task_id, { block: true })
]);

// Step 3: implementor aggregates results
if (dbResult.status === 'completed' && secResult.status === 'completed' && testResult.status === 'completed') {
  // Extract key information from each result
  const migrationFile = dbResult.output.match(/Created: (.+\/005_trades\.ts)/)?.[1];
  const securityFindings = JSON.parse(secResult.output);
  const testCount = testResult.output.match(/(\d+) tests/)?.[1];

  // Update PROGRESS.md
  updateProgress({
    module: 'trade.handler.ts',
    status: '✅ Done',
    migration: migrationFile,
    security: securityFindings.critical === 0 ? 'PASS' : 'FAIL',
    tests: `${testCount} tests passing`
  });
}
```

---

## Rules File References

For full protocol details, see:
- Skill `flyff-agent-workflow` → "Agent Roles" + "The 5-Phase Loop and Its Gates"
- `.claude/state/agents/<agent-name>.md` → Each agent's parallel spawning capabilities

---

## Trigger Keywords

Use this skill when you see these keywords in an agent's task:
- "parallel", "concurrent", "simultaneous", "at the same time"
- "multiple agents", "spawn helpers", "delegate tasks"
- "independent subtasks", "can run in parallel"
- "speed up", "faster", "optimize workflow"
- Agent asking: "Can I spawn multiple agents at once?"
