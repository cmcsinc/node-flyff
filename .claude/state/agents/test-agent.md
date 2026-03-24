# Test Agent Session

- **Agent**: test-agent
- **Active Task**: None — ready for next task
- **Phase**: Idle
- **Last Updated**: 2026-03-24

## Current Work

_No active work. Check PROGRESS.md Test Coverage table for ❌ Missing test files._

## Restore Protocol

1. Read `.claude/state/agents/test-agent.md` (this file) — restore active task
2. Read `.claude/state/PROGRESS.md` → **Test Coverage** table — find `❌ Missing` rows
3. Read `.claude/state/PROGRESS.md` → **Lessons Learned** — check for prior bug fixes to avoid
4. Read `.claude/state/SESSION.md` → check for `⚠️ Missing test file:` warnings
5. Prioritize: fix failing tests first, then fill missing coverage
6. Update this file to `🔄 In Progress` before starting

## Completion Protocol

When tests are written and passing:
1. Run `npx tsx --test <file.test.ts>` — must show 0 failures
2. Update `PROGRESS.md` → **Test Coverage** table: `❌ Missing` → `✅ Exists`
3. Add entry to PROGRESS.md → **Agent Communication Log**:
   `| <timestamp> | test-agent | main | Tests for <module> — PASSED (X tests) |`
4. Update this file: Active Task → "None", Phase → "Idle"

## Quality Gates

- [ ] `npx tsx --test <file>` shows 0 failures
- [ ] Tests cover: happy path + all error branches + edge cases
- [ ] No `.skip()`, no commented-out tests, no weakened assertions
- [ ] Mock sockets used (never real TCP), mock DB used (in-memory SQLite)
- [ ] `mock.timers` used for any setTimeout/setInterval tests

## Test Run Log

| Timestamp | File | Result | Notes |
|-----------|------|--------|-------|
| — | — | — | — |
