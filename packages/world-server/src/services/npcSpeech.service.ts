/**
 * NpcSpeechService — ambient NPC speech bubbles, no player interaction.
 *
 * Every spawned NPC with a `character.inc` key (`outfit.characterKey`, mirroring
 * the C++ `m_szCharacterKey`) that resolves to a dialog prefix periodically
 * "speaks" its state-0 greeting as a speech bubble above itself.
 *
 * Protocol (verified against the v15 C++ source):
 *   - Bubble = `SNAPSHOTTYPE_CHAT` (0x0001) snapshot attributed to the NPC's
 *     objid. `Speak(npcId, n)` → `CUserMng::AddChat((CCtrl*)pMover, str)`
 *     (`WORLDSERVER/User.cpp:4309`) → `ar << GETID(pCtrl) << SNAPSHOTTYPE_CHAT;
 *     WriteString(szChat)`, broadcast via `FOR_VISIBILITYRANGE`. Rendered as a
 *     balloon by `CDPClient::OnChat` (`Neuz/DPClient.cpp:1425`). This is the
 *     exact packet `ChatSerializer` already builds.
 *   - `Say(n)` is NOT a bubble — it is a private dialog line to the clicker
 *     (`FUNCTYPE_SAY`). Only `speak` lines are broadcast here.
 *
 * Cadence mirrors `CNpcProperty` (`_Common/NpcProperty.cpp:9-29`): first fire
 * 60–90s after boot, re-arm 15–25s, per-NPC random so the population doesn't
 * speak in unison. (`SetScriptTimer` is a no-op in this source tree, so the
 * per-state `timer` field is decorative and intentionally unused.)
 *
 * Custom feature: vanilla `CMover::ProcessScript` (`Mover.cpp:1315`) dispatches
 * `#auto` → `<prefix>_auto()`, but zero `_auto` functions exist in
 * `NpcScript.cpp` — vanilla NPCs are silent ambiently. This service adds the
 * ambient speech the user asked for, using the faithful packet + timer.
 *
 * Performance: `tick()` is sync (no `await` — rule 05), iterates a fixed
 * schedule, and builds a packet only when a timer fires. Zone-scoped broadcast.
 *
 * @module services/npcSpeech.service
 */

import type { SpawnManager } from '../managers/spawn.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { CMover } from '../entities/mover.js';
import type { DialogIndex } from '@flyff/resources';
import { prefixForNpc, stateForKey, dialogText } from '@flyff/resources';
import { ChatSerializer } from '../net/snapshot/chat.serializer.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'npc-speech' });

/** Schedule poll resolution — speech timers are 15+ s, so 1 s is precise enough. */
const POLL_MS = 1_000;
/** First-fire window after boot (`NpcProperty.cpp:13` — `MIN(1)+xRandom(SEC(30))`). */
const FIRST_FIRE_MIN_MS = 60_000;
const FIRST_FIRE_RANGE_MS = 30_000; // 60–90 s
/** Re-arm window (`NpcProperty.cpp:27` — `SEC(15)+xRandom(SEC(10))`). */
const REARM_MIN_MS = 15_000;
const REARM_RANGE_MS = 10_000; // 15–25 s

export interface NpcSpeechDeps {
  spawnManager: SpawnManager;
  zoneManager: ZoneManager;
  dialogs: DialogIndex;
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number;
  /** Injectable RNG (tests); defaults to `Math.random`. */
  random?: () => number;
}

interface SpeechEntry {
  readonly mover: CMover;
  readonly lines: readonly string[];
  lineIdx: number;
  nextAt: number;
}

/** Next fire time for a fresh entry (60–90 s from `now`). */
function firstFireAt(now: number, random: () => number): number {
  return now + FIRST_FIRE_MIN_MS + Math.floor(random() * FIRST_FIRE_RANGE_MS);
}

/** Next fire time after an emission (15–25 s from `now`). */
function reArmAt(now: number, random: () => number): number {
  return now + REARM_MIN_MS + Math.floor(random() * REARM_RANGE_MS);
}

export class NpcSpeechService {
  private readonly serializer = new ChatSerializer();
  private readonly spawnManager: SpawnManager;
  private readonly zoneManager: ZoneManager;
  private readonly dialogs: DialogIndex;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly schedule: SpeechEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: NpcSpeechDeps) {
    this.spawnManager = deps.spawnManager;
    this.zoneManager = deps.zoneManager;
    this.dialogs = deps.dialogs;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  /** Build the schedule from spawned NPCs and start the poll timer. */
  start(): void {
    this.bootstrap();
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  /** Stop polling (shutdown wiring — rule 05 timers must be cleared). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Scan spawned NPCs once and resolve each one's state-0 `speak` greeting. */
  bootstrap(): void {
    const total = this.spawnManager.size;
    let scheduled = 0;
    const now = this.now();
    for (const mover of this.spawnManager.all()) {
      const lines = this.greetingLines(mover);
      if (lines.length === 0) continue;
      this.schedule.push({ mover, lines, lineIdx: 0, nextAt: firstFireAt(now, this.random) });
      scheduled++;
    }
    logger.info({ scheduled, total }, 'NpcSpeech scheduled');
  }

  /** State-0 `speak` lines for `mover`, resolved to text. Empty if none. */
  private greetingLines(mover: CMover): string[] {
    // Prefer the symbolic MI_* name (always present on spawned NPC movers);
    // fall back to outfit.characterKey for hand-built test stubs.
    const key = mover.m_szKey || mover.outfit?.characterKey;
    if (!key) return [];
    const prefix = prefixForNpc(this.dialogs, key);
    if (!prefix) return [];
    const state0 = stateForKey(this.dialogs, prefix, 0);
    const ids = state0?.speak;
    if (!ids || ids.length === 0) return [];
    const lines: string[] = [];
    for (const n of ids) {
      const text = dialogText(this.dialogs, n);
      if (text) lines.push(text);
    }
    return lines;
  }

  /** Emit due speeches and re-arm. Sync — no `await` (rule 05). */
  tick(): void {
    const now = this.now();
    for (const entry of this.schedule) {
      if (entry.nextAt > now) continue;
      const text = entry.lines[entry.lineIdx % entry.lines.length];
      if (text === undefined) continue; // unreachable: entries always carry ≥1 line
      entry.lineIdx++;
      const packet = this.serializer.build(entry.mover.m_idMover, text);
      this.zoneManager.broadcastAround(
        entry.mover.m_vPos,
        entry.mover.m_nZoneId,
        VISIBILITY_RADIUS,
        packet,
      );
      entry.nextAt = reArmAt(now, this.random);
    }
  }
}
