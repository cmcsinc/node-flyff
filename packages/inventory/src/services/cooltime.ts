/**
 * CooltimeService -- consumable cooldown group classification.
 *
 * Ports `CCooltimeMgr::GetGroup` (`_Common/CooltimeMgr.cpp:19-43`): maps an
 * item prop to a 1-based cooldown group + duration. v15 groups are food (1),
 * pill (2), skill (3). Vanilla comments `IK2_POTION` out (no cooldown); we add
 * a 4th potion group so HP potions can be rate-limited via config fallback --
 * the duration source (`dwSkillReady`) is 0 on potions in the source data.
 *
 * Group 0 (with `ms <= 0`) means "no cooldown" -- mirrors C++ returning 0 when
 * `dwSkillReady <= 0`.
 *
 * @module services/cooltime
 */

import type { ItemDefinition } from '@flyff/resources';
import { COOLTIME_GROUP } from '@flyff/entities';

export interface CooltimeGroup {
  /** 1-based group index (0 = no cooldown). */
  group: number;
  /** Cooldown duration in ms (0 = none). */
  ms: number;
}

/**
 * Resolve the cooldown group + duration for `prop`. `potionDefaultMs` is the
 * config fallback used only for the potion group when the item carries no
 * `cooldown_ms` (HP potions in source data).
 */
export function cooltimeGroup(prop: ItemDefinition, potionDefaultMs: number): CooltimeGroup {
  switch (prop.item_kind2) {
    case 'IK2_FOOD':
      if (prop.item_kind3 === 'IK3_PILL') {
        return group(COOLTIME_GROUP.PILL, prop.cooldown_ms);
      }
      return group(COOLTIME_GROUP.FOOD, prop.cooldown_ms);
    case 'IK2_SKILL':
      return group(COOLTIME_GROUP.SKILL, prop.cooldown_ms);
    case 'IK2_POTION':
      return group(COOLTIME_GROUP.POTION, prop.cooldown_ms ?? potionDefaultMs);
    default:
      return { group: 0, ms: 0 };
  }
}

function group(group: number, ms: number | undefined): CooltimeGroup {
  const duration = ms ?? 0;
  return duration > 0 ? { group, ms: duration } : { group: 0, ms: 0 };
}
