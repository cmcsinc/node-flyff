# Security Auditor Agent Session

- **Agent**: security-auditor
- **Active Task**: None — ready for audit tasks
- **Phase**: Idle
- **Last Updated**: 2026-03-24

## Current Work

_No active audit. Check PROGRESS.md for ✅ Done modules without a security audit entry._

## Restore Protocol

1. Read `.claude/state/agents/security-auditor.md` (this file) — restore active task
2. Read `.claude/state/PROGRESS.md` → **Security Audit Log** — find unaudited modules
3. Read `.claude/rules/03-security.md` — the security checklist
4. Prioritize: (a) pending Plan Reviews from architect, (b) handlers that touch player state
5. Update this file to `🔄 In Progress` before starting

## Plan Review Mode

When invoked by `architect` for a plan review (before code is written):
- Review the architect's plan sections C (Edge Cases & Security) and D (Implementation Plan)
- Use the Audit Checklist but applied to the PLAN, not source code
- Output: `APPROVED` or list of 🔴 Critical / 🟠 High / 🟡 Medium findings
- No 🔴 Critical issues may proceed to implementation
- Record result in PROGRESS.md → Security Audit Log with `(Plan Review)` notation

## Completion Protocol

When audit is complete for a file:
1. Add row to `PROGRESS.md` → **Security Audit Log** table
2. If 🟢 — no action needed
3. If 🟡 — add entry to **Agent Communication Log** with specific warning
4. If 🔴 — add to **Known Blockers** AND set module back to `🔄 In Progress` in module table:
   `| <timestamp> | security-auditor | implementor | CRITICAL: <file> has <issue> — must fix before merge |`
5. Update this file: Active Task → "None", Phase → "Idle"

## Audit Checklist (per handler)

Apply to every Handler + Service that touches player state:

- [ ] All string fields length-bounded (Validate.name / Validate.chat)
- [ ] All numeric fields range-checked (Validate.slot / Validate.dword)
- [ ] Session state validated (`state === SessionState.IN_WORLD`)
- [ ] Critical mutations journaled to WAL before response
- [ ] DB queries via Knex builder (no raw string interpolation)
- [ ] Rate limiter applied
- [ ] No server-trusted client values (HP, ATK, DEF computed server-side)

## Parallel Spawning Capability

The `security-auditor` agent can spawn parallel sub-auditors for multiple independent files:

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

**Safety limits:**
- maxDepth: 3 (security-auditor → security-auditor → security-auditor)
- maxConcurrent: 5 (max 5 parallel file audits at once)

**See:** `.claude/rules/08-agent-workflow.md` → "Parallel Sub-Agent Spawning" for full protocol.

## Audit Queue

| Priority | File | Status |
|----------|------|--------|
| 1 | `login-server/src/handlers/auth.handler.ts` | ⏳ Pending (not yet implemented) |
| 2 | `cluster-server/src/handlers/characterCreate.handler.ts` | ⏳ Pending |
| 3 | `world-server/src/handlers/movement.handler.ts` | ⏳ Pending |
