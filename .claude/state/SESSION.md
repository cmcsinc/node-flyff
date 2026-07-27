# Session: 2026-07-27

## Current Task
C++ fidelity audit fixes — combat + inventory

## Fixed This Session
- **C5** — magic element factor: skill vs attacker weapon (not defender)
- **C1** — Player→NPC hit rate coefficients corrected
- **C2+C3** — skill crits blocked; pre-roll 1.1-1.4x crit variance
- **C6** — recovery uses DST-adjusted getSta()/getInt()
- **H1** — NPC→player ATK boost (+5% per level delta)
- **H5** — GetDEFMultiplier (DST_ADJDEF_RATE)
- **H6** — multi-hit skills deal 1/N damage per hit
- **H8** — DROPGOLD is now no-op (matches C++ v19)

## Remaining from Audit
- **H9** — defense randomization (min/max range per hit)
- **H2** — skill GetATKMultiplier (DST_ATKPOWER_RATE)
- **H3+H4** — DST_ABILITY_MIN/MAX + GetItemMultiplier
- **H10-H17** — shop/bank/quest guards
- **M-tier** — 23 medium findings

## Branches
- fix/c5-magic-element-factor (b40a31c)
- fix/h8-dropgold-noop (93824ce)
- fix/c1 + fix/c2c3 + fix/c6-h6 + fix/h1-h5 committed to fix/h8-dropgold-noop
