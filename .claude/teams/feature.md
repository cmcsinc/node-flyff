# Team: Feature

New opcode, new system, or new handler+service+repo chain. Full pipeline: research -> plan -> validate -> implement -> review -> test.

## Roster

- `researcher` — find C++ source / packet structure / formula
- `architect` — design, layer breakdown, step-by-step plan
- `security-auditor` — plan review (Mode A) BEFORE code
- `database-agent` — migration + repository (if persistence needed)
- `implementor` — write handler/service/manager/system
- `code-reviewer` — standards + layer + perf review, tsc+eslint
- `test-agent` — companion `.test.ts`, run green

## Flow

```
Phase 1 (parallel):
  researcher ──► PROGRESS.md (Research Findings)
  database-agent ──► migration draft (if needed)

Phase 2 (serial, after research lands):
  architect ──► plan in PROGRESS.md

Phase 3 (serial gate):
  security-auditor (Mode A: plan review)
    ├── APPROVED ──► Phase 4
    └── BLOCKED ──► back to architect

Phase 4 (parallel):
  implementor (handler/service/manager)
  database-agent (finalize repo)

Phase 5 (parallel, after implementor done):
  security-auditor (Mode B: code review)
  code-reviewer (standards/perf/tsc/eslint)

Phase 6 (serial, after Phase 5 clean):
  test-agent ──► companion test, run green
    ├── PASS ──► PROGRESS.md row = ✅ Done
    └── FAIL ──► back to implementor (FIX), loop to test-agent
```

## Parallelism Notes

- Phases 1, 4, 5 fan out. Send each batch as one `Agent` message with multiple tool calls.
- Phase 4 implementor + database-agent touch different files -> safe parallel. If both edit `compose.ts`, serialize via parent (implementor last).
- Phases 2, 3, 6 are serial gates — do not skip.

## Handoff Contract

Each agent writes a one-line entry to `PROGRESS.md` -> **Agent Communication Log** on completion, naming the next agent and the artifact location. The parent (main session) reads these to decide when to fire the next phase.

## Quality Gate (before marking ✅ Done)

- `tsc --noEmit` clean
- `pnpm -r lint` clean
- Companion `.test.ts` exists in `test/`, passes
- No 🔴 Critical from security-auditor or code-reviewer
- `PROGRESS.md` row updated, lesson recorded if FAIL->PASS occurred
