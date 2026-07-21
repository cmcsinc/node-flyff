/**
 * QuestTrackerSystem — reactive quest-condition engine (kill / patrol / time).
 *
 * Three concerns, each cheap, mirroring the C++ per-mover update paths:
 *   - **Kill** (`CMover::OnDied` → quest `SetEndCondKillNPC`): combat calls
 *     {@link onKill}; matching active quests increment `m_nKillNPCNum[slot]`
 *     (capped at the target count) → SETQUEST.
 *   - **Patrol** (`SetEndCondPatrolZone` rect): movement calls
 *     {@link onPlayerMoved}; entering the rect sets `QUEST_FLAG.PATROL` → SETQUEST.
 *   - **Time limit** (`SetEndCondLimitTime` countdown): {@link tick} decrements
 *     `m_wTime` each second; at 0 it sets bit15 (expired, `DPClient.cpp:5971`)
 *     → QUEST_TEXT_TIME + SETQUEST.
 *
 * The system is the C++ per-tick counterpart but the emulator has no central
 * 50 ms loop yet, so {@link start} runs its own 1 s timer (like
 * `NpcSpeechService`). `tick(dtMs)` stays public for the future central loop +
 * tests. `onKill`/`onPlayerMoved` are reactive hooks the combat and movement
 * services call (contract; `ponytail` until those wire in).
 *
 * Egress is `playerManager.sendTo` (the sanctioned write abstraction — same
 * pattern as `CombatService`); the system holds no socket references.
 *
 * @module systems/questTracker
 */

import type { QuestArg, QuestDef, QuestIndex } from '@flyff/resources';
import type { QuestRepository } from '@flyff/database';
import type { CPlayer } from '../entities/player.js';
import type { PlayerManager } from '../managers/player.manager.js';
import { QUEST_FLAG } from '@flyff/core/constants/quest.js';
import { buildSetQuest, buildQuestTextTime } from '../net/snapshot/quest.serializer.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'quest-tracker' });

/** `SetEndCondLimitTime` is in whole seconds; tick once per second. */
const TICK_MS = 1000;

interface KillCond {
  readonly slot: 0 | 1;
  readonly monster: number;
  readonly need: number;
}

interface PatrolCond {
  readonly world: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface QuestTrackerDeps {
  quests: QuestIndex;
  playerManager: Pick<PlayerManager, 'all' | 'sendTo'>;
  /** Persist kill/patrol/time mutations. Optional for tests. */
  questRepo?: Pick<QuestRepository, 'upsertActive'>;
}

export class QuestTrackerSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: QuestTrackerDeps) {}

  /** Begin the time-limit countdown loop (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(TICK_MS), TICK_MS);
  }

  /** Stop the countdown loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Combat `OnDied` hook — increment `m_nKillNPCNum[slot]` for each active quest
   * whose `SetEndCondKillNPC(slot, MI, need)` targets the slain monster, capped
   * at `need`. Emits one SETQUEST per changed quest.
   */
  onKill(killer: CPlayer, victimModelIdx: number): void {
    let mutated = false;
    for (const q of killer.m_aQuest) {
      const def = this.deps.quests.byId.get(q.id);
      if (!def) continue;
      for (const k of killConds(def)) {
        if (k.monster !== victimModelIdx) continue;
        const have = q.killNpcNum[k.slot] ?? 0;
        if (have >= k.need) continue;
        q.killNpcNum[k.slot] = Math.min(k.need, have + 1);
        mutated = true;
        this.deps.playerManager.sendTo(killer, buildSetQuest(killer.m_idPlayer, q));
      }
    }
    if (mutated) this.flush(killer);
  }

  /**
   * Movement hook — set `QUEST_FLAG.PATROL` on each active quest whose
   * `SetEndCondPatrolZone(world, l, t, r, b)` rect contains the player. Emits
   * one SETQUEST per newly-satisfied quest. The world id is not gated here
   * (zone→world index map pending); the rect is world-specific so a cross-world
   * player won't coincidentally satisfy it.
   */
  onPlayerMoved(player: CPlayer): void {
    let mutated = false;
    for (const q of player.m_aQuest) {
      if (q.flags & QUEST_FLAG.PATROL) continue;
      const def = this.deps.quests.byId.get(q.id);
      const rect = def ? patrolCond(def) : undefined;
      if (!rect) continue;
      if (inRect(rect, player.m_vPos)) {
        q.flags |= QUEST_FLAG.PATROL;
        mutated = true;
        this.deps.playerManager.sendTo(player, buildSetQuest(player.m_idPlayer, q));
      }
    }
    if (mutated) this.flush(player);
  }

  /**
   * Per-tick time-limit countdown (seconds granularity). For each active quest
   * with a `SetEndCondLimitTime`, decrement `m_wTime`; at 0 set bit15 (expired)
   * and emit QUEST_TEXT_TIME + SETQUEST. No `await` (rule 05).
   */
  tick(dtMs: number): void {
    const secs = Math.max(1, Math.round(dtMs / 1000));
    for (const player of this.deps.playerManager.all()) {
      for (const q of player.m_aQuest) {
        const def = this.deps.quests.byId.get(q.id);
        if (!def) continue;
        if (limitTime(def) <= 0) continue;
        const remaining = q.time & 0x7fff;
        if (remaining === 0) continue; // already expired
        const next = Math.max(0, remaining - secs);
        q.time = next === 0 ? 0x8000 : next;
        player._dirty.add('m_aQuest');
        this.deps.playerManager.sendTo(
          player, buildQuestTextTime(player.m_idPlayer, next === 0, q.state, q.time),
        );
        if (next === 0) this.deps.playerManager.sendTo(player, buildSetQuest(player.m_idPlayer, q));
      }
    }
  }

  /** Mark dirty + fire-and-forget persist of all active records (rule 04/05). */
  private flush(player: CPlayer): void {
    player._dirty.add('m_aQuest');
    const repo = this.deps.questRepo;
    if (!repo) return;
    for (const q of player.m_aQuest) {
      repo.upsertActive(player.m_idPlayer, {
        quest_id: q.id, state: q.state, time: q.time,
        kill_npc_num_0: q.killNpcNum[0], kill_npc_num_1: q.killNpcNum[1], flags: q.flags,
      }).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'quest persist failed'));
    }
  }
}

/** Read the numeric value of an arg (resolved syms are numbers). */
function num(arg: QuestArg | undefined, fallback = 0): number {
  if (!arg) return fallback;
  return typeof arg.value === 'number' ? arg.value : fallback;
}

/** All `SetEndCondKillNPC(slot, MI, need)` conditions on `def`. */
function killConds(def: QuestDef): KillCond[] {
  const out: KillCond[] = [];
  for (const c of def.commands) {
    if (c.cmd !== 'SetEndCondKillNPC') continue;
    const slot = (Math.min(Math.max(num(c.args[0]), 0), 1)) as 0 | 1;
    out.push({ slot, monster: num(c.args[1]), need: num(c.args[2], 1) });
  }
  return out;
}

/** The first `SetEndCondPatrolZone(world, l, t, r, b)` rect on `def` (normalized). */
function patrolCond(def: QuestDef): PatrolCond | undefined {
  for (const c of def.commands) {
    if (c.cmd !== 'SetEndCondPatrolZone') continue;
    const world = num(c.args[0]);
    const a = num(c.args[1]), b = num(c.args[2]), d = num(c.args[3]), e = num(c.args[4]);
    return {
      world,
      left: Math.min(a, d), right: Math.max(a, d),
      top: Math.min(b, e), bottom: Math.max(b, e),
    };
  }
  return undefined;
}

/** First `SetEndCondLimitTime(n)` seconds value on `def`. */
function limitTime(def: QuestDef): number {
  for (const c of def.commands) {
    if (c.cmd === 'SetEndCondLimitTime') return num(c.args[0]);
  }
  return 0;
}

/** Rect contains point? Flyff patrol rects bound the X/Z plane (Y is up). */
function inRect(r: PatrolCond, p: { x: number; z: number }): boolean {
  return p.x >= r.left && p.x <= r.right && p.z >= r.top && p.z <= r.bottom;
}
