# Team: Bugfix

Reported bug, crash, desync, or failing test. Targeted fix — do not redesign.

## Roster

- `researcher` — root-cause in C++ source or packet format (only if protocol unclear)
- `implementor` — minimal fix
- `test-agent` — regression test that fails before fix, passes after
- `code-reviewer` — quick standards check (optional, parallel with test)
- `security-auditor` — only if fix touches items/gold/exp/auth/IPC

## Flow

```
Phase 1 (parallel, scoped):
  researcher ──► root cause + correct behavior (skip if already known)
  test-agent ──► write RED test reproducing the bug

Phase 2 (serial):
  implementor ──► smallest fix that turns RED -> GREEN
    (if fix mutates items/gold/exp, WAL journal BEFORE response)

Phase 3 (parallel):
  test-agent ──► confirm GREEN, add edge-case variants
  code-reviewer ──► standards/lint on the diff
  security-auditor ──► ONLY if critical-state path touched

Phase 4 (serial):
  build-error-resolver ──► if tsc/eslint red (else skip)
```

## Parallelism Notes

- Phase 1: researcher + test-agent are independent -> parallel. Both read, no file conflict.
- Phase 3: three readers (test-agent writes test file, the other two read) -> safe parallel.
- Skip security-auditor entirely for non-state bugs (UI, chat, movement validation) — do not spawn it just to be safe; that wastes a sonnet slot.

## Principles

- **Smallest diff wins.** No refactors. No "while I'm here" cleanups — file a follow-up instead.
- **Never weaken a test to pass.** Never `.skip()` a failing test. Fix the code.
- **Reproduce first.** If you cannot write a failing test, you do not understand the bug — back to researcher.

## Quality Gate

- Failing test now passes
- No new test failures introduced (run the full package suite)
- Diff scoped to the bug (no drive-by edits)
- Lesson recorded in `PROGRESS.md` -> **Lessons Learned** with root cause
