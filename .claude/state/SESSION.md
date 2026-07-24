# Session — 2026-07-25

## Active goal
PvP/PK system (MISSING-FEATURES §6). Override rule: never mark done/fixed
until user tests. Keep tasks in_progress.

## Status
Implemented PvP/PK core loop — builds clean, all tests pass (118 combat, 190 world-server, etc). Awaiting user real-client test.

## Landed this session
- DB migration 013: pk_propensity, pk_value, pk_time, pk_exp on characters
- CharacterRow + CPlayer PK fields hydrated on JOIN
- m_nPKValue + m_dwPKTime + m_dwPKExp wired to mover serializer
- PK mode toggle: opcode 0xffffff7b (MODE), handler + service + chat notify
- CombatService player-target resolution via PlayerManager
- combat.policy: isPlayerAttackableBy (mutual consent — both must have PK mode ON)
- PvP damage route: playerCombatant defender → 0.60 PvP factor + PvP hit-rate branch (already existed in formulas.ts)
- PvP death: PK value + propensity increment, WAL PK_KILL journal, persist fire-and-forget
- PvP damage floor (max 1) per C++ OnDamageMsgW
- onPvpKill seam wired to RevivalService.onPlayerDeath
- Chaotic revive: 0.1 HP rate (non-chaotic 0.2)
- PkDecaySystem: 60s tick, -1 PK value per 5min elapsed since last PK action
- compose.ts + clientServer.ts + index.ts wiring

## ponytail
- PK-specific skill damage vars (abilityMinPvp/abilityMaxPvp from propSkillAdd)
- Zone region-type enforcement (safe zones reject PvP)
- DUEL handshake opcodes (0xffffff23-2a)
- PK death item-drop penalty (KarmaProp table)
- Lodelight (PK jail town) respawn
- PK-decay rate table (exponential decay curve vs linear)
- Defined-text PK notifications (DST_PK_MODE_ON/OFF)

## Branch
feat/ranged-auto-attack (uncommitted).