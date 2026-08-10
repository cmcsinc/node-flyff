/**
 * Quest DB row → `QuestSlotItem` resolver (server-only).
 *
 * Joins each `character_quests` / `character_completed_quests` row with its
 * `propQuest.inc` definition and resolves every reference the UI shows: title
 * and state text via `propQuest.txt.txt`, item names + icons via propItem, NPC
 * display names via character.inc `SetName`, and map goal coordinates.
 *
 * Command arg layouts are read positionally, matching the C++ loader
 * `CProject::LoadPropQuest` (`_Common/Project.cpp:1500-2260`). Each `case` below
 * cites its source line.
 *
 * @module characters/[id]/quests/resolve
 */

import { formatNumber } from '@/lib/utils';
import {
  getQuest,
  resolveQuestText,
  resolveItem,
  resolveMoverName,
  resolveNpcName,
  resolveNpcPlacement,
  resolveMoverPlacement,
} from '@/lib/quest-catalog';
import type { QuestSlotItem, QuestGoal, QuestRequirement, QuestReward } from './types';
import { QUEST_CATEGORY_LABELS } from './types';

/** A quest DB row — completed rows carry only `id` + `questId`. */
export interface QuestRow {
  id: number;
  questId: number;
  state?: number;
  killNpcNum0?: number;
  killNpcNum1?: number;
  time?: number;
  flags?: number;
}

/** `QuestArg.value` is `number | string`; coerce to a finite number or undefined. */
function num(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Build a goal from raw x/z args, dropping the (0,0) placeholder. */
function goalFrom(x?: number, z?: number, worldId?: number): QuestGoal | undefined {
  if (x === undefined || z === undefined) return undefined;
  if (x === 0 && z === 0) return undefined;
  return worldId !== undefined ? { x, z, worldId } : { x, z };
}

/** `prob` is out of 1e9 (`QuestItem` 4th arg) → percentage. */
function probToPercent(prob: number): number {
  return (prob / 1_000_000_000) * 100;
}

export async function resolveQuests(
  rows: QuestRow[],
  isCompleted = false,
): Promise<QuestSlotItem[]> {
  const out: QuestSlotItem[] = [];
  for (const r of rows) {
    out.push(await resolveOne(r, isCompleted));
  }
  return out;
}

async function resolveOne(r: QuestRow, isCompleted: boolean): Promise<QuestSlotItem> {
  const def = await getQuest(r.questId);
  const symbol = def?.symbol ?? String(r.questId);

  const title = (await resolveQuestText(def?.title)) || undefined;

  // The state block matching the character's current state carries the live
  // desc/cond/status; fall back to state 0 (QS_BEGIN) when absent.
  const stateKey = String(isCompleted ? 14 : (r.state ?? 0));
  const block = def?.states[stateKey] ?? def?.states['0'];
  const description = (await resolveQuestText(block?.desc)) || undefined;
  const conditionText = (await resolveQuestText(block?.cond)) || undefined;
  const statusText = (await resolveQuestText(block?.status)) || undefined;

  const requirements: QuestRequirement[] = [];
  const rewards: QuestReward[] = [];
  let beginNpc: QuestSlotItem['beginNpc'];
  let endNpc: QuestSlotItem['endNpc'];
  let levelReq: [number, number] | undefined;
  let jobReq: number[] | undefined;
  let headQuestId: number | undefined;
  let repeatable = false;

  for (const cmd of def?.commands ?? []) {
    const a = cmd.args;
    switch (cmd.cmd) {
      // `SetCharacter( key )` — the begin NPC (Project.cpp:1520).
      case 'SetCharacter': {
        const key = a[0]?.value;
        if (typeof key === 'string' && key) {
          beginNpc = {
            name: await resolveNpcName(key),
            key,
            goal: await resolveNpcPlacement(key),
          };
        }
        break;
      }

      // `SetBeginCondCharacter( key, worldId, x, z )` — begin NPC + map goal.
      case 'SetBeginCondCharacter': {
        const key = a[0]?.value;
        if (typeof key === 'string' && key) {
          const goal =
            goalFrom(num(a[2]?.value), num(a[3]?.value), num(a[1]?.value)) ??
            (await resolveNpcPlacement(key));
          beginNpc = { name: await resolveNpcName(key), key, goal };
        }
        break;
      }

      // `SetEndCondCharacter( key, worldId, x, z, textId )` (Project.cpp:1991).
      case 'SetEndCondCharacter': {
        const key = a[0]?.value;
        if (typeof key === 'string' && key) {
          const goal =
            goalFrom(num(a[2]?.value), num(a[3]?.value), num(a[1]?.value)) ??
            (await resolveNpcPlacement(key));
          const name = await resolveNpcName(key);
          endNpc = { name, key, goal };
          requirements.push({ kind: 'npc', label: `Report to ${name}`, goal });
        }
        break;
      }

      // `SetBeginCondLevel( min, max )`.
      case 'SetBeginCondLevel': {
        const lo = num(a[0]?.value);
        const hi = num(a[1]?.value);
        if (lo !== undefined && hi !== undefined && (lo > 0 || hi > 0)) {
          levelReq = [lo, hi];
        }
        break;
      }

      // `SetBeginCondJob( JOB_*, ... )`.
      case 'SetBeginCondJob': {
        const jobs = a.map((arg) => num(arg.value)).filter((n): n is number => n !== undefined);
        if (jobs.length > 0) jobReq = jobs;
        break;
      }

      // `SetEndCondKillNPC( idx, MI_*, count, x, z, textId )` (Project.cpp:1926).
      case 'SetEndCondKillNPC': {
        const killIndex = num(a[0]?.value);
        const moverId = num(a[1]?.value);
        const count = num(a[2]?.value);
        if (moverId === undefined) break;
        const goal =
          goalFrom(num(a[3]?.value), num(a[4]?.value)) ?? (await resolveMoverPlacement(moverId));
        requirements.push({
          kind: 'kill',
          label: `Defeat ${await resolveMoverName(moverId)}`,
          count,
          refId: moverId,
          goal,
          killIndex,
        });
        break;
      }

      // `SetEndCondItem( sex, type, jobOrItem, itemId, count, [x, z, textId] )`
      // (Project.cpp:1885).
      case 'SetEndCondItem': {
        const itemId = num(a[3]?.value);
        const count = num(a[4]?.value);
        if (itemId === undefined || itemId < 0) break;
        const { name, iconUrl } = await resolveItem(itemId);
        requirements.push({
          kind: 'item',
          label: `Collect ${name}`,
          count,
          iconUrl,
          refId: itemId,
          goal: goalFrom(num(a[5]?.value), num(a[6]?.value)),
        });
        break;
      }

      // `SetEndRewardItem( sex, type, jobOrItem, itemId, count )` (Project.cpp:2151).
      case 'SetEndRewardItem': {
        const itemId = num(a[3]?.value);
        const count = num(a[4]?.value);
        if (itemId === undefined || itemId < 0) break;
        const { name, iconUrl } = await resolveItem(itemId);
        rewards.push({ kind: 'item', label: name, count, iconUrl, refId: itemId });
        break;
      }

      // `SetEndRewardGold( min, max )` (Project.cpp:2215).
      case 'SetEndRewardGold': {
        const lo = num(a[0]?.value) ?? 0;
        const hi = num(a[1]?.value) ?? lo;
        if (lo > 0 || hi > 0) {
          rewards.push({
            kind: 'gold',
            label:
              lo === hi
                ? `${formatNumber(lo)} Penya`
                : `${formatNumber(lo)}–${formatNumber(hi)} Penya`,
          });
        }
        break;
      }

      // `SetEndRewardExp( min, max )` (Project.cpp:2229).
      case 'SetEndRewardExp': {
        const lo = num(a[0]?.value) ?? 0;
        const hi = num(a[1]?.value) ?? lo;
        if (lo > 0 || hi > 0) {
          rewards.push({
            kind: 'exp',
            label:
              lo === hi ? `${formatNumber(lo)} EXP` : `${formatNumber(lo)}–${formatNumber(hi)} EXP`,
          });
        }
        break;
      }

      // `SetEndRewardSkillPoint( n )` (Project.cpp:2237).
      case 'SetEndRewardSkillPoint': {
        const sp = num(a[0]?.value);
        if (sp !== undefined && sp > 0) {
          rewards.push({
            kind: 'skillPoint',
            label: `${String(sp)} Skill Point${sp > 1 ? 's' : ''}`,
          });
        }
        break;
      }

      case 'SetHeadQuest':
        headQuestId = num(a[0]?.value);
        break;

      case 'SetRepeat':
        repeatable = true;
        break;

      default:
        break;
    }
  }

  // Quest-item drop generators: which monster drops the collectible, and where.
  const questItems: QuestSlotItem['questItems'] = [];
  for (const qi of def?.quest_items ?? []) {
    const { name, iconUrl } = await resolveItem(qi.item);
    questItems.push({
      moverName: await resolveMoverName(qi.mover),
      itemName: name,
      itemIconUrl: iconUrl,
      count: qi.num,
      chance: probToPercent(qi.prob),
      goal: await resolveMoverPlacement(qi.mover),
    });
  }

  // Prefer resolved title text; a bare numeric symbol carries no information.
  const name = title ?? (/^\d+$/.test(symbol) ? `Quest #${String(r.questId)}` : symbol);

  return {
    id: r.id,
    questId: r.questId,
    state: isCompleted ? 14 : (r.state ?? 0),
    killNpcNum0: r.killNpcNum0 ?? 0,
    killNpcNum1: r.killNpcNum1 ?? 0,
    time: r.time ?? 0,
    flags: r.flags ?? 0,
    name,
    symbol,
    title,
    description,
    conditionText,
    statusText,
    beginNpc,
    endNpc,
    requirements,
    rewards,
    levelReq,
    jobReq,
    headQuestId,
    categoryLabel: headQuestId !== undefined ? QUEST_CATEGORY_LABELS[headQuestId] : undefined,
    removable: def?.no_remove !== true,
    repeatable,
    questItems,
  };
}
