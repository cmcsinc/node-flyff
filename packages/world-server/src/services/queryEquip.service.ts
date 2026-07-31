/**
 * QueryEquipService -- `PACKETTYPE_QUERYEQUIP` (0xf000d009) +
 * `PACKETTYPE_QUERYEQUIPSETTING` (0xf000d00a).
 *
 * `DPSrvr::OnQueryEquip` (`WORLDSERVER/DPSrvr.cpp:7128`):
 *
 *   ar >> objid;
 *   CUser* pUser    = g_UserMng.GetUser(...);
 *   CUser* pUsertmp = prj.GetUser( objid );
 *   if( IsValidObj( pUsertmp ) ) {
 *     if( pUsertmp->IsMode( EQUIP_DENIAL_MODE )
 *         && pUser->IsAuthHigher( AUTH_GAMEMASTER ) == FALSE ) {
 *       pUser->AddDefinedText( TID_DIAG_0088 );  // arg-less form -> 0x0094
 *       return;
 *     }
 *     pUser->AddQueryEquip( pUsertmp );
 *   }
 *
 * `OnQueryEquipSetting` (DPSrvr.cpp:7150) reads `BOOL bAllow`: TRUE clears
 * `EQUIP_DENIAL_MODE`, FALSE sets it, then `AddModifyMode` broadcasts the new
 * `m_dwMode`. This is the client's "let others inspect my gear" option.
 *
 * **Deliberate hardening (rule 03):** C++ indexes the client's
 * `aEquipInfoAdd[nParts]` with the wire-supplied `nParts` unchecked -- a
 * malicious server could write off the end of a client stack array. We only
 * ever emit `0 <= nParts < MAX_HUMAN_PARTS`, which the loop bound guarantees.
 *
 * Read-only: no WAL (rule 04). QUERYEQUIPSETTING mutates only the transient
 * `m_dwMode` bit, which C++ also leaves unpersisted.
 *
 * @module services/queryEquip.service
 */

import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { AUTH, hasAuthority, MODE, MAX_HUMAN_PARTS, MAX_INVENTORY } from '@flyff/entities';
import { QueryEquipSerializer, type QueryEquipEntry } from '../net/snapshot/queryEquip.serializer';
import { ModifyModeSerializer } from '../net/snapshot/modifyMode.serializer';
import { buildDefinedText1 } from '../net/snapshot/notice.serializer';

/** `TID_DIAG_0088` (`game/resource/defineText.h:1762`) -- "cannot view equipment". */
export const TID_DIAG_0088 = 2673;

export interface QueryEquipServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
}

export type QueryEquipOutcome =
  | { ok: true; parts: number }
  | { ok: false; reason: 'not-found' | 'denied' };

export class QueryEquipService {
  private readonly serializer = new QueryEquipSerializer();
  private readonly modeSerializer = new ModifyModeSerializer();
  constructor(private readonly deps: QueryEquipServiceDeps) {}

  /** Reply to `player` with `targetObjid`'s per-slot refine/awaken state. */
  queryEquip(player: CPlayer, targetObjid: number): QueryEquipOutcome {
    const target = this.deps.playerManager.get(targetObjid);
    if (!target) return { ok: false, reason: 'not-found' };

    // EQUIP_DENIAL_MODE blocks everyone below GM (DPSrvr.cpp:7137).
    if ((target.m_dwMode & MODE.EQUIP_DENIAL) !== 0
      && !hasAuthority(player.m_bAuthority, AUTH.GAMEMASTER)) {
      this.deps.playerManager.sendTo(player, buildDefinedText1(player.m_idPlayer, TID_DIAG_0088));
      return { ok: false, reason: 'denied' };
    }

    const entries = collectEquipEntries(target);
    this.deps.playerManager.sendTo(player, this.serializer.build(target.m_idPlayer, entries));
    return { ok: true, parts: entries.length };
  }

  /** Toggle the inspect-permission bit and broadcast the new mode to peers. */
  setAllowInspect(player: CPlayer, allow: boolean): void {
    if (allow) player.m_dwMode &= ~MODE.EQUIP_DENIAL;
    else player.m_dwMode |= MODE.EQUIP_DENIAL;
    const packet = this.modeSerializer.build(player.m_idPlayer, player.m_dwMode);
    this.deps.zoneManager.broadcastAround(player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet);
  }
}

/**
 * Walk the 31 equip parts and emit one entry per occupied slot, mirroring the
 * `GetEquipItem( i )` loop. Our equip parts live at the tail of the flat
 * `m_Inventory` array (`MAX_INVENTORY + i`) -- see `slots.ts`.
 */
function collectEquipEntries(target: CPlayer): QueryEquipEntry[] {
  const entries: QueryEquipEntry[] = [];
  for (let i = 0; i < MAX_HUMAN_PARTS; i++) {
    const eq = target.m_Inventory[MAX_INVENTORY + i];
    if (!eq) continue;
    entries.push({
      nParts: i,
      // ponytail: awakening (`m_iRandomOptItemId`) is not modelled -- 0 = none.
      randomOptItemId: 0,
      itemResist: eq.element ?? 0,
      resistAbilityOption: eq.element_level ?? 0,
    });
  }
  return entries;
}
