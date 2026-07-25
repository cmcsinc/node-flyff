/**
 * LootService -- the C++ `DoLoot` body + the dest-obj arrival trigger.
 *
 * v15 has NO dedicated pickup packet. To grab a ground pile the client clicks
 * it and sends only `PACKETTYPE_PLAYERSETDESTOBJ` (`CMD_SetUseItem` ->
 * `SetDestObj`, `_Common/MoverMsg.cpp:536`; wire `objid | float fRange`,
 * `fRange == 0.0` for a ground item). The server auto-loots in its own
 * movement tick when the player enters `m_fArrivalRange` of the pile:
 * `CMover::ProcessMove` (`MoverMove.cpp:421`) -> `IsRangeObj` ->
 * `ProcessMoveArrival` -> `OnArrive` (`Mover.cpp:4702`) ->
 * `CUser::OnMsgArrival` (`User.cpp:7040`) -> `DoLoot` (`User.cpp:7063`).
 *
 * This world server is client-authoritative for position, so
 * {@link LootService.checkArrival} runs on every accepted position update
 * (hooked from `MovementService`) instead of a server movement tick. The
 * `DoLoot` body is the same gold/item routing the (dead) ACTMSG/OBJMSG_PICKUP
 * handler implemented -- the client never sends ACTMSG for pickup; OBJMSG_PICKUP
 * is only a server->clients motion broadcast (`User.cpp:7067`). See memory
 * `v15-isloot-anti-loot-steal`.
 *
 * WAL-first (rule 03/04): `InventoryService` journals + mutates before
 * `checkArrival`/`pickup` send any ack snapshot.
 *
 * @module services/loot
 */

import type { InventoryService } from './inventory.service';
import type { ItemManager } from '../managers/item.manager';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { GroundItem } from '../entities/item';
import type { CPlayer, Vec3 } from '@flyff/entities';
import { isGoldSeed } from './drop.service';
import { CreateItemSnapshotSerializer } from '../net/snapshot/createItem.serializer';
import { ActMsgSerializer } from '../net/snapshot/actMsg.serializer';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';
import { buildSetPointParam, DST_GOLD } from '@flyff/world-core';
import { NULL_ID, LOOT_FFA_MS, VISIBILITY_RADIUS } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'loot-service' });

/** `OBJMSG_PICKUP` (`_Common/MoverMsg.h:118`) -- pickup motion broadcast. */
const OBJMSG_PICKUP = 11;

export interface LootServiceDeps {
  inventoryService: InventoryService;
  itemManager: ItemManager;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  /** Injector seam for tests. */
  createItemSerializer?: CreateItemSnapshotSerializer;
  /** Injector seam for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * `CObj::IsRangeObj` (`Obj.cpp:794`): a `0.0f` arrival range is promoted to
 * `1.0f`, then both objects' collision radii (`* 0.8`) are added. We do not
 * model mover/item radii; this flat contact allowance stands in for them so a
 * player the client walked onto the pile still satisfies the range check.
 * Generous on purpose -- the client's pathfinding stop point can land a couple
 * of units short of the item center, and a too-tight radius presents as
 * "standing on the drop but can't pick up".
 */
const ARRIVAL_CONTACT = 2.0;

export class LootService {
  private readonly createItemSerializer: CreateItemSnapshotSerializer;
  private readonly motionSerializer = new ActMsgSerializer();
  private readonly now: () => number;
  constructor(private readonly deps: LootServiceDeps) {
    this.createItemSerializer = deps.createItemSerializer ?? new CreateItemSnapshotSerializer();
    this.now = deps.now ?? Date.now;
  }

  /**
   * `CMover::ProcessMove` dest-obj arrival (`MoverMove.cpp:421`). When the
   * player is within their `m_fArrivalRange` of the dest pile, clear the dest
   * and run `DoLoot`. Called on every accepted position update (hooked from
   * `MovementService`) AND at `PLAYERSETDESTOBJ` time, so clicking a drop you
   * are already standing on loots immediately (no movement packets would
   * otherwise arrive to trigger the check).
   *
   * Only acts when the dest is a live ground item -- `m_idDestObj` is shared
   * with monster/NPC walk-to targets (melee, dialog), so a non-item dest is
   * left untouched. Mirrors `IsRangeObj`'s `fRange == 0 -> 1.0`.
   */
  checkArrival(player: CPlayer): void {
    const destObjid = player.m_idDestObj;
    if (destObjid === NULL_ID) return;
    const item = this.deps.itemManager.get(destObjid);
    if (!item) return; // dest is a monster/NPC, or the pile is gone -- not ours to clear
    const range = Math.max(player.m_fArrivalRange, 1.0) + ARRIVAL_CONTACT;
    // Horizontal (XZ) distance only -- ground piles are walked to on the terrain,
    // and the stored drop Y can differ from the player's Y at the same spot
    // (drop captures the mover's last Y; the client's reported Y is its own).
    // A 3D check is defeated by that height jitter even when the player is
    // standing on the pile, presenting as "can't loot".
    const dSq = distSqXZ(player.m_vPos, item.m_vPos);
    logger.debug(
      { charId: player.m_idPlayer, destObjid, itemId: item.m_dwItemId, dSq, maxSq: range * range },
      'loot arrival check',
    );
    if (dSq > range * range) return;

    // Arrived -- `ProcessMoveArrival` clears the dest before `OnArrive`->`DoLoot`.
    player.m_idDestObj = NULL_ID;
    player.m_fArrivalRange = 0;
    this.pickup(player, item);
  }

  /**
   * `DoLoot` (`MoverActEvent.cpp:2575`) -- ownership gate, then gold vs item
   * routing. Gold -> `addGold` + `SETPOINTPARAM(DST_GOLD)` self; item ->
   * `addItem` -> `CREATEITEM` (new slot) / `UPDATE_ITEM` (stack merge), bag-full
   * leaves the pile lootable. Either path removes the pile (broadcasts DEL_OBJ).
   */
  pickup(player: CPlayer, item: GroundItem): void {
    if (!this.isLoot(player, item)) {
      logger.debug({ charId: player.m_idPlayer, itemId: item.m_dwItemId }, 'loot denied (owner-lock)');
      return;
    }
    logger.info(
      { charId: player.m_idPlayer, itemId: item.m_dwItemId, count: item.m_nItemNum },
      'DoLoot pickup',
    );

    if (isGoldSeed(item.m_dwItemId)) {
      this.deps.inventoryService.addGold(player, item.m_nItemNum);
      this.deps.playerManager.sendTo(
        player,
        buildSetPointParam(player.m_idPlayer, DST_GOLD, player.m_nGold),
      );
      this.deps.itemManager.remove(item.m_idObject);
      this.motion(player);
      return;
    }

    const r = this.deps.inventoryService.addItem(player, item.m_dwItemId, item.m_nItemNum);
    if (!r.ok) return; // bag_full -- ponytail: TID_GAME_LACKSPACE; pile stays lootable

    // Stack merge -> UPDATE_ITEM nId is the merged slot's STABLE m_dwObjId, not
    // the slot index: client resolves via GetAtId(nId) (Mover.cpp:8528). A moved
    // stack's objid != slot, so the slot-index echo strands the count. New slot
    // -> CREATEITEM addresses by slot (SetAtId) so r.slot is correct there.
    this.deps.playerManager.sendTo(
      player,
      r.isNew
        ? this.createItemSerializer.buildOne(player.m_idPlayer, r.itemId, r.count, r.slot)
        : buildUpdateItemCount(player.m_idPlayer, player.m_Inventory?.[r.slot]?.objid ?? r.slot, r.count),
    );
    this.deps.itemManager.remove(item.m_idObject);
    this.motion(player);
  }

  /**
   * `g_UserMng.AddMotion(this, OBJMSG_PICKUP)` (`User.cpp:7067`) -- broadcast a
   * `SNAPSHOTTYPE_MOTION(OBJMSG_PICKUP)` to the looter + vicinity. The client's
   * `OnMotion` re-dispatches it as `SendActMsg`, which plays the pickup
   * bend-down animation + sound. Fires only on a successful `DoLoot`.
   */
  private motion(player: CPlayer): void {
    this.deps.zoneManager.broadcastAround(
      player.m_vPos,
      player.m_nZoneId,
      VISIBILITY_RADIUS,
      this.motionSerializer.buildMotion(player.m_idPlayer, OBJMSG_PICKUP),
    );
  }

  /**
   * `CMover::IsLoot` (`MoverActEvent.cpp:2193-2255`). A pile is lootable by
   * `player` when it has no owner (`m_idOwn == NULL_ID`), `player` IS the owner,
   * or {@link LOOT_FFA_MS} has elapsed since `m_dwDropTime`. ponytail:
   * same-`m_idparty` share + invalid-owner FFA -- add when parties ship.
   */
  private isLoot(player: CPlayer, item: GroundItem): boolean {
    if (item.m_idOwn === NULL_ID || item.m_idOwn === player.m_idPlayer) return true;
    return this.now() - item.m_dwDropTime >= LOOT_FFA_MS;
  }
}

/** Full 3-D squared distance (matches C++ `D3DXVec3LengthSq`). */
function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Horizontal (XZ) squared distance -- ground pickup ignores height. */
function distSqXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
