/**
 * ShopService -- NPC vendor shop open/close.
 *
 * Ports the gate logic of `CDPSrvr::OnOpenShopWnd` / `OnCloseShopWnd`
 * (`WORLDSERVER/DPSrvr.cpp:2744/2793`). Open resolves the vendor by objid,
 * checks it is a trade NPC (`m_abMoverMenu` carries `MMI_TRADE`), refuses while
 * the bank window or another interaction is open, and records the vendor as the
 * player's "other" (C++ `m_vtInfo.SetOther`). Close clears it.
 *
 * ponytail: BUYITEM/SELLITEM trade against `m_idOther`; one-interaction-at-a-time
 * busy gate stays off until those land (see existing comment in `open`).
 *
 * @module services/shop
 */

import { MMI_TRADE } from '@flyff/resources';
import type { SpawnManager } from '../managers/spawn.manager.js';
import type { CPlayer } from '../entities/player.js';
import type { VendorStock } from '../entities/mover.js';

export type ShopOpenResult =
  | { ok: true; vendorId: number; stock: VendorStock }
  | { ok: false; reason: 'invalid' | 'not_vendor' | 'busy' };

export class ShopService {
  constructor(private readonly deps: { spawnManager: SpawnManager }) {}

  /** Validate + open the vendor shop window for `player`. */
  open(player: CPlayer, vendorObjId: number): ShopOpenResult {
    if (!Number.isInteger(vendorObjId) || vendorObjId <= 0) return { ok: false, reason: 'invalid' };
    const vendor = this.deps.spawnManager.get(vendorObjId);
    if (!vendor) return { ok: false, reason: 'invalid' };
    // Monsters have no character.inc menus; only trade NPCs carry MMI_TRADE.
    if (!vendor.m_abMoverMenu.includes(MMI_TRADE)) return { ok: false, reason: 'not_vendor' };
    // C++ also refuses when another vendor is already open (`m_vtInfo.GetOther()`)
    // to prevent trade-window dupes. We intentionally do NOT: BUYITEM/SELLITEM are
    // not implemented yet (no dupe vector), and the v15 client does not always
    // send CLOSESHOPWND around the piercing/upgrade transition at a weapon shop
    // (SRT_WEAPON), which leaves `m_idOther` stuck and permanently locks the
    // player out of *every* shop until relog. Replacing the stale vendor self
    // heals that. Re-add `|| m_idOther !== null` to the busy gate when trade ships.
    // ponytail: restore one-interaction-at-a-time once BUYITEM/SELLITEM land.
    if (player.m_bBankOpen) return { ok: false, reason: 'busy' };

    player.m_idOther = vendor.m_idMover;
    return { ok: true, vendorId: vendor.m_idMover, stock: vendor.m_vendorStock };
  }

  /** Close the shop window (OnCloseShopWnd is bodyless -- just clear state). */
  close(player: CPlayer): void {
    player.m_idOther = null;
  }
}
