# Team: Refactor

Cleanup with no behavior change: dedup, extract helper, remove dead code, tighten types. Safety rails are strict — existing tests must stay green.

## Roster

- `code-reviewer` — identifies refactor targets (Mode B on the target area)
- `implementor` — applies the refactor in small steps
- `test-agent` — locks in current behavior with characterization tests BEFORE the refactor
- `build-error-resolver` — only if refactor introduces type errors

## Flow

```
Phase 1 (serial):
  code-reviewer ──► list of refactor targets ranked by impact

Phase 2 (serial, BEFORE any refactor):
  test-agent ──► characterization tests for current behavior
  (if coverage is thin, STOP and add tests first — no refactor without a safety net)

Phase 3 (serial, stepwise):
  implementor ──► one refactor at a time
    after each step: run tests, must stay GREEN
    commit/checkpoint after each green step

Phase 4 (parallel):
  code-reviewer ──► verify standards improved, no regressions
  test-agent ──► full suite, confirm GREEN
```

## Parallelism Notes

- Almost entirely serial — refactors touch overlapping files.
- Phase 4 only: code-reviewer + test-agent run in parallel (different actions on the finished diff).

## Principles

- **No behavior change.** If a test needs to change, it is not a refactor — it is a fix. Switch to [bugfix.md](./bugfix.md).
- **Stepwise + checkpoint.** One extraction / rename / deletion per step, tests green between each. If step N breaks, revert just that step, not the whole branch.
- **Delete over add.** Prefer removing dead code to introducing new abstractions. YAGNI: no speculative generality, no interface-with-one-impl.
- **Boring over clever.** Readable code wins. No clever metaprogramming where a plain function does the job.

## Quality Gate

- All previously-green tests still green
- `tsc --noEmit` clean, `pnpm -r lint` clean
- No new `any`, no new `@ts-ignore`
- File/function lengths now within limits (<=300 / <=50)
- Diff is purely structural — no logic changes mixed in
