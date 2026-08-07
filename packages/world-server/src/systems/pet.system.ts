/**
 * PetSystem -- the looter ("EatPet") pet: summon, follow, auto-loot, dismiss.
 *
 * Port of `CAIPet` (`_AIInterface/AIPet.cpp`) plus the `CMover` toggle pair
 * `DoUseEatPet` / `ActivateEatPet` / `InactivateEatPet`
 * (`_Common/MoverSkill.cpp:4355-4450`).
 *
 * This is the `IK3_PET` pet, NOT the `IK3_EGG` "system pet". The two share only
 * the word: the looter has no level, exp, hunger, name, `CPet` object, or DB
 * state -- its entire persistent footprint is the inventory item. It is summoned
 * by `DOUSEITEM` on that item (there is no summon opcode), spawns as an ordinary
 * world mover of the item's `link_kind` (`dwLinkKind`, an `MI_PET_*`), and is
 * streamed to clients by the normal ADD_OBJ path. The egg pet's snapshots
 * (`SNAPSHOTTYPE_PET_*` 0x0110-0x0117) and the ADD_OBJ `dwPetId` field belong to
 * that other subsystem and stay zero-filled.
 *
 * **States** (`AIPet.cpp:13-28`, `MoveProcessIdle`):
 *   - **IDLE**: within {@link FOLLOW_TRIGGER} of the owner; nothing to do.
 *   - **TRACE**: walking to the owner. Entered when the gap exceeds
 *     {@link FOLLOW_TRIGGER}; emits ONE `MOVERSETDESTOBJ` so the client walks the
 *     pet after the *moving* owner objid, and leaves on arrival.
 *   - **LOOT**: a pile was found; emits ONE `DESTPOS` to the pile and picks it up
 *     on arrival, then immediately re-scans so pickups chain.
 *
 * **Wire model** mirrors `ai.system.ts`: server `m_vPos` is stepped every tick so
 * the distance gates are faithful, but a destination packet goes out only on a
 * state change -- the client owns the animation between them.
 *
 * Loot goes through `LootService.pickup(owner, pile)`, which is the owner's own
 * `DoLoot`. That is exactly what C++ does (`pOwner->DoLoot( pItem )`,
 * `AIPet.cpp:317`), so party distribution, penya splitting, acquire notices, and
 * WAL journalling all come along unchanged.
 *
 * ponytail: `SetItem`/`ResetItem` (`AIPet.cpp:427-457`) -- buff pets whose item
 * carries `dwActiveSkill` + the item's random-option DSTs. VisPet (`PET_VIS`
 * piercing + `SNAPSHOTTYPE_VISPET_ACTIVATE`). `m_lRespawn` skip -- our ground
 * piles never respawn, so that pet-only `IsLoot` filter has nothing to match.
 *
 * @module systems/pet
 */

import { createLogger } from '@flyff/core/logger';
import type { CMover, CPlayer, Vec3 } from '@flyff/entities';
import { NULL_ID, SPEED_SCALE } from '@flyff/entities';
import type { PlayerManager, SpawnManager, ZoneManager } from '@flyff/world-core';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import type { GroundItem, ItemManager, LootService, InventoryService } from '@flyff/inventory';
import { DestPosSerializer, DestObjSerializer } from '@flyff/combat';

const logger = createLogger({ module: 'pet-system' });

/** Movement/step cadence. Matches `ai.system.ts` (C++ ticks at 67 ms). */
const TICK_MS = 100;

/**
 * Ground-item scan cadence. C++ scans on `(GetCount() & 15) == 0` off the 67 ms
 * world tick (`AIPet.cpp:227`) -- 16 * 67 = 1072 ms. Replicated as wall-clock so
 * it is independent of our tick rate.
 */
const SCAN_INTERVAL_MS = 1072;

/**
 * Owner leash (`AIPet.cpp:110`, `NotOwnedPetInactivated:422`). Beyond 32 units
 * the pet stops scanning entirely, and `__REACTIVATE_EATPET` (`User.cpp:553`,
 * live at `__VER >= 15`) dismisses + immediately re-summons it at the owner --
 * the teleport catch-up. {@link resummon} is that path.
 */
const OWNER_LEASH = 32;

/** Pile search radius from the pet (`fDistSq < 15 * 15`, `AIPet.cpp:144`). */
const SCAN_RADIUS = 15;

/** Pickup radius re-checked on arrival (`fDistSq < 5.0f * 5.0f`, `AIPet.cpp:305`). */
const ARRIVAL_RADIUS = 5;

/** Owner gap that starts a follow (`fDistSq > 1.0f * 1.0f`, `AIPet.cpp:211`). */
const FOLLOW_TRIGGER = 1;

/** `TID_GAME_CANNOT_CALL_PET_ON_FLYING` (defineText.h:2241). */
export const TID_CANNOT_CALL_PET_ON_FLYING = 3210;

type PetState = 'idle' | 'trace' | 'loot';

/** Per-owner live pet record -- the `CAIPet` member set. */
interface PetRecord {
  /** The pet mover's objid (`CPlayer.m_oiEatPet`). */
  moverId: number;
  /** Inventory objid of the item that summoned it (`CAIPet::m_idPetItem`). */
  itemObjid: number;
  /** Mover id spawned, kept so {@link resummon} can rebuild the same pet. */
  linkKind: number;
  state: PetState;
  /** Target pile objid while in `loot` (`CAIPet::m_idLootItem`). */
  lootTarget: number;
  /** Next wall-clock ms a scan may run. */
  nextScanAt: number;
}

export interface PetSystemDeps {
  readonly playerManager: Pick<PlayerManager, 'get' | 'all'>;
  readonly zoneManager: ZoneManager;
  readonly spawnManager: Pick<SpawnManager, 'spawnMonster' | 'get' | 'kill'>;
  readonly itemManager: Pick<ItemManager, 'all' | 'get'>;
  readonly lootService: Pick<LootService, 'pickup' | 'isLoot'>;
  readonly inventoryService: Pick<InventoryService, 'canFit'>;
  /**
   * `pEatPet->Delete()` seam (`InactivateEatPet`, `MoverSkill.cpp:4437`). C++
   * `Delete()` removes the object from every client that knows it; our
   * `SpawnManager.kill(id, { despawn: false })` broadcasts NOTHING, so without
   * this the dismissed pet lives forever as a client-side model -- and every
   * leash re-summon stacks one more. Wired in `compose.ts` to
   * `VisibilityService.onMoverDespawn` (DEL_OBJ **and** `m_known.delete`, which a
   * bare `broadcastAll(buildRemoveObj)` would skip, blocking any later re-add).
   */
  readonly onDespawn?: (mover: CMover) => void;
  /** `AddDefinedText` seam -- refusal notices. Optional (no-op in tests). */
  readonly notify?: (player: CPlayer, tid: number) => void;
  /** Injector seam for tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

export class PetSystem {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private readonly pets = new Map<number, PetRecord>();
  private readonly dest = new DestPosSerializer();
  private readonly destObj = new DestObjSerializer();
  private readonly now: () => number;

  constructor(private readonly deps: PetSystemDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Begin the pet loop (idempotent). */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: TICK_MS }, 'PetSystem started');
    this.timer = setInterval(() => {
      try {
        this.tick(this.now());
      } catch (err) {
        logger.error({ err }, 'pet tick failed');
      }
    }, TICK_MS);
  }

  /** Stop the loop and despawn every live pet (idempotent). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const charId of [...this.pets.keys()]) {
      const owner = this.deps.playerManager.get(charId);
      if (owner) this.dismiss(owner);
      else this.forget(charId);
    }
  }

  /**
   * `CMover::DoUseEatPet` (`MoverSkill.cpp:4355`) -- the DOUSEITEM toggle. Note
   * C++ keys the dismiss branch on "ANY pet active", not on the item used, so
   * using pet B while pet A is out only dismisses A. Ported as-is.
   *
   * Returns true when the packet was consumed (so the caller must NOT fall
   * through to a consume path -- pet items are `bPermanence` and are never spent).
   */
  toggle(player: CPlayer, itemObjid: number, linkKind: number): boolean {
    if (player.m_oiEatPet !== NULL_ID) {
      this.dismiss(player);
      return true;
    }
    return this.summon(player, itemObjid, linkKind);
  }

  /**
   * `CMover::ActivateEatPet` (`MoverSkill.cpp:4374`). Guards: not flying
   * (`TID_GAME_CANNOT_CALL_PET_ON_FLYING`). The quiz-world guard has no analog
   * (no quiz world ported).
   */
  summon(player: CPlayer, itemObjid: number, linkKind: number): boolean {
    if (player.isFly()) {
      this.deps.notify?.(player, TID_CANNOT_CALL_PET_ON_FLYING);
      return false;
    }
    // Belt-and-braces against a stale record whose owner lost `m_oiEatPet`
    // (the mover-vanished branch in `tick`, a crash between the two writes):
    // `toggle` would then read NULL_ID and summon a SECOND live mover while the
    // first stayed in the map, unowned and unremovable.
    this.dismiss(player);
    const mover = this.deps.spawnManager.spawnMonster(linkKind, player.m_vPos, player.m_nZoneId);
    if (!mover) {
      logger.warn({ charId: player.m_idPlayer, linkKind }, 'pet summon failed -- unknown mover');
      return false;
    }
    player.m_oiEatPet = mover.m_idMover;
    this.pets.set(player.m_idPlayer, {
      moverId: mover.m_idMover,
      itemObjid,
      linkKind,
      state: 'idle',
      lootTarget: NULL_ID,
      nextScanAt: this.now() + SCAN_INTERVAL_MS,
    });
    logger.info({ charId: player.m_idPlayer, moverId: mover.m_idMover, linkKind }, 'pet summoned');
    return true;
  }

  /**
   * `CMover::InactivateEatPet` (`MoverSkill.cpp:4422`) -- delete + clear. The
   * `Delete()` half is {@link removeMover}: without a DEL_OBJ the model stays on
   * every client that saw the ADD_OBJ.
   */
  dismiss(player: CPlayer): void {
    const rec = this.pets.get(player.m_idPlayer);
    if (!rec) {
      player.m_oiEatPet = NULL_ID;
      return;
    }
    this.removeMover(rec.moverId);
    this.pets.delete(player.m_idPlayer);
    player.m_oiEatPet = NULL_ID;
    logger.info({ charId: player.m_idPlayer, moverId: rec.moverId }, 'pet dismissed');
  }

  /** Owner died (`NotOwnedPetInactivated`, `AIPet.cpp:415`) or logged out. */
  onOwnerGone(player: CPlayer): void {
    if (player.m_oiEatPet !== NULL_ID) this.dismiss(player);
  }

  /** Drop a record whose owner is already gone from the manager. */
  private forget(charId: number): void {
    const rec = this.pets.get(charId);
    if (rec) this.removeMover(rec.moverId);
    this.pets.delete(charId);
  }

  /**
   * `pEatPet->Delete()`. `{ despawn: false }` keeps `SpawnManager` from arming its
   * 10 s corpse timer (a pet has no corpse); the client removal is ours to send.
   */
  private removeMover(moverId: number): void {
    const mover = this.deps.spawnManager.get(moverId);
    this.deps.spawnManager.kill(moverId, { despawn: false });
    if (mover) this.deps.onDespawn?.(mover);
  }

  /** One pass over every live pet. Sync, no `await` (rule 05). */
  tick(now: number): void {
    const dtMs = this.lastTickMs === 0 ? TICK_MS : Math.min(200, Math.max(1, now - this.lastTickMs));
    this.lastTickMs = now;
    for (const [charId, rec] of [...this.pets]) {
      const owner = this.deps.playerManager.get(charId);
      if (!owner) { this.forget(charId); continue; }
      const mover = this.deps.spawnManager.get(rec.moverId);
      if (!mover) { this.pets.delete(charId); owner.m_oiEatPet = NULL_ID; continue; }
      // `NotOwnedPetInactivated` order: invalid owner, dead owner, then leash.
      if (owner.m_bDead) { this.dismiss(owner); continue; }
      if (distSq2(mover.m_vPos, owner.m_vPos) > OWNER_LEASH * OWNER_LEASH) {
        this.resummon(owner, rec);
        continue;
      }
      if (rec.state === 'loot') this.stepLoot(owner, rec, mover, now, dtMs);
      else this.stepFollow(owner, rec, mover, now, dtMs);
    }
  }

  /**
   * `__REACTIVATE_EATPET` (`User.cpp:553-573`): out past the leash, C++ dismisses
   * and replays the DOUSEITEM in the same pass, so the pet reappears at the owner.
   * Same DEL_OBJ + ADD_OBJ pair here.
   */
  private resummon(owner: CPlayer, rec: PetRecord): void {
    logger.debug({ charId: owner.m_idPlayer, moverId: rec.moverId }, 'pet past leash -- re-summoning');
    this.dismiss(owner);
    this.summon(owner, rec.itemObjid, rec.linkKind);
  }

  /**
   * `MoveProcessIdle` follow half (`AIPet.cpp:205-232`) plus the scan. IDLE ->
   * TRACE emits one `MOVERSETDESTOBJ` (follow the owner objid); TRACE -> IDLE on
   * arrival. The scan runs only while not already fetching a pile.
   */
  private stepFollow(owner: CPlayer, rec: PetRecord, mover: { m_vPos: Vec3; m_idMover: number; m_nZoneId: number; m_fSpeedBase: number }, now: number, dtMs: number): void {
    if (now >= rec.nextScanAt) {
      rec.nextScanAt = now + SCAN_INTERVAL_MS;
      if (this.scan(owner, rec, mover)) return;
    }
    const gapSq = distSq2(mover.m_vPos, owner.m_vPos);
    if (rec.state === 'idle') {
      if (gapSq <= FOLLOW_TRIGGER * FOLLOW_TRIGGER) return;
      rec.state = 'trace';
      this.broadcast(mover, this.destObj.build(mover.m_idMover, owner.m_idPlayer, FOLLOW_TRIGGER));
      return;
    }
    // TRACE: step toward the owner; arrival returns to IDLE.
    stepToward(mover, owner.m_vPos, mover.m_fSpeedBase, dtMs);
    if (distSq2(mover.m_vPos, owner.m_vPos) <= FOLLOW_TRIGGER * FOLLOW_TRIGGER) rec.state = 'idle';
  }

  /**
   * `SubItemLoot` (`AIPet.cpp:105-171`) -- find a pile the OWNER may loot and
   * start walking to it. Returns true when a target was acquired.
   *
   * Owner must be within the leash (checked by the caller) and not flying. Piles
   * are filtered by `LootService.isLoot(owner, pile)` -- the shared C++ predicate
   * -- plus the pet-only bag-full check (`MoverActEvent.cpp:2313`), which is why
   * a full-bag player's pet stands still instead of walking to piles forever.
   *
   * Divergence, deliberate: C++ never assigns `fMinDist` inside the loop
   * (`AIPet.cpp:115,144`), so its "nearest" is really the LAST qualifying pile in
   * link-map order. We pick the genuinely nearest -- the C++ line is a plain bug
   * with no observable behaviour worth reproducing. Logged in
   * `docs/c++-fidelity-audit.md`.
   */
  private scan(owner: CPlayer, rec: PetRecord, mover: { m_vPos: Vec3; m_idMover: number; m_nZoneId: number }): boolean {
    if (owner.isFly()) return false;
    let best: GroundItem | undefined;
    let bestSq = SCAN_RADIUS * SCAN_RADIUS;
    for (const pile of this.deps.itemManager.all()) {
      if (pile.m_nZoneId !== mover.m_nZoneId) continue;
      const d = distSq2(mover.m_vPos, pile.m_vPos);
      if (d >= bestSq) continue;
      if (!this.deps.lootService.isLoot(owner, pile)) continue;
      if (!this.deps.inventoryService.canFit(owner, pile.m_dwItemId, pile.m_nItemNum)) continue;
      best = pile;
      bestSq = d;
    }
    if (!best) return false;
    rec.state = 'loot';
    rec.lootTarget = best.m_idObject;
    this.broadcast(mover, this.dest.build(mover.m_idMover, { vPos: best.m_vPos, fForward: 1 }));
    return true;
  }

  /**
   * Walk to the acquired pile and loot on arrival (`StateIdle`/`AIMSG_ARRIVAL`,
   * `AIPet.cpp:288-326`). A pile that vanished mid-walk drops the target and
   * stops in place (`AIPet.cpp:235-253`); a successful pickup re-scans at once so
   * a drop cluster is cleared in one trip.
   */
  private stepLoot(owner: CPlayer, rec: PetRecord, mover: { m_vPos: Vec3; m_idMover: number; m_nZoneId: number; m_fSpeedBase: number }, now: number, dtMs: number): void {
    const pile = this.deps.itemManager.get(rec.lootTarget);
    if (!pile) {
      rec.state = 'idle';
      rec.lootTarget = NULL_ID;
      this.broadcast(mover, this.dest.build(mover.m_idMover, { vPos: mover.m_vPos, fForward: 1 }));
      return;
    }
    stepToward(mover, pile.m_vPos, mover.m_fSpeedBase, dtMs);
    if (distSq2(mover.m_vPos, pile.m_vPos) > ARRIVAL_RADIUS * ARRIVAL_RADIUS) return;
    this.deps.lootService.pickup(owner, pile);
    rec.state = 'idle';
    rec.lootTarget = NULL_ID;
    // C++ re-scans SYNCHRONOUSLY inside the same `AIMSG_ARRIVAL`
    // (`if( SubItemLoot() == FALSE ) { m_bLootMove = FALSE; ... }`,
    // `AIPet.cpp:317`), so a drop cluster is cleared in one trip with no idle
    // gap. Deferring to the next tick's `stepFollow` scan let the follow half
    // pull the pet back toward the owner between piles.
    rec.nextScanAt = now + SCAN_INTERVAL_MS;
    this.scan(owner, rec, mover);
  }

  private broadcast(mover: { m_vPos: Vec3; m_nZoneId: number }, packet: Buffer): void {
    this.deps.zoneManager.broadcastAround(mover.m_vPos, mover.m_nZoneId, VISIBILITY_RADIUS, packet);
  }
}

/** Step `m.m_vPos` toward `dest` on the ground plane. Mirrors `ai.system.ts`. */
function stepToward(m: { m_vPos: Vec3 }, dest: Vec3, fSpeed: number, dtMs: number): void {
  if (fSpeed <= 0) return;
  const dx = dest.x - m.m_vPos.x;
  const dz = dest.z - m.m_vPos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const step = fSpeed * SPEED_SCALE * (dtMs / 1000);
  if (step >= d) {
    m.m_vPos = { x: dest.x, y: m.m_vPos.y, z: dest.z };
  } else {
    m.m_vPos = { x: m.m_vPos.x + (dx / d) * step, y: m.m_vPos.y, z: m.m_vPos.z + (dz / d) * step };
  }
}

/** Ground-plane (x/z) squared distance. */
function distSq2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
