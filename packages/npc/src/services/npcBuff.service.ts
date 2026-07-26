/**
 * NpcBuffService -- `PACKETTYPE_NPC_BUFF` (0xf000f813) under `__NPC_BUFF`.
 *
 * `CDPSrvr::OnNPCBuff` (DPSrvr.cpp:11242-11308): the client sends the buff-pang
 * NPC's character.inc key (right-click `MMI_NPC_BUFF`); the server resolves the
 * block, checks the player stands near ANY spawned buff NPC
 * (`CNpcChecker::IsCloseNpc(MMI_NPC_BUFF, ...)` -- key-independent), then applies
 * each `SetBuffSkill` entry whose player level is in range via
 * {@link SkillService.applyNpcBuff}. No cost, no DB, no WAL -- buffs are
 * in-memory and swept by `BuffSystem`.
 *
 * Deviations from C++:
 *  - **1s rate-limit** (C++ has none); `OnNPCBuff` is client-spammable.
 *  - **Generic-vs-cheer conflict** + duration override live in `applyNpcBuff`.
 *
 * @module services/npcBuff
 */

import type { CharacterIncIndex, NpcBuffSkillEntry, SkillIndex } from '@flyff/resources';
import { MMI_NPC_BUFF } from '@flyff/resources';
import type { CPlayer, CMover } from '@flyff/entities';
import type { SkillService } from '@flyff/skills';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'npcBuff-service' });

/** Rate limit (C++ has none -- see file header). */
const NPC_BUFF_COOLDOWN_MS = 1000;

/** C++ `MAX_LEN_MOVER_MENU` (npchecker.h:4) -- squared distance gate. */
const MAX_LEN_MOVER_MENU_SQ = 1024;

/** SpawnManager surface this service consumes (zone-scoped scan only). */
export interface NpcBuffSpawnLookup {
  inZone(zoneId: number): readonly CMover[];
}

export interface NpcBuffDeps {
  spawnManager: NpcBuffSpawnLookup;
  characterInc: CharacterIncIndex;
  skills: SkillIndex;
  skillService: SkillService;
}

export type NpcBuffResult =
  | { ok: true; applied: number; refreshed: number; replaced: number; conflicts: number; skipped: number }
  | { ok: false; reason: 'rate_limited' | 'unknown_npc' | 'not_buff_npc' | 'no_nearby_buff_npc' };

/** Squared 3D distance -- matches C++ `D3DXVec3LengthSq`. */
function distSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export class NpcBuffService {
  constructor(private readonly deps: NpcBuffDeps) {}

  /**
   * Resolve a buff-pang request. `now` is injected for testability. Returns a
   * tally of outcomes so the handler can log without poking the buff runtime.
   */
  buff(player: CPlayer, key: string, now: number): NpcBuffResult {
    if (now - player.m_tickNpcBuff < NPC_BUFF_COOLDOWN_MS) {
      return { ok: false, reason: 'rate_limited' };
    }

    const block = this.deps.characterInc.byKey.get(key);
    if (!block) {
      return { ok: false, reason: 'unknown_npc' };
    }
    if (block.buffSkills.length === 0) {
      return { ok: false, reason: 'not_buff_npc' };
    }

    // C++ proximity check: any spawned NPC with MMI_NPC_BUFF within
    // MAX_LEN_MOVER_MENU of the player. Key-independent -- the submitted key
    // only selects the buff list (anti-cheat covered by server config + level gate).
    const nearby = this.hasNearbyBuffNpc(player);
    if (!nearby) {
      return { ok: false, reason: 'no_nearby_buff_npc' };
    }

    player.m_tickNpcBuff = now;

    let applied = 0;
    let refreshed = 0;
    let replaced = 0;
    let conflicts = 0;
    let skipped = 0;

    for (const entry of block.buffSkills) {
      if (!this.levelInRange(player, entry)) {
        skipped++;
        continue;
      }
      const resolved = this.resolveEntry(entry);
      if (!resolved) {
        skipped++;
        continue;
      }
      const outcome = this.deps.skillService.applyNpcBuff(
        player, resolved.skill, resolved.levelRow, entry.durationMs, now,
      );
      switch (outcome) {
        case 'applied': applied++; break;
        case 'refreshed': refreshed++; break;
        case 'replaced': replaced++; break;
        case 'conflict': conflicts++; break;
        case 'ignored': break;
      }
    }

    logger.info(
      { charId: player.m_idPlayer, key, applied, refreshed, replaced, conflicts, skipped },
      'NPC_BUFF applied',
    );
    return { ok: true, applied, refreshed, replaced, conflicts, skipped };
  }

  /** `nMinPlayerLV ≤ level ≤ nMaxPlayerLV` (DPSrvr.cpp:11260). */
  private levelInRange(player: CPlayer, entry: NpcBuffSkillEntry): boolean {
    return player.m_nLevel >= entry.minPlayerLevel && player.m_nLevel <= entry.maxPlayerLevel;
  }

  /** Resolve the skill definition + the per-level row for an entry. */
  private resolveEntry(entry: NpcBuffSkillEntry): { skill: NonNullable<ReturnType<SkillIndex['skills']['get']>>; levelRow: NonNullable<ReturnType<SkillIndex['skills']['get']>>['levels'][number] } | undefined {
    const skill = this.deps.skills.skills.get(entry.skillId);
    if (!skill) return undefined;
    const levelRow = skill.levels.find((l) => l.level === entry.level);
    if (!levelRow) return undefined;
    return { skill, levelRow };
  }

  /** True if any spawned buff-pang NPC is within `MAX_LEN_MOVER_MENU` of the player. */
  private hasNearbyBuffNpc(player: CPlayer): boolean {
    for (const npc of this.deps.spawnManager.inZone(player.m_nZoneId)) {
      if (!npc.menus?.includes(MMI_NPC_BUFF)) continue;
      if (distSq(player.m_vPos, npc.m_vPos) <= MAX_LEN_MOVER_MENU_SQ) return true;
    }
    return false;
  }
}
