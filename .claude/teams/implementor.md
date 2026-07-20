# Team: Implementor

Plan already exists (from [research.md](./research.md) + architect). Pure execution: split the plan by layer, fan out implementor workers in parallel, integrate, test. Use this preset when the design is frozen and the goal is to land code fast without re-deriving it.

## When to use

- Architect's plan is in `PROGRESS.md` and approved by `security-auditor` (Mode A green).
- Work splits cleanly along layer boundaries (handler / service / repo / manager / system / test).
- You want wall-clock speed: N layer-owners in parallel beats one implementor going depth-first.

**Do not use** if the plan is incomplete — go back to [feature.md](./feature.md) Phase 2. This preset skips research and design.

## Roster

- `implementor` (splitter, optional) — parent decomposes the plan into per-layer task packets
- `implementor` x N — one worker per layer, each owns a disjoint file set
- `database-agent` — migration + repository (runs parallel to service implementor)
- `test-agent` — companion `.test.ts` per source file, parallel with implementation
- `code-reviewer` — standards + layer + tsc/eslint on the integrated diff
- `build-error-resolver` — only if integration introduces type/lint errors

## Flow

```
Phase 0 (serial, parent):
  read architect's plan from PROGRESS.md
  decompose into layer-tasks, each with: files owned, deps, acceptance check
  confirm NO two workers own the same file (rename compose.ts owner to "integrator")

Phase 1 (parallel fan-out — independent files):
  database-agent  ──► migration + repo (own files)
  implementor-A   ──► service + WAL journal calls (own files)
  implementor-B   ──► manager / system (own files)
  test-agent      ──► test stubs + happy-path skeletons (test/ dir only)
    (test-agent writes RED tests from the plan's acceptance criteria)

Phase 2 (serial, single integrator — touches compose.ts + handler):
  implementor (integrator) ──► handler packet parse + wire DI in compose.ts
    runs AFTER Phase 1 so service/repo exports already exist
    (only ONE agent ever edits compose.ts in this team)

Phase 3 (parallel, after integration compiles):
  test-agent      ──► fill edge-case tests, run GREEN
  code-reviewer   ──► standards/layer/perf + tsc --noEmit + eslint
  security-auditor (Mode B) ──► ONLY if handler touches items/gold/exp/auth/IPC

Phase 4 (serial gate):
  build-error-resolver ──► if tsc/eslint red (else skip)
  loop test-agent <-> implementor until GREEN
```

## File Ownership (critical)

Parallel implementors are safe ONLY if file sets are disjoint. Typical split:

| Owner | Files |
|---|---|
| `database-agent` | `migrations/00X_*.ts`, `repositories/<x>.repo.ts` |
| `implementor` (service) | `services/<x>.service.ts` |
| `implementor` (manager/system) | `managers/*.ts`, `systems/*.ts`, `entities/*.ts` |
| `implementor` (integrator) | `handlers/<x>.handler.ts`, `compose.ts`, `index.ts` |
| `test-agent` | `test/**/*.test.ts` only |

If two workers must edit the same file (rare), serialize them via the parent — never let two agents `Edit` one path in the same round.

## Parallelism Notes

- Phase 1 is the speed win: 3-4 implementors + db-agent + test-agent all read/write disjoint files.
- Respect `maxConcurrent: 5` per parent (`08-agent-workflow.md`). If the split exceeds 5 workers, queue Phase 1 in two batches.
- For true isolation (no shared working tree), pass `isolation: "worktree"` per implementor — only worth it if workers might graze shared files. Default is fine when ownership table above is clean.
- Phase 2 is deliberately serial — `compose.ts` and the handler are the integration seam; one writer.

## Task Packet Contract (parent -> each worker)

Every spawned implementor receives:

```
Layer:      service  (or repo / manager / system / handler)
Plan ref:   PROGRESS.md -> Research Findings + architect plan, section X
Owns:       packages/<pkg>/src/services/<x>.service.ts  (list every file)
Deps on:    <repo>.findById (from database-agent), <manager> state
Acceptance: <one-line check>  — e.g. "joinSnapshot() returns Buffer with opcode 0xff00 first"
Standards:  strict mode, ESM, .js imports, <=50-line fns, <=300-line files, pino logger
Do NOT:     edit files outside your Owns list. Hand compose.ts changes to integrator.
```

Workers that hit an ambiguity STOP and post to `PROGRESS.md` -> **Agent Communication Log** rather than guessing.

## Handoff Contract

Each worker writes one line to `PROGRESS.md` -> **Agent Communication Log** on finish: files changed, exports added, anything the integrator needs to know. The integrator reads all of Phase 1's log entries before starting Phase 2.

## Quality Gate (before marking ✅ Done)

- `tsc --noEmit` clean across the package
- `pnpm --filter @flyff/<pkg> lint` clean
- Every new source file has a companion `.test.ts` in `test/`, passing
- No 🔴 Critical from `code-reviewer` or `security-auditor`
- WAL journal calls present for any items/gold/exp mutation (service layer)
- `PROGRESS.md` row updated; if a FAIL->PASS occurred, root cause recorded in **Lessons Learned**

## Principles

- **Plan is frozen.** Workers do not redesign. If the plan is wrong, stop and escalate to the parent — do not silently pick a different approach per-worker.
- **Smallest parallel unit is a file.** Two workers, two disjoint file sets, or one worker serialized.
- **Integrator goes last.** `compose.ts` + handler wire everything; they need the exports from Phase 1.
- **Never weaken a test to pass.** RED -> GREEN by fixing code, not assertions.
