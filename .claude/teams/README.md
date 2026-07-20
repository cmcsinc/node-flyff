# Flyff Agent Teams

**Teams are recipes, not a separate runtime.** Each preset below names the agents to spawn, the order, and where work can run in parallel. The main Claude session reads a preset and fans out via the `Agent` tool (or the `Workflow` tool when a user explicitly opts into multi-agent orchestration).

## Available Agents (project-scoped, `.claude/agents/`)

| Agent | Role | Model |
|---|---|---|
| `architect` | Designs systems, writes plans only | opus |
| `researcher` | Finds facts in C++ source / hex dumps / resource files | sonnet |
| `implementor` | Writes TypeScript from approved plans | sonnet |
| `security-auditor` | Plan + code security review | sonnet |
| `code-reviewer` | Standards / layer / perf review, runs tsc+eslint | sonnet |
| `database-agent` | Knex migrations, repos, WAL | sonnet |
| `test-agent` | Node:test coverage | haiku |
| `devops-agent` | Infra, Docker, CI, tsconfig | haiku |
| `build-error-resolver` | Minimal-diff TS/eslint fixer | sonnet |

## Presets

| Preset | When |
|---|---|
| [feature.md](./feature.md) | New opcode, new system, new handler+service+repo |
| [bugfix.md](./bugfix.md) | Reported bug or failing test, targeted fix |
| [research.md](./research.md) | Unknown protocol — pure recon, no code yet |
| [refactor.md](./refactor.md) | Cleanup dead code, consolidate, no behavior change |

## Parallelism Rules (project-wide)

- **Default: parallel where independent, serial where files touch.**
- Independent fan-outs (research, security review, migration drafting) run concurrently in one `Agent` message.
- Anything editing the same file is serialized through the parent — never let two agents `Edit` the same path in the same round.
- Limits from `08-agent-workflow.md`: maxDepth 3, maxConcurrent 5 per parent.
- For `worktree` isolation (true parallel edits), pass `isolation: "worktree"` to the Agent tool — only when agents mutate files concurrently.

## State Files (every agent respects)

- `.claude/state/SESSION.md` — current session goal (one writer: the main session).
- `.claude/state/PROGRESS.md` — cross-agent ledger. Read at start, write on completion.
- `.claude/state/agents/<name>.md` — per-agent scratch. Sub-agents write their own, never the parent's SESSION.md.

## Invoking a Team

From the main session:
1. Read the preset file.
2. Spawn the listed agents in parallel (one `Agent` tool message, multiple tool calls).
3. Aggregate results — merge via the Agent return values, then update `PROGRESS.md`.
4. For the next serial phase, spawn the next batch only after the previous batch returns.

For deterministic orchestration across many items (e.g. audit every handler), the user can opt into the `Workflow` tool — never assume it; ask first.
