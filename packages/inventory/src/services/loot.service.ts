/**
 * LootService -- the C++ `DoLoot` body + the dest-obj arrival trigger.
 *
 * v19 has NO dedicated pickup packet. To grab a ground pile the client clicks
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
 * `v19-isloot-anti-loot-steal`.
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
import { buildSetPointParam, DST_GOLD, buildQueryGetPos } from '@flyff/world-core';
import { NULL_ID, LOOT_FFA_MS, VISIBILITY_RADIUS } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'loot-service' });

/** `OBJMSG_PICKUP` (`_Common/MoverMsg.h:118`) -- pickup motion broadcast. */
const OBJMSG_PICKUP = 11;

/**
 * Poll cadence for the walk-to-pile position query, and how long to keep asking.
 *
 * The C++ server simulates the walk itself (`CMover::ProcessMove`) and so needs
 * no poll. We are client-authoritative for position, and while the client
 * auto-walks to a dest object it sends NO movement packet at all -- the walk is
 * driven entirely by its own `ProcessMove`. Without a poll the only arrival
 * check that ever runs is the one at `PLAYERSETDESTOBJ` time, so clicking a pile
 * you are not already standing on never loots ("pickup not proceeding").
 *
 * `SNAPSHOTTYPE_QUERYGETPOS` is the vanilla mechanism for exactly this
 * (`CMover::OnActDrop`, `MoverActEvent.cpp:2015`): ask the client to report its
 * position, and it answers `PACKETTYPE_GETPOS`, which lands in
 * `MovementService.applyGetPos` -> `checkArrival`.
 */
const WALK_POLL_MS = 250;
/** Give up after this long -- the client stopped short, or the player walked off. */
const WALK_POLL_TIMEOUT_MS = 15_000;


export interface LootServiceDeps {
  inventoryService: InventoryService;
  itemManager: ItemManager;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  /** Injector seam for tests. */
  createItemSerializer?: CreateItemSnapshotSerializer;
  /** Injector seam for tests; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Item-acquire client notification. Fired after a successful pickup so the
   * compose root can emit a `SNAPSHOTTYPE_TEXT` "you acquired X" chat line.
   * Emulator addition -- v19 C++ sends no item-name text on pickup, only
   * CREATEITEM + the pickup sound (see memory `v19-loot-quest-acquire-notice`).
   * Optional -- no-op in tests.
   */
  onAcquireItem?: (player: CPlayer, itemId: number, count: number) => void;
  /**
   * `CUser::AddGoldText` seam -- `CMover::PickupGoldCore` (`MoverEquip.cpp:2423`)
   * calls it right after a successful `AddGold`, so `total` is the post-add
   * balance. Wired in `compose.ts` to a `SNAPSHOTTYPE_DEFINEDTEXT`
   * (`TID_GAME_REAPMONEY`) emit. Optional -- no-op in tests.
   */
  onGoldPickup?: (player: CPlayer, plus: number, total: number) => void;
  /**
   * Optional party-share seam (wired to a `partyManager`-backed check in
   * `compose.ts`). When non-null, a party member may loot an owner-locked pile
   * before the {@link LOOT_FFA_MS} timeout. Keeps `@flyff/inventory` free of
   * any `@flyff/party` import (structural type -- closure satisfies the signature).
   */
  sameParty?: (a: number, b: number) => boolean;
  /**
   * Party distribution seam (wired to `PartyService` in `compose.ts`). Owns the
   * `SubLootDropMobParty` receiver pick, the `PickupGold` split, and the peer
   * notice list. Structural type -- `@flyff/inventory` never imports
   * `@flyff/party`. Absent (tests, solo-only builds) => the finder keeps
   * everything, which is the C++ no-party path.
   */
  party?: PartyLootShare;
  /**
   * `TID_GAME_TROUPEREAPITEM` peer notice (`MoverActEvent.cpp:2495`) -- tells
   * `peer` that `receiver` got the item. Only fired for distributed drops (the
   * receiver is not the finder). Optional -- no-op in tests.
   */
  onPeerAcquireItem?: (peer: CPlayer, receiver: CPlayer, itemId: number, count: number) => void;
}

/**
 * The party-distribution surface `LootService` needs. Implemented by
 * `PartyService` (`@flyff/party`); every method returns a "no party" answer
 * (`null` / `[]`) when the looter is not in one, so `LootService` needs no
 * membership check of its own.
 */
export interface PartyLootShare {
  /** Receiver for a distributed monster drop, or `null` = the finder keeps it. */
  pickItemReceiver(finder: CPlayer, dropMob: boolean): CPlayer | null;
  /** Per-member gold shares, or `null` = the finder takes the whole pile. */
  splitGold(finder: CPlayer, amount: number, dropMob: boolean): { player: CPlayer; amount: number }[] | null;
  /** Nearby party members to notify, excluding the receiver. */
  itemNoticePeers(finder: CPlayer, exclude: number): CPlayer[];
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
  /** Active walk-to-pile position polls, keyed by char id (rule 05 -- all cleared). */
  private readonly polls = new Map<number, NodeJS.Timeout>();
  constructor(private readonly deps: LootServiceDeps) {
    this.createItemSerializer = deps.createItemSerializer ?? new CreateItemSnapshotSerializer();
    this.now = deps.now ?? Date.now;
  }

  /**
   * Called from `MovementService.applySetDestObj`. Runs the immediate arrival
   * check (click a pile at your feet), and when the dest IS a live ground item
   * the player has not reached yet, starts polling the client for its position
   * so the arrival is detected during the client-driven auto-walk.
   */
  onSetDestObj(player: CPlayer): void {
    this.checkArrival(player);
    if (player.m_idDestObj === NULL_ID) return;              // looted on contact
    if (!this.deps.itemManager.get(player.m_idDestObj)) return; // monster/NPC dest
    this.startWalkPoll(player);
  }

  /** Clear a player's poll (disconnect, or the dest changed). */
  cancelWalkPoll(charId: number): void {
    const t = this.polls.get(charId);
    if (t) { clearInterval(t); this.polls.delete(charId); }
  }

  /** Clear every poll (world shutdown). */
  shutdown(): void {
    for (const t of this.polls.values()) clearInterval(t);
    this.polls.clear();
  }

  /**
   * Ask the client for its position every {@link WALK_POLL_MS} until it arrives
   * at the pile (or the dest/pile is gone, or {@link WALK_POLL_TIMEOUT_MS}).
   * Each reply is a `PACKETTYPE_GETPOS`, handled by `MovementService.applyGetPos`
   * which calls {@link checkArrival}.
   *
   * The timer holds `player.m_idPlayer`, not the `CPlayer`, and re-looks it up
   * through `PlayerManager` each tick so a disconnected player cannot be pinned
   * in memory by this interval (rule 05).
   */
  private startWalkPoll(player: CPlayer): void {
    const charId = player.m_idPlayer;
    this.cancelWalkPoll(charId);
    const deadline = this.now() + WALK_POLL_TIMEOUT_MS;
    const timer = setInterval(() => {
      const p = this.deps.playerManager.get(charId);
      if (!p || p.m_idDestObj === NULL_ID
        || !this.deps.itemManager.get(p.m_idDestObj)
        || this.now() > deadline) {
        this.cancelWalkPoll(charId);
        return;
      }
      // idFrom = NULL_ID: the client echoes it back as `objid` in GETPOS, and
      // `OnGetPos` (`DPSrvr.cpp:1463`) only treats the position as the sender's
      // own when `objid == NULL_ID`. Passing the char id instead would make
      // `applyGetPos` take the "report about another mover" branch and drop it.
      this.deps.playerManager.sendTo(p, buildQueryGetPos(charId, NULL_ID));
    }, WALK_POLL_MS);
    // Never keep the process alive for a pickup poll.
    timer.unref?.();
    this.polls.set(charId, timer);
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
    this.cancelWalkPoll(player.m_idPlayer);
    this.pickup(player, item);
  }

  /**
   * `DoLoot` (`MoverActEvent.cpp:2650`) -- ownership gate, then the gold vs item
   * split, each of which branches again on `m_bDropMob` (monster drop) and party
   * membership:
   *
   * - **Gold**, monster-dropped, in a party -> `PickupGold` party branch
   *   (`MoverEquip.cpp:2374`): split evenly among members within 32m, remainder
   *   to one random member. Ignores the item-share mode entirely.
   * - **Item**, monster-dropped, in a party -> `SubLootDropMobParty`
   *   (`MoverActEvent.cpp:2395`): the `m_nTroupeShareItem` mode picks WHICH
   *   member receives it (finder / sequential / leader / random), and the other
   *   nearby members get a "<name> got <item>" notice.
   * - Anything else (solo, or a pile a player dropped) -> the finder takes it.
   *
   * Bag-full on the receiver leaves the pile on the ground (C++ `bSuccess ==
   * FALSE` skips `pItem->Delete()`), so a full-bag receiver does not destroy the
   * drop.
   */
  pickup(player: CPlayer, item: GroundItem): void {
    if (!this.isLoot(player, item)) {
      logger.debug({ charId: player.m_idPlayer, itemId: item.m_dwItemId }, 'loot denied (owner-lock)');
      return;
    }
    logger.info(
      { charId: player.m_idPlayer, itemId: item.m_dwItemId, count: item.m_nItemNum, dropMob: item.m_bDropMob },
      'DoLoot pickup',
    );

    if (isGoldSeed(item.m_dwItemId)) {
      this.pickupGold(player, item);
      return;
    }

    // `SubLootDropMobParty` receiver pick. null = the finder keeps it (no party,
    // player-dropped pile, or the mode/range resolved back to the finder).
    const receiver = this.deps.party?.pickItemReceiver(player, item.m_bDropMob) ?? player;
    const r = this.deps.inventoryService.addItem(receiver, item.m_dwItemId, item.m_nItemNum);
    if (!r.ok) return; // bag_full -- ponytail: TID_GAME_LACKSPACE; pile stays lootable

    // Each change addresses the client's stable m_dwObjId (ch.objid), NOT the
    // slot index. OnCreateItem SetAtId(nId) + C++ Add nId = m_apIndex[i]
    // (Item.h:720) -- the drifted objid, which diverges from the slot after
    // an equip. Keying by slot lands a looted item in an equipped item's
    // cell (weapon-in-shield-slot bug).
    for (const ch of r.changes) {
      this.deps.playerManager.sendTo(
        receiver,
        ch.isNew
          ? this.createItemSerializer.buildOne(receiver.m_idPlayer, ch.itemId, ch.count, ch.objid)
          : buildUpdateItemCount(receiver.m_idPlayer, ch.objid, ch.count),
      );
    }
    this.deps.onAcquireItem?.(receiver, item.m_dwItemId, item.m_nItemNum);
    // `TID_GAME_TROUPEREAPITEM` peer notices (`MoverActEvent.cpp:2495`) -- the
    // other nearby members are told who got it. Without this a distributed drop
    // is silent for everyone but the receiver, and the party cannot tell the
    // sequential rotation from a lost drop.
    if (receiver.m_idPlayer !== player.m_idPlayer) {
      for (const peer of this.deps.party?.itemNoticePeers(player, receiver.m_idPlayer) ?? []) {
        this.deps.onPeerAcquireItem?.(peer, receiver, item.m_dwItemId, item.m_nItemNum);
      }
    }
    this.deps.itemManager.remove(item.m_idObject);
    this.motion(player);
  }

  /**
   * `CMover::PickupGold` (`MoverEquip.cpp:2366`). Party + monster-dropped gold is
   * split across nearby members; everything else goes wholly to the finder. Each
   * recipient gets their own `SETPOINTPARAM(DST_GOLD)` + gold text, matching the
   * per-member `PickupGoldCore` call.
   */
  private pickupGold(finder: CPlayer, item: GroundItem): void {
    const split = this.deps.party?.splitGold(finder, item.m_nItemNum, item.m_bDropMob);
    const shares = split ?? [{ player: finder, amount: item.m_nItemNum }];
    for (const { player, amount } of shares) {
      this.deps.inventoryService.addGold(player, amount);
      this.deps.playerManager.sendTo(
        player,
        buildSetPointParam(player.m_idPlayer, DST_GOLD, player.m_nGold),
      );
      // `PickupGoldCore`: AddGold first, then AddGoldText(nGold) -- so the
      // "(Total: N)" half is the already-updated balance.
      this.deps.onGoldPickup?.(player, amount, player.m_nGold);
    }
    this.deps.itemManager.remove(item.m_idObject);
    this.motion(finder);
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
   * a party member of the owner (via the injected `sameParty` seam), or
   * {@link LOOT_FFA_MS} has elapsed since `m_dwDropTime`.
   */
  private isLoot(player: CPlayer, item: GroundItem): boolean {
    if (item.m_idOwn === NULL_ID || item.m_idOwn === player.m_idPlayer) return true;
    if (this.deps.sameParty?.(player.m_idPlayer, item.m_idOwn)) return true;
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
