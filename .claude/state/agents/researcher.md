# Researcher Agent Session

- **Agent**: researcher
- **Active Task**: None — ready for research tasks
- **Phase**: Idle
- **Last Updated**: 2026-03-24

## Current Work

_No active research. Check PROGRESS.md for modules where implementor is blocked on protocol details._

## Restore Protocol

1. Read `.claude/state/PROGRESS.md` → **Known Blockers** — find research-blocked items
2. Read `.claude/state/PROGRESS.md` → **Research Findings** — avoid duplicating existing research
3. Check `references/` directory for C++ source files available locally
4. Update this file to `🔄 In Progress` before starting

## Completion Protocol

When research is complete for a topic:
1. Add findings to `PROGRESS.md` → **Research Findings** table
2. Add entry to PROGRESS.md → **Agent Communication Log**:
   `| <timestamp> | researcher | implementor | Research done: <topic> — see Research Findings |`
3. If a blocker is resolved, update `PROGRESS.md` → **Known Blockers** table
4. Update this file: Active Task → "None", Phase → "Idle"

## Quality Gates

- [ ] All opcodes verified against `references/` C++ source (not guessed)
- [ ] Packet structure documented in table format (field, type, notes)
- [ ] Formula includes the source file + line number reference
- [ ] If no source available: marked as "Best effort / spec-based" clearly

## Discovery Queue

| Priority | Topic | Status | Assigned To |
|----------|-------|--------|-------------|
| 1 | SNSP_LOGIN_CERTIFY packet structure | ⏳ Pending | — |
| 2 | SNSP_PLAYER_SNAPSHOOT (movement) | ⏳ Pending | — |
| 3 | Combat damage formula | ⏳ Pending | — |
| 4 | Exp formula per level | ⏳ Pending | — |
| 5 | Drop table format (propMover) | ⏳ Pending | — |
