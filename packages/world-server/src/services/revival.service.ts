/**
 * RevivalService -- death->revival loop (`DPSrvr::OnRevival*`,
 * `_Common/Mover.cpp::DoDie/SubDieDecExp`).
 *
 * Two entry points:
 *  - {@link onPlayerDeath}: called by `AISystem` on lethal damage. Flags dead,
 *    broadcasts `MOVERDEATH` to vicinity, sends `ACTMSG STOP+DIE` to the dying
 *    client (opens `CWndRevival`).
 *  - {@link revive}: called by `RevivalHandler` for the 3 C->S opcodes.
 *    `SCROLL` (`REVIVAL`) -- consume resurrection scroll, in-place revive, no
 *    exp penalty (non-chaotic). `LODESTAR` (`REVIVAL_TO_LODESTAR`) -- town revive,
 *    exp penalty + teleport to zone revival pos. `LODELIGHT` -- C++ stubs this
 *    empty; rejected.
 *
 * Plus the other-player Resurrection skill (skill 45) answer path:
 * {@link acceptResurrection} / {@link cancelResurrection} port
 * `DPSrvr::OnResurrectionOK` / `OnResurrectionCancel` (`DPSrvr.cpp:6877/6868`).
 * The offer itself is stamped on the dead player by `SkillService` at cast time
 * (`CCtrl::ApplySkillHardCoding`, `Ctrl.cpp:814-821`).
 *
 * HP restore rate 0.2 * max (v19 non-chaotic v9+ default). Exp penalty is the
 * bracket table in `combat/formulas.subDieDecExp`.
 *
 * WAL: scroll consume + exp loss are journaled before the ack (rule 04).
 *
 * ponytail: chaotic/PK revive (different HP rate + PK town), guild-war revive
 * (full HP, no scroll consume), full REPLACE teleport snapshot,
 * DiePenalty.inc table loader, `m_nDead` 5s lockout.
 *
 * @module services/revival.service
 */

import type { CharacterRepository, InventoryRepository, Journal } from '@flyff/database';
import type { ZoneDefinition, SkillIndex } from '@flyff/resources';
import type { CPlayer, Vec3 } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { VisibilityService } from '@flyff/world-core';
import { subDieDecExp } from '@flyff/combat';
import { skillHealAmount } from '@flyff/skills';
import {
  II_SYS_SYS_SCR_RESURRECTION, OBJMSG_DIE, OBJMSG_STOP, OBJMSG_RESURRECTION, DST,
} from '@flyff/entities';
import { MAX_INVENTORY, VISIBILITY_RADIUS, buildRemoveSkillInfluence, buildResetDestParam } from '@flyff/world-core';
import { buildResurrection, buildSetPointParam, DST_HP } from '@flyff/world-core';
import {
  SNAPSHOTTYPE_REVIVAL, SNAPSHOTTYPE_REVIVAL_TO_LODESTAR,
} from '@flyff/world-core';
import { MoverDeathSerializer } from '@flyff/combat';
import { ActMsgSerializer } from '@flyff/inventory';
import { RevivalSerializer } from '../net/snapshot/revival.serializer';
import { buildCreateSfxObj } from '../net/snapshot/cheer.serializer';
import { SetExperienceSerializer } from '@flyff/combat';
import { SetPosSerializer } from '../net/snapshot/setPos.serializer';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'revival-service' });

export type RevivalType = 'SCROLL' | 'LODESTAR' | 'LODELIGHT';

export type RevivalOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_dead' | 'no_scroll' | 'lodelight_unsupported' };

/**
 * Other-player resurrection accept/decline outcome. `no_offer` covers the C++
 * `bUseing == FALSE` silent drop; `not_dead` and `caster_gone` are the two
 * clear-and-return arms inside `OnResurrectionOK` (`DPSrvr.cpp:6883/6912`).
 */
export type ResurrectionOutcome =
  | { ok: true }
  | { ok: false; reason: 'no_offer' | 'not_dead' | 'caster_gone' | 'unknown_skill' };

/**
 * `XI_SKILL_ASS_HEAL_RESURRECTION01` (`resource/defineObj.h:343`) -- the SFX obj
 * `AddCreateSfxObj` plays on the resurrected player (`DPSrvr.cpp:6900`).
 */
const XI_SKILL_ASS_HEAL_RESURRECTION01 = 283;

export interface RevivalServiceDeps {
  readonly charRepo: Pick<CharacterRepository, 'updateLevelAndExp'>;
  readonly inventoryRepo: Pick<InventoryRepository, 'removeItem' | 'updateQuantity'>;
  readonly journal?: Journal;
  readonly zoneManager: ZoneManager;
  readonly playerManager: Pick<PlayerManager, 'sendTo' | 'get'>;
  /**
   * Skill index -- the other-player resurrection accept path re-resolves the
   * offer's skill + level rows to compute the DST_HP grant and read
   * `dwDestParam2`/`nAdjParamVal2`. Optional so the revive-only tests can omit it.
   */
  readonly skills?: SkillIndex;
  /** Zone revival-position lookup by numeric zone id (resources `byNumericId`). */
  readonly zones: { byNumericId: Map<number, ZoneDefinition> };
  /**
   * View re-diff after the revival teleport -- SETPOS relocates the player
   * without reloading the world, so the death-site spawns must be DEL_OBJ'd and
   * the town's ADD_OBJ'd. Optional for tests.
   */
  readonly visibilityService?: Pick<VisibilityService, 'refresh'>;
}

const REVIVE_HP_RATE = 0.2; // v19 non-chaotic v9+ default (DPSrvr.cpp:997,1100)
/** Chaotic (PK) players revive at half the normal HP rate (DPSrvr.cpp PK branch). */
const REVIVE_HP_RATE_CHAOTIC = 0.1;

export class RevivalService {
  private readonly moverDeath = new MoverDeathSerializer();
  private readonly actMsg = new ActMsgSerializer();
  private readonly revival = new RevivalSerializer();
  private readonly setExp = new SetExperienceSerializer();
  private readonly setPos = new SetPosSerializer();

  constructor(private readonly deps: RevivalServiceDeps) {}

  /**
   * `CMover::DoDie` player path. Idempotent -- the `m_bDead` guard stops
   * double-trigger on multi-hit ticks that both cross HP=0.
   */
  onPlayerDeath(player: CPlayer, killerObjid: number): void {
    if (player.m_bDead) return;
    player.m_bDead = true;

    // Clear all active buffs (C++ DoDie drops the skill-state list). Reverses
    // each DST delta on m_params + broadcasts REMOVESKILLINFULENCE + RESETDESTPARAM
    // per buff so peers + self drop the icons and stat-window deltas.
    for (const buff of player.m_buffs.clear()) {
      this.deps.zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        buildRemoveSkillInfluence(player.m_idPlayer, buff.type, buff.skillId),
      );
      for (const e of buff.effects) {
        this.deps.zoneManager.broadcastAround(
          player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
          buildResetDestParam(player.m_idPlayer, e.dst, e.adj),
        );
      }
    }

    // Vicinity: peers play the death animation (AddMoverDeath, User.cpp:4488).
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.moverDeath.build(player.m_idPlayer, killerObjid, 0),
    );
    // Self: halt then open the revive dialog (SendActMsg OBJMSG_STOP/OBJMSG_DIE).
    this.deps.playerManager.sendTo(player, this.actMsg.build(player.m_idPlayer, OBJMSG_STOP, 0, 0));
    this.deps.playerManager.sendTo(
      player, this.actMsg.build(player.m_idPlayer, OBJMSG_DIE, 0, killerObjid),
    );
  }

  /** `OnRevival` / `OnRevivalLodestar` / `OnRevivalLodelight` dispatch. */
  revive(player: CPlayer, type: RevivalType): RevivalOutcome {
    if (type === 'LODELIGHT') return { ok: false, reason: 'lodelight_unsupported' };
    if (!player.m_bDead && player.m_nHp > 0) return { ok: false, reason: 'not_dead' };

    if (type === 'SCROLL') return this.reviveScroll(player);
    return this.reviveLodestar(player);
  }

  /** `OnRevival` (0x00ff00c0) -- scroll revive in place. */
  private reviveScroll(player: CPlayer): RevivalOutcome {
    const slot = this.findScrollSlot(player);
    if (slot < 0) return { ok: false, reason: 'no_scroll' };
    const stack = player.m_Inventory[slot];
    if (stack === undefined || stack === null) return { ok: false, reason: 'no_scroll' };

    // WAL journal the slot's ABSOLUTE post-state before the client ack (rule
    // 04): either decremented stack or cleared slot. Idempotent -- the boot
    // replayer re-applies this exact slot contents if the consume persist lost
    // the race with a crash.
    const remaining = stack.count - 1;
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'INVENTORY_SLOT',
      payload: remaining > 0
        ? { slot, itemId: II_SYS_SYS_SCR_RESURRECTION, count: remaining }
        : { slot, itemId: 0, count: 0 },
    });
    this.consumeSlot(player, slot, stack);

    this.clearDeadState(player);
    this.restoreVitals(player);
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.revival.build(player.m_idPlayer, SNAPSHOTTYPE_REVIVAL),
    );
    return { ok: true };
  }

  /** `OnRevivalLodestar` (0x00ff00c1) -- town revive + exp penalty + teleport. */
  private reviveLodestar(player: CPlayer): RevivalOutcome {
    this.clearDeadState(player);

    // C++ `OnRevivalLodestar` calls `pUser->SubDieDecExp()` with NO arguments
    // (`DPSrvr.cpp:1106`), so `dwDestParam` defaults to 0 -- the full bracket
    // penalty. The recovery-pct modifier only ever comes from the Resurrection
    // skill's `nAdjParamVal2` on the accept path.
    this.applyDeathExpPenalty(player);

    this.restoreVitals(player);
    // Broadcast REVIVAL_TO_LODESTAR at the death vicinity BEFORE teleporting
    // (DPSrvr.cpp:1122 precedes the REPLACE at :1143) so peers who saw the death
    // play the revive animation before the player leaves their view.
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.revival.build(player.m_idPlayer, SNAPSHOTTYPE_REVIVAL_TO_LODESTAR),
    );
    this.teleportToRevival(player);
    return { ok: true };
  }

  private clearDeadState(player: CPlayer): void {
    player.m_bDead = false;
    // C++ `OnRevival` (`DPSrvr.cpp:993`) and `OnRevivalLodestar` (`:1094`) BOTH
    // open by clearing `m_Resurrection_Data.bUseing` -- picking a self-revive
    // voids any pending other-player resurrection offer. (The client also fires
    // RESURRECTION_CANCEL alongside the revival packet, `WndField.cpp:14286`;
    // clearing here makes the server independent of that.)
    player.m_resurrectionOffer = undefined;
    // ponytail: ClearState buffs when the buff system lands.
  }

  /**
   * `CMover::SubDieDecExp` tail -- subtract the death exp penalty, journal the
   * absolute post-state, ack the owner, persist. `recoveryPct` is the C++
   * `dwDestParam` (percentage of the penalty STILL applied; 0 = no modifier).
   * No-ops when the bracket loss rounds to nothing.
   */
  private applyDeathExpPenalty(player: CPlayer, recoveryPct = 0): void {
    const before = player.m_nExp;
    const pen = subDieDecExp(player.m_nLevel, player.m_nExp, recoveryPct);
    if (before - pen.exp <= 0) return;
    player.m_nExp = pen.exp;
    player._dirty.add('m_nExp');
    // WAL journal the ABSOLUTE post-state before the client ack (rule 04).
    // Idempotent -- the boot replayer re-applies (level, exp) if the
    // fire-and-forget persist below lost the race with a crash. m_nExp IS
    // the within-level value the DB + wire carry (no cumulative form).
    const exp = String(Math.floor(player.m_nExp));
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_EXP',
      payload: { level: player.m_nLevel, exp },
    });
    this.deps.playerManager.sendTo(player, this.setExp.build(player.m_idPlayer, {
      exp: player.m_nExp, level: player.m_nLevel,
    }));
    this.deps.charRepo.updateLevelAndExp(
      player.m_idPlayer, player.m_nLevel, BigInt(Math.floor(player.m_nExp)),
    ).catch((err: unknown) => { logger.error({ err, charId: player.m_idPlayer }, 'exp persist failed'); });
  }

  /**
   * `OnResurrectionCancel` (`DPSrvr.cpp:6868`) -- the dead player declined the
   * offer. Drops the pending state and nothing else: no reply packet, and the
   * player stays dead with `CWndRevival` still available.
   */
  cancelResurrection(player: CPlayer): ResurrectionOutcome {
    if (player.m_resurrectionOffer === undefined) return { ok: false, reason: 'no_offer' };
    player.m_resurrectionOffer = undefined;
    return { ok: true };
  }

  /**
   * `OnResurrectionOK` (`DPSrvr.cpp:6877-6916`) -- the dead player accepted.
   * Revives **in place**: SFX + bodyless RESURRECTION to the vicinity,
   * `OBJMSG_RESURRECTION` actmsg to take the model out of the corpse pose, then
   * the skill's DST_HP grant. Per C++:
   *  - the HP amount uses the **CASTER's** INT (`ApplyParam(pSrc, ...)`), not the
   *    target's -- the offer stores the caster id for exactly this;
   *  - **MP and FP are NOT restored** (no fRate path here, unlike `OnRevival*`);
   *  - **no position change**, no MOVERDEATH/REVIVAL snapshot, and no `m_nDead`
   *    5 s lockout (`OnRevival` sets that at `:1004`; this path does not);
   *  - the death exp penalty is applied HERE, scaled by the skill's
   *    `nAdjParamVal2`, and only when `dwDestParam2 == DST_RECOVERY_EXP`.
   *
   * ponytail: overheal credit to the caster (`m_nOverHeal = PROCESS_COUNT * 30`,
   * `MoverActEvent.cpp:419-425`) when the grant would leave the target below max.
   */
  acceptResurrection(player: CPlayer): ResurrectionOutcome {
    const offer = player.m_resurrectionOffer;
    if (offer === undefined) return { ok: false, reason: 'no_offer' };
    // `if( pUser->IsDie() == FALSE ) { bUseing = FALSE; return; }` (:6883)
    if (!player.m_bDead) {
      player.m_resurrectionOffer = undefined;
      return { ok: false, reason: 'not_dead' };
    }
    // `pSrc = prj.GetUserByID(pData->dwPlayerID); if( !IsValidObj(pSrc) ) { bUseing = FALSE; }`
    const caster = this.deps.playerManager.get(offer.casterId);
    if (caster === undefined) {
      player.m_resurrectionOffer = undefined;
      return { ok: false, reason: 'caster_gone' };
    }
    const skill = this.deps.skills?.skills.get(offer.skillId);
    const levelRow = skill?.levels.find((l) => l.level === offer.skillLevel);
    if (skill === undefined || levelRow === undefined) {
      player.m_resurrectionOffer = undefined;
      return { ok: false, reason: 'unknown_skill' };
    }

    player.m_resurrectionOffer = undefined;
    player.m_bDead = false;

    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      buildCreateSfxObj(player.m_idPlayer, XI_SKILL_ASS_HEAL_RESURRECTION01),
    );
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      buildResurrection(player.m_idPlayer),
    );
    this.deps.playerManager.sendTo(
      player, this.actMsg.build(player.m_idPlayer, OBJMSG_RESURRECTION, 0, 0),
    );

    // `ApplyParam(pSrc, pSkillProp, pAddSkillProp, TRUE, 0)` -- the DST_HP arm.
    // A dead mover is at 0 HP, so the grant IS the resulting HP (clamped to max).
    // Clamp against getMaxHp(), never the cached m_nMaxHp field (which omits gear
    // DST deltas).
    const inc = skillHealAmount(caster, skill, levelRow);
    player.m_nHp = Math.max(1, Math.min(player.getMaxHp(), inc));
    player._dirty.add('m_nHp');
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      buildSetPointParam(player.m_idPlayer, DST_HP, player.m_nHp),
    );

    // `if( pData->pAddSkillProp->dwDestParam2 == DST_RECOVERY_EXP )
    //      pUser->SubDieDecExp( TRUE, pData->pAddSkillProp->nAdjParamVal2 );`
    if (levelRow.destParams?.[1] === DST.RECOVERY_EXP) {
      this.applyDeathExpPenalty(player, levelRow.adjParamVals?.[1] ?? 0);
    }

    logger.info(
      { charId: player.m_idPlayer, casterId: caster.m_idPlayer, hp: player.m_nHp },
      'resurrection accepted',
    );
    return { ok: true };
  }

  /**
   * HP/MP restore on revive. Non-chaotic players get 0.2 * max (v19 default);
   * chaotic (PK) players get half that (0.1 * max) -- the PK death penalty.
   * ponytail: full DiePenalty.inc REVIVAL_PENALTY bracket table (level-based).
   */
  private restoreVitals(player: CPlayer): void {
    const rate = player.isChaotic() ? REVIVE_HP_RATE_CHAOTIC : REVIVE_HP_RATE;
    const hp = Math.floor(player.m_nMaxHp * rate);
    const mp = Math.floor(player.m_nMaxMp * rate);
    if (player.m_nHp < hp) { player.m_nHp = hp; player._dirty.add('m_nHp'); }
    if (player.m_nMp < mp) { player.m_nMp = mp; player._dirty.add('m_nMp'); }
  }

  /**
   * Same-world teleport to the zone's revival position via `SETPOS` -- the C++
   * `_replace` same-world branch (`World.cpp:1589-1604`). The client's `OnSetPos`
   * relocates the local player (ReadWorld + SetPos) WITHOUT nulling `g_pPlayer`,
   * so ticking UI windows stay safe.
   *
   * `REPLACE` would null `g_pPlayer` (`DPClient.cpp:2352`) and -- since we don't
   * re-send the player's own ADD_OBJ -- leave it null, crashing the first window
   * to deref it (`CWndQuestQuickInfo::Process:259`).
   * ponytail: cross-world teleports need REPLACE followed by self `AddAddObj`
   * to restore `g_pPlayer`; plus real `GetNearRevivalPos` nearest-point tables.
   */
  private teleportToRevival(player: CPlayer): void {
    const zone = this.deps.zones.byNumericId.get(player.m_nZoneId);
    const revivePos: Vec3 = zone?.revival.position ?? player.m_vPos;
    player.m_vPos = { ...revivePos };
    player._dirty.add('m_vPos');
    this.deps.playerManager.sendTo(player, this.setPos.build(player.m_idPlayer, revivePos));
    this.deps.visibilityService?.refresh(player.m_idPlayer, true);
  }

  private findScrollSlot(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      const s = player.m_Inventory[i];
      if (s && s.itemId === II_SYS_SYS_SCR_RESURRECTION) return i;
    }
    return -1;
  }

  private consumeSlot(player: CPlayer, slot: number, stack: { count: number }): void {
    if (stack.count > 1) {
      stack.count--;
      player._dirty.add('m_Inventory');
      this.deps.inventoryRepo.updateQuantity(player.m_idPlayer, slot, stack.count)
        .catch((err: unknown) => void err);
    } else {
      player.m_Inventory[slot] = null;
      player._dirty.add('m_Inventory');
      this.deps.inventoryRepo.removeItem(player.m_idPlayer, slot)
        .catch((err: unknown) => void err);
    }
  }
}
