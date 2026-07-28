# Session: 2026-07-27

## Current Task
C++ fidelity audit fixes — all tiers

## Fixed This Session (C+H+M tiers)

### CRITICAL (all resolved)
- C1 — hit rate coefficients corrected
- C2+C3 — skill crits blocked + pre-roll variance
- C5 — magic element factor direction
- C6 — recovery uses DST-adjusted stats
- C7 — ACTMSG vs arrival-FSM (documented, no change needed)

### HIGH (all resolved)
- H1 — NPC→player ATK boost
- H2 — skill GetATKMultiplier
- H3+H4 — DST_ABILITY_MIN/MAX + GetItemMultiplier
- H5 — GetDEFMultiplier
- H6 — multi-hit 1/N damage
- H8 — DROPGOLD no-op
- H9 — defense randomization
- H11 — cluster version validation
- H12+H13 — shop pricing + stock validation
- H14+H15+H16 — bank guards
- H17 — quest m_bNoRemove

### MEDIUM (all resolved)
- M1 — weapon mastery DSTs
- M2 — player block formula (C++ faithful)
- M3 — DST_ATKPOWER pipeline position
- M4 — element ordering verified correct
- M5 — recovery DST bonuses
- M6 — Master/Hero +1 GP/level
- M7 — death penalty modifiers
- M8 — party/guild quest conditions
- M9 — chaotic blocks shop open
- M10 — sell blocks (IK3_EVENTMAIN, quest items)
- M11 — sell price min-1 floor
- M12 — bank gold overflow guard
- M13 — target m_idTargeter direction
- M14+M15 — already implemented
- M16 — DOEQUIP nPart validation order
- M17 — updateItem nId rename

### LOW (all resolved)
- L1 — PvP immunity (DST_IGNORE_DMG_PVP) guard pipe
- L2 — enemy-state damage bonuses guard pipe
- L3+L4+L6 — ponytail comments for unported features
- L5 — returning-to-begin invulnerability
- L7 — DST_ADJ_HITRATE buff in hit rate
- L11 — quest cancel QS_END check
- L12 — removed invented NPC buff rate limit
- L13 — SELLITEM comment fix (slot → objid)
- L14+L15 — already correct
- Prerequisite: MAX_ADJPARAMARY bumped 94→117 (DST indices >=94 were silently dropped)

## Remaining
- H10: CERTIFY __SECURITY_0628 (needs build flag confirmation)
- All 64 fidelity findings resolved (7 CRIT + 17 HIGH + 23 MED + 17 LOW)

## Audit Doc
`docs/c++-fidelity-audit.md`
