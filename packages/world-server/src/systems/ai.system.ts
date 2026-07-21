/**
 * AISystem — idle-wander FSM for live monsters (C++ `CAIMonster::StateIdle`).
 *
 * The world has no central 50 ms tick yet, so {@link start} runs its own timer
 * (like `QuestTrackerSystem` / `NpcSpeechService`); {@link tick} is public for
 * the future unified loop and for tests.
 *
 * **Wire model** (research: `AIMonster.cpp`, `User.cpp:4705`): the server does
 * NOT step NPC position per tick on the client's behalf. On each new destination
 * it emits exactly ONE `SNAPSHOTTYPE_DESTPOS` (0xc1) and the client walks itself
 * locally (`MoverMove.cpp:344`). So this system tracks only the *logical* leash
 * position — `m_vPos` snaps to the picked destination, and the client renders
 * smooth motion from its own propMover `fSpeed`. Server `m_vPos` is used solely
 * for leash math and the `broadcastAround` visibility filter, both of which
 * tolerate the small ±10 m snap. `ponytail`: full per-tick stepping + SETPOS
 * anti-stuck correction when aggro/chase lands.
 *
 * **Idle pick** (`MoveToRandom`, `AIMonster.cpp:174-217`): every stop interval
 * pick `dest = pos + ([-10..10], _, [-10..10])`; if that leaves the
 * `RANGE_MOVE` (30 m) leash from the spawn anchor `m_vPosBegin`, skip the pick
 * (or snap home if already outside). Stop interval = `SEC(5) + xRandom(SEC(1))`
 * = 5–6 s (`AIMonster.cpp:524`). Monsters only — peaceful town NPCs (`STATE_STAND`)
 * and guards (`AIGuard`) are skipped via `m_bAttackable && !m_bGuard`.
 *
 * No `await` in tick (rule 05). No socket refs (rule 02) — broadcasts via
 * `ZoneManager.broadcastAround`.
 *
 * @module systems/ai
 */

import type { SpawnManager } from '../managers/spawn.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { CMover } from '../entities/mover.js';
import type { Vec3 } from '../entities/player.js';
import { DestPosSerializer } from '../net/snapshot/destPos.serializer.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'ai-system' });

/** Wander cadence — 5–6 s matches C++ (`SEC(5) + xRandom(SEC(1))`). */
const TICK_MS = 1000;
const STOP_MIN_MS = 5000;
const STOP_JITTER_MS = 1000;
/** First-pick stagger window so a fresh spawn doesn't all pick on tick 1. */
const STAGGER_MS = 5000;

/** `RANGE_MOVE` (`AIMonster.cpp:19`) — wander/return leash from `m_vPosBegin`. */
const RANGE_MOVE = 30.0;
const RANGE_MOVE_SQ = RANGE_MOVE * RANGE_MOVE;
/** `MoveToRandom` box half-extent (`x % 21 - 10`, `AIMonster.cpp:174-217`). */
const WANDER_BOX = 10;

export interface AISystemDeps {
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
}

export class AISystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly dest = new DestPosSerializer();
  constructor(private readonly deps: AISystemDeps) {}

  /** Begin the wander loop (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick(Date.now());
      } catch (err) {
        logger.error({ err }, 'AI tick failed');
      }
    }, TICK_MS);
  }

  /** Stop the wander loop (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass: advance every live monster's idle-wander state. Sync, no `await`
   * (rule 05). Public so the future central tick can drive it and tests can
   * pass a deterministic `now`.
   */
  tick(now: number): void {
    for (const m of this.deps.spawnManager.all()) {
      // Monsters only — peaceful town NPCs (STATE_STAND) and guards (AIGuard)
      // are non-wandering in C++. Dead movers are swept from the table by
      // `SpawnManager.kill`; the flag check is belt-and-suspenders.
      if (!m.m_bAttackable || m.m_bGuard || m.m_bDead) continue;
      if (m.m_tmNextWander === 0) {
        m.m_tmNextWander = now + randInt(0, STAGGER_MS);
        continue;
      }
      if (now < m.m_tmNextWander) continue;
      this.wander(m, now);
    }
  }

  /**
   * Pick the next wander destination for one monster, leash it, snap logical
   * position, and broadcast DESTPOS to nearby players.
   */
  private wander(m: CMover, now: number): void {
    const dx = randInt(-WANDER_BOX, WANDER_BOX);
    const dz = randInt(-WANDER_BOX, WANDER_BOX);
    const dest: Vec3 = { x: m.m_vPos.x + dx, y: m.m_vPos.y, z: m.m_vPos.z + dz };

    // Inside leash → walk there. Outside → snap home if we've already drifted
    // past the leash, else skip the pick and stay put (C++ `MoveToRandom`).
    let target: Vec3;
    if (distSq2(dest, m.m_vPosBegin) <= RANGE_MOVE_SQ) {
      target = dest;
    } else if (distSq2(m.m_vPos, m.m_vPosBegin) > RANGE_MOVE_SQ) {
      target = m.m_vPosBegin; // return home
    } else {
      m.m_tmNextWander = now + stopInterval();
      return;
    }

    m.m_vPos = { ...target };
    m.m_tmNextWander = now + stopInterval();
    const packet = this.dest.build(m.m_idMover, { vPos: target, fForward: 1 });
    this.deps.zoneManager.broadcastAround(m.m_vPos, m.m_nZoneId, VISIBILITY_RADIUS, packet);
  }
}

/** Inclusive random int in `[min, max]` — `xRandom`/`x % n` equivalent. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 5–6 s stop interval — `SEC(5) + xRandom(SEC(1))`. */
function stopInterval(): number {
  return STOP_MIN_MS + Math.floor(Math.random() * STOP_JITTER_MS);
}

/** Ground-plane (x/z) squared distance — leash math is 2-D in Flyff. */
function distSq2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
