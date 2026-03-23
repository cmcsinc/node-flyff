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

## 1. The SESSION.md File

The source of truth for the current agent session is `.claude/state/SESSION.md`.

### Structure of SESSION.md
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
- **Current Branch**: `feature/item-system`
- **Last Successful Tool**: `Write(packages/core/src/items.ts)`
- **Discovered Blockers**: None
- **Next Critical Step**: Define the Zod schema for items.

## Pending Questions for User
1. Should we support item duration in the initial MVP?
```

## 2. Checkpointing Rules

1.  **Mandatory Checkpoint**: You **MUST** update `SESSION.md` (or the `TodoWrite` list) after every significant change (e.g., finishing a file edit, running a successful test suite, or completing a sub-task).
2.  **Context Preservation**: If you are about to hit a context limit or expect a disconnect, write a "Deep Checkpoint" to `SESSION.md` detailing the exact internal state (e.g., "I was halfway through refactoring `Mover.ts`; line 450 is done, but line 500 needs the `updatePos` call updated").
3.  **Atomic Tasks**: Break large tasks into small, checkpointable units.

## 3. Session Restoration Protocol

When you start a new session or "resume" an existing one:

1.  **Read the State**: Immediately `Read` `.claude/state/SESSION.md` and `CLAUDE.md`.
2.  **Verify the Environment**: Run `git status` and check for any partially completed files mentioned in the session log.
3.  **Sync the Todo List**: Use `TodoWrite` to restore the active task list based on the `SESSION.md` log.
4.  **Acknowledge the User**: Briefly summarize where you are: "I've restored the session. I'm currently at Task C: Implementing the Item Zod schema."

## 4. Sub-Agent Handoffs

When spawning a sub-agent via the `Agent` tool:
- Provide a summary of the current `SESSION.md` state in the prompt.
- Instruct the sub-agent to return its results in a format that can be directly appended to the `Progress Log`.
- Sub-agents do not write to `SESSION.md` directly; they report back to the parent who updates the main log.
