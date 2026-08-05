/**
 * PartyService -- the v19 solo-party state machine + shared EXP split.
 *
 * Mirrors the consent half of `CDPSrvr::OnAddPartyMember/OnRemovePartyMember/
 * OnPartyChangeLeader` (DPSrvr.cpp:790-962) + `CDPCacheSrvr` party routing
 * (DPCacheSrvr.cpp). Real Flyff round-trips party state via CoreServer; this
 * emulator is single-world so all members live in one `PlayerManager` and the
 * CoreServer hops collapse to direct in-process calls.
 *
 * Sends: every notification is a member-loop `playerManager.sendTo` (no
 * `broadcastAround` helper fits -- a roster can span zones). Party chat, the
 * full roster broadcast (PARTYMEMBER), the leader-change notice, and the
 * invite popup/cancel all flow through here.
 *
 * ponytail: guild-party (`m_nKindTroup=1` + party name + level/exp bar +
 * contribution mode + party skills), party-duel, round-robin item distribution,
 * party finder, party map ping, mute check on party chat.
 *
 * Persistence: rosters ARE durable here (migration `022`) -- a logout marks the
 * member offline via {@link PartyService.onDisconnect} and {@link PartyService.onJoin}
 * restores them, which diverges from C++ where a CoreServer restart destroys
 * every party. See the `PartyManager` module comment for the full divergence.
 *
 * @module services/party
 */

import type { CPlayer, CMover } from '@flyff/entities';
import { EXP_TABLE, expPartyReduceFactor } from '@flyff/entities';
import { NULL_ID } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import {
  buildPartyMember, buildPartyRequest, buildPartyRequestCancel,
  buildPartyChangeLeader, buildPartyChat, PARTY_NO_DUEL,
  buildSetNaviPoint, buildPartyExp,
  buildPartyChangeItemMode, buildPartyChangeExpMode, buildPartyChangeTroup,
  buildSetPartyMemberParam, PP_REMOVE,
  type PartySnapshotState,
} from '@flyff/world-core';
import {
  PartyManager, PARTY_INVITE_TIMEOUT_MS,
  PARTY_ITEM_MODE_SEQUENTIAL, PARTY_ITEM_MODE_LEADER, PARTY_ITEM_MODE_RANDOM,
  PARTY_ITEM_MODE_MAX, PARTY_EXP_MODE_CONTRIBUTION,
  PARTY_KIND_SOLO, MAX_PARTY_NAME_LEN,
} from '../managers/party.manager';
import { createLogger } from '@flyff/core/logger';
import type { Party } from '../managers/party.manager';

const logger = createLogger({ module: 'party-service' });

/** Shared-EXP proximity gate -- members within 64m of the dead mover share. */
const PARTY_EXP_PROXIMITY = 64;
/**
 * Item/gold distribution proximity -- `IsValidArea(pMember, 32.0f)` in
 * `SubLootDropMobParty` (`MoverActEvent.cpp:2424`) and `PickupGold`
 * (`MoverEquip.cpp:2378`). Tighter than the 64m exp radius, and measured from
 * the LOOTING member (C++ `this`), not from the corpse.
 */
const PARTY_ITEM_PROXIMITY = 32;
/**
 * Level band: `GetPartyMemberFind` computes `nMaxLevel10 = max(0, maxLv - 20)`
 * and each split branch pays only members with `level > nMaxLevel10`.
 */
const PARTY_EXP_LEVEL_BAND = 20;
/** `fAddExp = fExpValue * 0.2 * (nMemberSize - 1)` (Mover.cpp:6612). */
const PARTY_EXP_BONUS_PER_MEMBER = 0.2;
/**
 * Party-LEVEL exp gate: `(nTotalLevel / nMemberSize) - nDeadLevel < 5`
 * (`CParty::GetPoint`, `party.cpp:268`). Unrelated to
 * {@link PARTY_EXP_LEVEL_BAND}, which gates per-MEMBER exp.
 */
const PARTY_LEVEL_EXP_BAND = 5;

export interface PartyServiceDeps {
  playerManager: PlayerManager;
  partyManager: PartyManager;
  /**
   * Per-player exp applier -- delegates to `CombatService.grantExpAmount` so
   * there is ONE exp-application code path (within-level addExp cascade +
   * WAL + SETEXPERIENCE + SETLEVEL + persist). Structural type -- closure
   * satisfies the signature, keeps party free of any `@flyff/combat` import.
   */
  grantExpAmount: (player: CPlayer, amount: number) => void;
  /**
   * `s_fPartyExpRate` (`CoreServer.cpp:546`, the CoreServer ini's
   * `PartyExpRate`) -- multiplier on party-LEVEL exp only, NOT on the member
   * exp split. A thunk so a runtime rate change takes effect on the next kill
   * (same pattern as `DropService.rates`). Defaults to 1.0.
   */
  partyExpRate?: () => number;
  /** Injector seam for tests. */
  now?: () => number;
  /** `[0,1)` source for the random/remainder picks. Injector seam for tests. */
  random?: () => number;
}

export class PartyService {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly partyExpRate: () => number;
  constructor(private readonly deps: PartyServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.partyExpRate = deps.partyExpRate ?? ((): number => 1.0);
  }

  /**
   * Leader invites `memberId`. Guards: requester is the leader of an existing
   * party (or solo with no party yet), party not full (<8), target not already
   * in a party, no pending invite on target. Sends PARTYREQEST popup to target.
   */
  invite(leader: CPlayer, memberId: number): void {
    if (leader.m_idPlayer === memberId) return;
    if (this.deps.partyManager.hasPending(memberId)) return;
    const existing = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (existing && existing.members[0] !== leader.m_idPlayer) return; // not leader
    if (existing && existing.members.length >= 8) return;
    const target = this.deps.playerManager.get(memberId);
    if (!target) return;
    if (this.deps.partyManager.getByMember(memberId)) return;
    const timer = setTimeout(() => this.expireInvite(memberId), PARTY_INVITE_TIMEOUT_MS);
    this.deps.partyManager.addPending({
      leaderId: leader.m_idPlayer, memberId, expiresAt: this.now() + PARTY_INVITE_TIMEOUT_MS, timer,
    });
    this.deps.playerManager.sendTo(target, buildPartyRequest(
      target.m_idPlayer,
      leader.m_idPlayer, leader.m_nLevel, leader.m_nJob, leader.m_nSex,
      target.m_idPlayer, target.m_nLevel, target.m_nJob, target.m_nSex,
      leader.m_szName, 0,
    ));
  }

  /** Auto-expire the pending invite (30s elapsed). */
  private expireInvite(memberId: number): void {
    const p = this.deps.partyManager.removePending(memberId);
    if (!p) return;
    const leader = this.deps.playerManager.get(p.leaderId);
    if (leader) {
      this.deps.playerManager.sendTo(leader, buildPartyRequestCancel(leader.m_idPlayer, p.leaderId, memberId, 0));
    }
  }

  /**
   * Target accepts the pending invite from `leaderId`. Creates a fresh party
   * (2 members) if the leader had none, else `addMember`. Sets `m_idParty` on
   * every member and broadcasts the full PARTYMEMBER roster to each.
   */
  accept(member: CPlayer, leaderId: number): void {
    const p = this.deps.partyManager.getPending(member.m_idPlayer);
    if (!p || p.leaderId !== leaderId) return;
    const leader = this.deps.playerManager.get(leaderId);
    if (!leader) { this.deps.partyManager.removePending(member.m_idPlayer); return; }
    this.deps.partyManager.removePending(member.m_idPlayer);
    let party = this.deps.partyManager.getByMember(leaderId);
    if (!party) {
      party = this.deps.partyManager.create(leaderId, member.m_idPlayer);
    } else {
      const added = this.deps.partyManager.addMember(party.id, member.m_idPlayer);
      if (!added) return;
      party = added;
    }
    leader.m_idParty = party.id;
    member.m_idParty = party.id;
    this.broadcastRoster(party, leader, member);
  }

  /** Target declines. Clear pending + PARTYREQESTCANCEL(nMode=0) to leader. */
  decline(member: CPlayer): void {
    const p = this.deps.partyManager.removePending(member.m_idPlayer);
    if (!p) return;
    const leader = this.deps.playerManager.get(p.leaderId);
    if (leader) {
      this.deps.playerManager.sendTo(
        leader, buildPartyRequestCancel(leader.m_idPlayer, p.leaderId, member.m_idPlayer, 0),
      );
    }
  }

  /**
   * Leave (requester==target) or kick (requester is leader). On the leader
   * leaving, auto-promote `members[0]`. Below 2 members -> disband (clear
   * `m_idParty` on remaining + send empty PARTYMEMBER).
   */
  leaveOrKick(requester: CPlayer, targetId: number): void {
    const party = this.deps.partyManager.getByMember(requester.m_idPlayer);
    if (!party) return;
    const wasRequesterLeader = party.members[0] === requester.m_idPlayer;
    if (requester.m_idPlayer !== targetId && !wasRequesterLeader) return; // kick = leader-only
    const target = this.deps.playerManager.get(targetId);
    const wasTargetLeader = party.members[0] === targetId;
    // Names must be captured BEFORE the removal -- once the target is spliced
    // out, members[0] is a different player.
    const leaderName = this.deps.playerManager.get(party.members[0])?.m_szName ?? '';
    const targetName = target?.m_szName ?? '';
    const res = this.deps.partyManager.removeMember(party.id, targetId);
    if (target) target.m_idParty = NULL_ID;
    if (!res.party) return;
    // C++ OnRemovePartyMember sends `pRemovd->AddPartyMember(NULL, idMember)` to
    // the leaver/kicked player in BOTH branches -- an empty PARTYMEMBER that
    // tears down their party window. Without it the removed player stays "in"
    // the party client-side. The removed target is no longer in
    // res.party.members, so the loops below never reach them.
    if (target) this.notifyRemoved(target, leaderName);
    if (res.disbanded) {
      this.notifyDisband(res.party, leaderName, targetName);
      return;
    }
    if (wasTargetLeader) {
      // Leader left -> members[0] is already the auto-promoted new leader.
      const newLeaderId = res.party.members[0];
      this.broadcastAddPartyChangeLeader(res.party, newLeaderId);
    }
    this.broadcastRosterOnly(res.party, targetId, targetName);
  }

  /**
   * Leader-only: promote `targetId` into slot 0 + ADDPARTYCHANGELEADER to every
   * member. Ports `CDPCoreClient::OnPartyChangeLeader` (`DPCoreClient.cpp:2841`),
   * which sends ONLY the leader-change notice -- the client's
   * `OnPartyChangeLeader` calls `g_Party.ChangeLeader` itself, so a roster
   * resend is not part of the C++ path (and would re-run the join/leave message
   * branch in `OnAddPartyMember` with a stale size).
   */
  changeLeader(leader: CPlayer, targetId: number): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    if (targetId === leader.m_idPlayer) return; // already the leader
    const updated = this.deps.partyManager.promoteLeader(party.id, targetId);
    if (!updated) return;
    this.broadcastAddPartyChangeLeader(updated, targetId);
  }

  /**
   * Leader-only: change exp share mode (`OnPartyChangeExpMode`,
   * `DPCoreClient.cpp:1254`). Echoes `SNAPSHOTTYPE_PARTYCHANGEEXPMODE` to every
   * member -- that snapshot is what the client assigns into
   * `g_Party.m_nTroupsShareExp`; a roster resend does not update the radio.
   *
   * Mode is range-checked: only 0 (level split) and 1 (contribution) exist, and
   * contribution is guild-party-only in C++, so it is accepted + echoed but the
   * level split still runs (see {@link distributeExp}).
   */
  changeExpMode(leader: CPlayer, mode: number): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    if (mode < 0 || mode > PARTY_EXP_MODE_CONTRIBUTION) return;
    this.deps.partyManager.setExpMode(party.id, mode);
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (p) this.deps.playerManager.sendTo(p, buildPartyChangeExpMode(p.m_idPlayer, mode));
    }
  }

  /**
   * Leader-only: change item share mode (`OnPartyChangeItemMode`,
   * `DPCoreClient.cpp:1234`) -- 0 finder / 1 sequential / 2 leader / 3 random.
   * Echoes `SNAPSHOTTYPE_PARTYCHANGEITEMMODE` to every member (see
   * {@link changeExpMode} on why the roster resend is not enough).
   */
  changeItemMode(leader: CPlayer, mode: number): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    if (mode < 0 || mode > PARTY_ITEM_MODE_MAX) return;
    this.deps.partyManager.setItemMode(party.id, mode);
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (p) this.deps.playerManager.sendTo(p, buildPartyChangeItemMode(p.m_idPlayer, mode));
    }
  }

  /**
   * CHANGETROUP -- "advance party" (solo party -> troupe). Ports
   * `CDPCoreClient::OnPartyChangeTroup` (`DPCoreClient.cpp:1348`): set
   * `m_nKindTroup = 1`, store the name, then `AddPartyChangeTroup(m_sParty)` to
   * EVERY member. The client gates the button on `m_nKindTroup == 0`
   * (`WndParty.cpp:376`) so a second advance is a no-op here too.
   *
   * The name arrives from `CWndPartyChangeTroup` (`WndPartyChangeTroup.cpp:167`),
   * which already rejects invalid/reserved names client-side; we still bound the
   * length (rule 03 -- never trust the client).
   */
  changeTroup(leader: CPlayer, name: string): void {
    const party = this.deps.partyManager.getByMember(leader.m_idPlayer);
    if (!party || party.members[0] !== leader.m_idPlayer) return;
    if (party.kindTroup !== PARTY_KIND_SOLO) return; // already a troupe -- one-way
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PARTY_NAME_LEN) return;
    const updated = this.deps.partyManager.advanceToTroupe(party.id, trimmed);
    if (!updated) return;
    for (const id of updated.members) {
      const p = this.deps.playerManager.get(id);
      if (p) this.deps.playerManager.sendTo(p, buildPartyChangeTroup(p.m_idPlayer, updated.name));
    }
  }

  /** Member-loop PARTYCHAT to every party member. ponytail: mute check. */
  chat(sender: CPlayer, msg: string): void {
    const party = this.deps.partyManager.getByMember(sender.m_idPlayer);
    if (!party) return;
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (p) this.deps.playerManager.sendTo(p, buildPartyChat(p.m_idPlayer, sender.m_szName, msg, sender.m_idPlayer));
    }
  }

  /**
   * SETNAVIPOINT -- navigator map ping. Ports `CDPSrvr::OnSetNaviPoint`
   * (DPSrvr.cpp:6641) exactly:
   *   - `targetId === NULL_ID` -> fan out to every member of the pinger's
   *     party (nothing happens if they have no party; the client already gates
   *     this branch on `g_Party.IsMember`).
   *   - otherwise -> a direct ping at one focused player: BOTH the pinger and
   *     that player get the marker, regardless of party membership.
   * The marker record's objid is the PINGER's id in both branches.
   */
  naviPoint(sender: CPlayer, pos: { x: number; y: number; z: number }, targetId: number): void {
    const marker = (): Buffer => buildSetNaviPoint(sender.m_idPlayer, pos, sender.m_szName);
    if (targetId === NULL_ID) {
      const party = this.deps.partyManager.getByMember(sender.m_idPlayer);
      if (!party) return;
      for (const id of party.members) {
        const p = this.deps.playerManager.get(id);
        if (p) this.deps.playerManager.sendTo(p, marker());
      }
      return;
    }
    const target = this.deps.playerManager.get(targetId);
    if (!target) return;
    this.deps.playerManager.sendTo(sender, marker());
    if (target.m_idPlayer !== sender.m_idPlayer) this.deps.playerManager.sendTo(target, marker());
  }

  /**
   * Disconnect seam -- clear pending invites, mark the member OFFLINE, and hand
   * leadership over if they were the leader.
   *
   * Ports `CPartyMng::RemoveConnection` (`party.cpp:1199`): the member stays on
   * the roster with `m_bRemove = TRUE`, every member gets the PP_REMOVE delta
   * (`nVal = 1`), and a departing leader is swapped out for the first
   * still-online member. It diverges in one place -- C++ deletes a party whose
   * every member is now offline (`:1259`); here it persists, so the roster is
   * still there when someone logs back in ({@link onJoin} resends it).
   *
   * The caller passes the live player because `m_idParty` must be read before
   * the join service drops them from `PlayerManager`. `m_idParty` is deliberately
   * NOT cleared: it is persisted membership now, not session state.
   */
  onDisconnect(player: CPlayer): void {
    const res = this.deps.partyManager.onDisconnect(player.m_idPlayer);
    if (!res.party) return;
    const party = res.party;
    // Leader left -> promote the first member who is still online. Silent no-op
    // when nobody else is on (the party sits leaderless-but-intact until the
    // next login, exactly as the persisted slot order says).
    if (res.wasLeader) {
      const heir = party.members.find(
        (id) => id !== player.m_idPlayer && this.deps.playerManager.get(id) !== undefined,
      );
      if (heir !== undefined) {
        const promoted = this.deps.partyManager.promoteLeader(party.id, heir);
        if (promoted) this.broadcastAddPartyChangeLeader(promoted, heir);
      }
    }
    // PP_REMOVE(1) to every member still online. The leaver's own socket is
    // already gone, and `sendTo` only reaches players in PlayerManager, so the
    // loop naturally skips them.
    this.broadcastMemberOffline(party, player.m_idPlayer, true);
  }

  /**
   * JOIN seam -- re-push the full roster to a returning member and tell the rest
   * of the party they are back.
   *
   * Both halves are required. C++'s `AddConnection` (`party.cpp:1173`) only
   * broadcasts `ADDPLAYERPARTY` -> PP_REMOVE(0) because the *returning* client
   * gets its roster from `CUser::AddPartyMember` on character load
   * (`DPDatabaseClient.cpp:1075`). We do that same roster push here rather than
   * in the join handler so both halves stay in one place.
   *
   * Returns false when the player is in no party (nothing sent), which also
   * clears a stale `m_idParty` -- the C++ `pPlayer->m_uPartyId = 0` fallback at
   * `party.cpp:1196` for an id that no longer resolves.
   */
  onJoin(player: CPlayer): boolean {
    const party = this.deps.partyManager.getByMember(player.m_idPlayer);
    if (!party) {
      player.m_idParty = NULL_ID;
      return false;
    }
    player.m_idParty = party.id;
    const leaderName = this.deps.playerManager.get(party.members[0])?.m_szName ?? '';
    // Full roster to the returning member. `affectedPlayerId` is themself, the
    // C++ `idMember` argument, and the size is unchanged so the client prints no
    // join/leave line -- it just rebuilds `g_Party`.
    this.deps.playerManager.sendTo(player, buildPartyMember(
      player.m_idPlayer, player.m_idPlayer, leaderName, player.m_szName, this.snapshot(party),
    ));
    // "<name> is back online" to everyone else.
    this.broadcastMemberOffline(party, player.m_idPlayer, false);
    return true;
  }

  /**
   * PP_REMOVE fan-out -- `AddSetPartyMemberParam(idPlayer, PP_REMOVE, nVal)` to
   * every ONLINE member except `idPlayer` themself (whose socket is either gone,
   * on disconnect, or already got the full roster, on join).
   */
  private broadcastMemberOffline(party: Party, idPlayer: number, offline: boolean): void {
    for (const id of party.members) {
      if (id === idPlayer) continue;
      const p = this.deps.playerManager.get(id);
      if (p) {
        this.deps.playerManager.sendTo(
          p, buildSetPartyMemberParam(p.m_idPlayer, idPlayer, PP_REMOVE, offline ? 1 : 0),
        );
      }
    }
  }

  /**
   * `AddExperienceParty` -> `AddExperiencePartyLevel` (`Mover.cpp:6470/6607`),
   * with the nearby-member scan of `GetPartyMemberFind` (`Mover.cpp:6261`).
   *
   * `baseExp` is the ATTACKER's hit-share of the mover's raw `nExpValue`
   * (pooled across same-party attackers by `AddExperienceKillMember`), with NO
   * level multiplier applied yet -- party kills use their own reduce curve
   * ({@link expPartyReduceFactor}) keyed on the highest NEARBY member's level,
   * not the solo `expLevelDiffMult` keyed on the killer's.
   *
   * Faithful order of operations:
   *   1. nearby = members within 64m **of the attacker** (3-D, same zone).
   *   2. `nMaxLevel` = highest nearby level; `nMaxLevel10 = max(0, nMaxLevel-20)`.
   *   3. `fExpValue = baseExp * GetExperienceReduceFactor(moverLv, nMaxLevel)`.
   *   4. `fAddExp   = fExpValue * 0.2 * (nMemberSize - 1)`   <- ALL nearby.
   *   5. `fMaxMemberLevel = sum(lv^2)` over ALL nearby        <- ALL nearby.
   *   6. each nearby with `lv > nMaxLevel10` gets
   *      `(fExpValue + fAddExp) * lv^2 / fMaxMemberLevel`, capped at that
   *      member's own `nLimitExp` (`AddPartyMemberExperience`, Mover.cpp:6047).
   *
   * Steps 4 and 5 counting ALL nearby members (not only the paid ones) is what
   * makes an out-of-band low-level member DILUTE the share instead of being
   * ignored -- the C++ behaviour, and the opposite of what filtering first does.
   *
   * Returns the number of members paid, or `null` when the party path does not
   * apply (no party, or `nMemberSize <= 1` -- C++ falls back to
   * `AddExperienceSolo(..., bParty=TRUE)`) so the caller runs its solo grant.
   *
   * ponytail: `m_nTroupsShareExp == 1` contribution split
   * (`AddExperiencePartyContribution`) is guild-party-only (`m_nKindTroup`),
   * and guild parties are not ported; the mode is accepted + echoed but the
   * level split is always used, exactly as C++ does for a solo party.
   */
  distributeExp(killer: CPlayer, mover: CMover, baseExp: number): number | null {
    const party = this.deps.partyManager.getByMember(killer.m_idPlayer);
    if (!party) return null;

    // 1. GetPartyMemberFind -- IsValidArea(pMember, 64.0f) measured from the
    // ATTACKER (C++ `this` is pEnemy), full 3-D distance, same world.
    const nearby: CPlayer[] = [];
    let maxLevel = 0;
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) { logger.debug({ id }, 'party exp: member not in playerManager'); continue; }
      if (p.m_nZoneId !== killer.m_nZoneId) {
        logger.debug({ id, memberZone: p.m_nZoneId, killerZone: killer.m_nZoneId }, 'party exp: zone mismatch');
        continue;
      }
      const d2 = distSq3(p.m_vPos, killer.m_vPos);
      if (d2 >= PARTY_EXP_PROXIMITY * PARTY_EXP_PROXIMITY) {
        logger.debug({ id, distSq: d2, limit: PARTY_EXP_PROXIMITY * PARTY_EXP_PROXIMITY, memberPos: p.m_vPos, killerPos: killer.m_vPos }, 'party exp: too far');
        continue;
      }
      nearby.push(p);
      if (p.m_nLevel > maxLevel) maxLevel = p.m_nLevel;
    }
    // C++ `if (1 < nMemberSize)` -- a lone nearby member (or none) is a SOLO
    // grant, which keeps the solo level-diff multiplier. Returning null hands
    // it back to the caller rather than silently paying an unmultiplied share.
    if (nearby.length <= 1) return null;

    // 2. nMaxLevel10 -- the "too far below the top level" cutoff.
    const maxLevel10 = Math.max(0, maxLevel - PARTY_EXP_LEVEL_BAND);

    // 3. Party reduce factor: keyed on the highest NEARBY level vs the mover.
    const expValue = baseExp * expPartyReduceFactor(mover.m_nLevel, maxLevel);

    // 3b. `pParty->GetPoint(nTotalLevel, nMemberSize, pDead->GetLevel())`
    // (`Mover.cpp:6479`) -- party-LEVEL exp, distinct from the member exp split
    // below. C++ calls it right after the reduce factor and UNCONDITIONALLY, so
    // it sits above the `expValue <= 0` bail: party-bar exp is keyed on the mob
    // level alone and does not care that the member split rounded to nothing.
    // Its own gate is `(nTotalLevel / nMemberSize) - nDeadLevel < 5`
    // (`party.cpp:268`, integer division) -- a party whose AVERAGE level is 5+
    // above the mob earns no party exp.
    let totalLevel = 0;
    for (const p of nearby) totalLevel += p.m_nLevel;
    this.addPartyLevelExp(party, totalLevel, nearby.length, mover.m_nLevel);

    if (expValue <= 0) return 0;

    // 4-5. Bonus + level-square denominator over ALL nearby members.
    const addExp = expValue * PARTY_EXP_BONUS_PER_MEMBER * (nearby.length - 1);
    let levelSqSum = 0;
    for (const p of nearby) levelSqSum += p.m_nLevel * p.m_nLevel;
    if (levelSqSum <= 0) return 0;

    // 6. Pay the in-band members.
    let granted = 0;
    for (const p of nearby) {
      if (p.m_nLevel <= maxLevel10) continue;
      let share = Math.floor((expValue + addExp) * (p.m_nLevel * p.m_nLevel) / levelSqSum);
      // AddPartyMemberExperience caps each member individually at their own
      // level's nLimitExp -- NOT at the killer's (the solo path's cap).
      const limit = EXP_TABLE[p.m_nLevel]?.nLimitExp;
      if (limit !== undefined && share > limit) share = limit;
      if (share <= 0) continue;
      this.deps.grantExpAmount(p, share);
      granted++;
    }
    logger.debug(
      { partyId: party.id, killer: killer.m_idPlayer, base: baseExp, maxLevel, maxLevel10, nearby: nearby.length, granted },
      'party exp split',
    );
    // 0 paid (everyone below the band, or every share rounded to 0) is still a
    // party-handled kill -- C++ pays nobody in that case and does NOT fall back
    // to a solo grant, so report a handled kill rather than null.
    return granted;
  }

  /**
   * `CParty::GetPoint` (`party.cpp:264`) -> `SendAddPartyExp` -> CoreServer
   * `OnAddPartyExp` (`DPCoreSrvr.cpp:744`) -> `SETPARTYEXP` back to the world ->
   * `AddPartyExpLevel` to every member (`DPCoreClient.cpp:1275`). In this
   * single-process emulator all three hops collapse into one call.
   *
   * Gate: `(nTotalLevel / nMemberSize) - nDeadLevel < 5` with C++ INTEGER
   * division on the average -- a party averaging 5+ levels above the mob earns
   * no party exp. `nTotalLevel`/`nMemberSize` are the NEARBY members
   * (`GetPartyMemberFind` output), not the whole roster.
   *
   * The PARTYEXP push goes to every member on the roster, matching
   * `OnSetPartyExp`'s `m_nSizeofMember` loop -- NOT only the nearby ones. A
   * member across the map still sees the party bar move.
   */
  private addPartyLevelExp(
    party: Party, totalLevel: number, memberSize: number, moverLevel: number,
  ): void {
    if (memberSize <= 0) return;
    if (Math.trunc(totalLevel / memberSize) - moverLevel >= PARTY_LEVEL_EXP_BAND) return;
    const updated = this.deps.partyManager.addPartyExp(party.id, moverLevel, this.partyExpRate());
    if (!updated) return;
    for (const id of updated.members) {
      const p = this.deps.playerManager.get(id);
      if (p) {
        this.deps.playerManager.sendTo(
          p, buildPartyExp(p.m_idPlayer, updated.exp, updated.level, updated.point),
        );
      }
    }
  }

  /**
   * `SubLootDropMobParty` receiver pick (`MoverActEvent.cpp:2395-2480`).
   * Returns the party member who should RECEIVE a pile `finder` just walked
   * onto, or `null` when the party path does not apply (no party, player-dropped
   * pile, or no member in range -- all of which give the item to the finder).
   *
   * `dropMob` is `CItem::m_bDropMob`: only monster drops are redistributed.
   * A pile a player threw on the ground goes through `SubLootDropNotMob`, which
   * never consults the party.
   *
   * Candidates are members within 32m of the FINDER (`IsValidArea(pMember,
   * 32.0f)`, 3-D) in leader-first roster order -- the same order the C++ walks
   * `m_aMember` into `pListMember`.
   */
  pickItemReceiver(finder: CPlayer, dropMob: boolean): CPlayer | null {
    if (!dropMob) return null;
    const party = this.deps.partyManager.getByMember(finder.m_idPlayer);
    if (!party) return null;
    const candidates = this.nearbyForItems(finder, party);
    // `nMaxListMember == 0` -> pGetUser = this (the finder). Cannot happen in
    // practice (the finder is always in range of themself) but C++ guards it.
    if (candidates.length === 0) return null;

    const receiver = this.selectReceiver(party, candidates, finder);
    // C++ records the getter unconditionally (`pParty->m_nGetItemPlayerId =
    // pGetUser->m_idPlayer`), including in FFA/leader mode -- so switching to
    // sequential mid-session continues from whoever last got something.
    this.deps.partyManager.setLastItemGetter(party.id, receiver.m_idPlayer);
    return receiver.m_idPlayer === finder.m_idPlayer ? null : receiver;
  }

  /** The `m_nTroupeShareItem` switch (`MoverActEvent.cpp:2432-2477`). */
  private selectReceiver(party: Party, candidates: CPlayer[], finder: CPlayer): CPlayer {
    switch (party.itemMode) {
      case PARTY_ITEM_MODE_SEQUENTIAL: {
        const id = this.deps.partyManager.nextSequentialLooter(
          party.id, candidates.map((p) => p.m_idPlayer),
        );
        const next = id !== undefined ? this.deps.playerManager.get(id) : undefined;
        return next ?? candidates[0];
      }
      case PARTY_ITEM_MODE_LEADER:
        // C++ checks `IsLeader(pListMember[0])` -- i.e. the leader takes it only
        // when the leader is IN RANGE (they are candidates[0] when present,
        // roster order being leader-first); otherwise the finder keeps it.
        return party.members[0] === candidates[0].m_idPlayer ? candidates[0] : finder;
      case PARTY_ITEM_MODE_RANDOM:
        return candidates[Math.floor(this.random() * candidates.length)];
      default:
        return finder; // 0 = finder keeps ("free order" in C++ comments)
    }
  }

  /**
   * `CMover::PickupGold` party branch (`MoverEquip.cpp:2374-2412`). Returns the
   * per-member gold split for a monster-dropped pile of `amount`, or `null` when
   * the party path does not apply (no party, player-dropped pile, nobody in
   * range) and the finder should take the whole pile.
   *
   * Split: `floor(amount / n)` to every member in range, and the remainder
   * (`amount % n`) to ONE randomly chosen member. Gold ignores
   * `m_nTroupeShareItem` entirely -- it is always split, in every mode.
   */
  splitGold(finder: CPlayer, amount: number, dropMob: boolean): { player: CPlayer; amount: number }[] | null {
    if (!dropMob || amount <= 0) return null;
    const party = this.deps.partyManager.getByMember(finder.m_idPlayer);
    if (!party) return null;
    const candidates = this.nearbyForItems(finder, party);
    if (candidates.length === 0) return null;

    const share = Math.floor(amount / candidates.length);
    const rest = amount % candidates.length;
    const out: { player: CPlayer; amount: number }[] = [];
    if (share > 0) for (const p of candidates) out.push({ player: p, amount: share });
    if (rest > 0) {
      const luckyIdx = Math.floor(this.random() * candidates.length);
      const lucky = candidates[luckyIdx];
      const existing = out.find((e) => e.player.m_idPlayer === lucky.m_idPlayer);
      if (existing) existing.amount += rest;
      else out.push({ player: lucky, amount: rest });
    }
    return out.length > 0 ? out : null;
  }

  /**
   * `pListMember` build for item/gold distribution: members within
   * {@link PARTY_ITEM_PROXIMITY} of the FINDER, 3-D, same zone, roster order
   * (leader first). Shared by {@link pickItemReceiver} and {@link splitGold} --
   * C++ duplicates this loop in both places with identical semantics.
   */
  private nearbyForItems(finder: CPlayer, party: Party): CPlayer[] {
    const out: CPlayer[] = [];
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      if (p.m_nZoneId !== finder.m_nZoneId) continue;
      if (distSq3(p.m_vPos, finder.m_vPos) >= PARTY_ITEM_PROXIMITY * PARTY_ITEM_PROXIMITY) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * Members of `finder`'s party within item range, EXCLUDING `exclude` -- the
   * peers who should be told "<name> got <item>" (`TID_GAME_TROUPEREAPITEM`,
   * `MoverActEvent.cpp:2495`). Empty when there is no party.
   */
  itemNoticePeers(finder: CPlayer, exclude: number): CPlayer[] {
    const party = this.deps.partyManager.getByMember(finder.m_idPlayer);
    if (!party) return [];
    return this.nearbyForItems(finder, party).filter((p) => p.m_idPlayer !== exclude);
  }

  // --- Roster broadcast helpers ---------------------------------------------

  /** Send the full PARTYMEMBER roster to every member (after a roster change). */
  private broadcastRoster(party: Party, leader: CPlayer, newMember: CPlayer): void {
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      this.deps.playerManager.sendTo(p, buildPartyMember(
        p.m_idPlayer, newMember.m_idPlayer, leader.m_szName, newMember.m_szName, this.snapshot(party),
      ));
    }
  }

  /**
   * Roster refresh after a member left/was kicked. `affectedId` is the departed
   * member (C++ `idMember`) -- the client formats "<member> left the party" from
   * the `pszMember` string, and only when `nOldSize > nSizeofMember`.
   */
  private broadcastRosterOnly(party: Party, affectedId: number, affectedName: string): void {
    const leader = this.deps.playerManager.get(party.members[0]);
    if (!leader) return;
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      this.deps.playerManager.sendTo(p, buildPartyMember(
        p.m_idPlayer, affectedId, leader.m_szName, affectedName, this.snapshot(party),
      ));
    }
  }

  /**
   * `CParty::Serialize` state for a roster broadcast. `kindTroup`/`partyName`
   * MUST ride along: the client re-reads them on every PARTYMEMBER, so omitting
   * them silently demotes an advanced party back to solo on the next refresh.
   *
   * `remove` is `PartyMember::m_bRemove` -- the OFFLINE flag, derived from
   * whether the member is in `PlayerManager` (it is never stored; see the
   * manager's module comment). Hardcoding `false` would render every logged-out
   * member as online in the party window.
   */
  private snapshot(party: Party): PartySnapshotState {
    return {
      partyId: party.id, kindTroup: party.kindTroup, size: party.members.length,
      level: party.level, exp: party.exp, point: party.point,
      expMode: party.expMode, itemMode: party.itemMode, duelPartyId: PARTY_NO_DUEL,
      partyName: party.name,
      members: party.members.map((m) => ({
        id: m, remove: this.deps.playerManager.get(m) === undefined,
      })),
    };
  }

  /**
   * Empty PARTYMEMBER to a just-removed player -- tears down their party window.
   * `idPlayer` is the removed player themself, which is what makes the client
   * print "you left the party" rather than "the party was disbanded".
   */
  private notifyRemoved(player: CPlayer, leaderName: string): void {
    this.deps.playerManager.sendTo(
      player, buildPartyMember(player.m_idPlayer, player.m_idPlayer, leaderName, player.m_szName, null),
    );
  }

  /**
   * Disband -- empty PARTYMEMBER to each remaining member. C++ passes
   * `idPlayer = 0` here (`DPCoreClient.cpp:965`), never the recipient's id, so
   * the client takes the "party was disbanded" branch.
   */
  private notifyDisband(party: Party, leaderName: string, memberName: string): void {
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      p.m_idParty = NULL_ID;
      this.deps.playerManager.sendTo(p, buildPartyMember(p.m_idPlayer, 0, leaderName, memberName, null));
    }
  }

  private broadcastAddPartyChangeLeader(party: Party, newLeaderId: number): void {
    for (const id of party.members) {
      const p = this.deps.playerManager.get(id);
      if (!p) continue;
      this.deps.playerManager.sendTo(p, buildPartyChangeLeader(p.m_idPlayer, newLeaderId));
    }
  }
}

interface Vec3 { x: number; y: number; z: number }
/**
 * Full 3-D squared distance -- `D3DXVec3LengthSq` in `CMover::IsValidArea`
 * (`Mover.cpp:6241`), which both the 64m exp scan and the 32m item/gold scan
 * go through. NOT horizontal-only: a member on a cliff above the fight is out
 * of range in C++, and flattening the check would silently widen both radii.
 */
function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
