# Architect Agent Session

- **Agent**: architect
- **Active Task**: None — ready for design tasks
- **Phase**: Idle
- **Last Updated**: 2026-03-24

## Current Work

_No active design work. Wait for user to request a system design or implementor to raise a design question._

## Restore Protocol

1. Read `.claude/state/PROGRESS.md` — understand what has been built and what is pending
2. Read `CLAUDE.md` — confirm current architecture constraints
3. Read relevant rule files (`02-layer-architecture.md`, `03-security.md`, `04-persistence.md`)
4. Use findings to inform the design proposal

## Completion Protocol

When a design is complete:
1. Output a structured design proposal (Core Concept → Layer Breakdown → Edge Cases → Implementation Plan)
2. Add entry to PROGRESS.md → **Agent Communication Log**:
   `| <timestamp> | architect | implementor | Design for <system> complete — see above |`
3. Update this file: Active Task → "None", Phase → "Idle"

## Design Decisions Log

| System | Decision | Date | Notes |
|--------|----------|------|-------|
| IPC | HMAC-SHA256 over Redis pub/sub + internal TLS TCP | 2026-03-23 | Security over performance for inter-server comms |
| Persistence | Hybrid WAL (SQLite journal + Knex main DB) | 2026-03-23 | Zero-latency crash recovery without DB DDoS |
| State | Zone-based broadcasting, dirty flags | 2026-03-23 | O(k) not O(n) for broadcasts |
