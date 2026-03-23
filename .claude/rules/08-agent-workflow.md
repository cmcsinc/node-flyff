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

When an agent needs information only the `researcher` has, it must request research via the parent session — sub-agents do not spawn other sub-agents.

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
