/**
 * `AR_*` attack-range enum -> metres, the port of `CMover::GetAttackRange`
 * (`_Common/MoverMsg.cpp:140-166`).
 *
 * This is the **cast reach** of a skill (and the swing reach of a weapon): in
 * C++ it is the distance the CLIENT walks to before casting
 * (`CMD_SetUseSkill` → `SetDestObj(target, fArrivalRange)`,
 * `_Common/MoverMsg.cpp:206,394`). The WORLDSERVER's `DoUseSkill` never gates on
 * it — an emulator must, because it cannot trust the client, and AR_* is the
 * right magnitude since a genuine client is always inside it when a cast fires.
 * See the divergence note in `skills/services/skill.service.ts`.
 *
 * Do NOT confuse it with the per-level `dwSkillRange` (propSkillAdd), which is
 * the AoE/region radius consumed by `ApplySkillRegion` / `ApplySkillAround` /
 * `ApplySkillLine` / `ApplySkillAroundTroupe` (`_Common/Ctrl.cpp:268,432,752`)
 * — a 6 m AoE on a skill you cast from 15 m away.
 *
 * @module constants/attackRange
 */

import { DST } from './dst';
import type { ParamView } from '../params/ParamModel';

/** `AR_*` (`defineAttribute.h:93-99`). */
export const AR = Object.freeze({
  SHORT: 1,
  LONG: 2,
  FAR: 3,
  RANGE: 4,
  WAND: 5,
  HRANGE: 6,
  HWAND: 7,
} as const);

/** `AR_*` -> metres, verbatim from the `GetAttackRange` switch. */
const AR_METRES: ReadonlyMap<number, number> = new Map([
  [AR.SHORT, 2],
  [AR.LONG, 3],
  [AR.FAR, 4],
  [AR.RANGE, 10],
  [AR.WAND, 15],
  [AR.HRANGE, 6],
  [AR.HWAND, 18],
]);

/**
 * Stand-in for the two model radii `CObj::IsRangeObj` (`Obj.cpp:805`) adds on
 * top of `fRange`: `0.8 * GetRadius(caster) + 0.8 * GetRadius(target) + fRange`.
 * The WORLDSERVER loads real models there; we have no mesh bounds, so a flat
 * allowance stands in for both. Roughly two human-sized movers.
 *
 * It doubles as position-lag slack: the server's copy of a moving target trails
 * the client's by up to one movement tick, and rejecting a cast the client
 * thought was in range strands `m_nExecute` (see the CLEAR_USESKILL notes in
 * `skill.service.ts`). Erring generous is the safe direction — the gate is
 * anti-cheat against teleport-range casts, not a precision fence.
 *
 * ponytail: real per-mover bounds once model/collision data is ported; then
 * this becomes `0.8 * (rCaster + rTarget)`.
 */
export const RANGE_HITBOX_SLACK = 2.0;

/**
 * `GetAttackRange( dwAttackRange )` — resolve an `AR_*` enum to metres, scaled
 * by the caster's `DST_HAWKEYE_RATE` (`MoverMsg.cpp:155-162`, the Ranger
 * Hawkeye buff: `fAttRange = fAttRange * (rate + 100) / 100`).
 *
 * Unknown/absent enum returns `0`, matching the C++ `default:` arm — callers
 * decide whether a 0-reach skill is self-only or should fall back.
 */
export function getAttackRange(arEnum: number | undefined, params?: ParamView): number {
  const base = AR_METRES.get(arEnum ?? 0) ?? 0;
  if (base === 0) return 0;
  const rate = params?.get(DST.HAWKEYE_RATE, 0) ?? 0;
  if (rate <= 0) return base;
  return (base * (rate + 100)) / 100;
}
