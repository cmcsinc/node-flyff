# Team: Research

Pure recon — unknown opcode, undocumented packet, unverified formula. No production code written. Output is structured findings in `PROGRESS.md`.

## Roster

- `researcher` x N — one per source file / hex dump / resource file
- `architect` — synthesizes findings into an implementation-ready spec (optional, at the end)

## Flow

```
Phase 1 (parallel fan-out):
  researcher #1 ──► C++ sender (grep "Send(SNSP_X")
  researcher #2 ──► C++ handler (grep "case SNSP_X:")
  researcher #3 ──► hex dump dissection (if capture available)
  researcher #4 ──► resource file lookup (propItem/propMover/propSkill)

Phase 2 (serial, parent aggregates):
  merge into PROGRESS.md -> Research Findings table
  flag conflicts (e.g. C++ says DWORD, hex shows WORD)

Phase 3 (optional):
  architect ──► turn findings into a layer-breakdown plan
  (only if user wants to proceed to implementation next)
```

## Parallelism Notes

- Phase 1 is the highest-leverage parallel spawn in this project — 3-4 researchers on different C++ files is the norm, not the exception.
- Each researcher reads a DIFFERENT file -> zero conflict. Safe to run all at once.
- Cap at `maxConcurrent: 5` per skill `flyff-parallel-spawning`.

## Output Contract (every researcher)

```
### Opcode
SNSP_X = 0xNNNN

### Packet Structure (S -> C) / (C -> S)
| Field | Type | Notes |
|---|---|---|
| ... | ... | ... |

### Source
references/WorldServer/X.cpp:LINE

### Confidence
HIGH (source + hex agree) | MEDIUM (source only) | LOW (inferred)
```

Researchers that cannot find ground truth MUST say so — never fabricate a packet layout. Mark `LOW` confidence and list what is missing.

## Handoff

When Phase 2 lands in `PROGRESS.md`, the main session decides:
- Implement next -> invoke [feature.md](./feature.md) with the findings as input.
- Need deeper recon -> spawn another research round with narrower scope.
- Blocked -> record in PROGRESS.md -> **Known Blockers**.
