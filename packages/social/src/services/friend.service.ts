/**
 * FriendService -- the `CRTMessenger` roster (6 client opcodes + presence pushes).
 *
 * Handler map is split across two C++ servers, which is worth knowing when
 * cross-referencing: only ADDFRIENDREQEST / ADDFRIENDNAMEREQEST /
 * ADDFRIENDCANCEL live in `WORLDSERVER/DPSrvr.cpp` (:1523 / :1573 / :1610).
 * ADDFRIEND / GETFRIENDSTATE / SETFRIENDSTATE / REMOVEFRIEND are forwarded past
 * the world and handled in `CORESERVER/DPCacheSrvr.cpp` (:1970 / :2062 / :2075 /
 * :2190). A single-process emulator collapses that, so all six land here.
 *
 * ## Flow
 *
 *   NAMEREQEST(name)  -> resolve name -> REQEST on the target, or ADDFRIENDERROR
 *   REQEST(leader,me) -> invite dialog on the target
 *   ADDFRIEND(...)    -> accept: insert BOTH directions, ADDFRIEND to both
 *   CANCEL            -> bodyless dismissal back to the leader
 *   GETFRIENDSTATE    -> full roster status list
 *   SETFRIENDSTATE(s) -> set own status, echo to self, relay to non-blocked friends
 *   REMOVEFRIEND(id)  -> delete BOTH directions; the other side gets
 *                        REMOVEFRIENDSTATE
 *
 * ## Deliberate divergences (rule 03 -- never trust the client)
 *
 * C++ resolves the ACTOR from a client-supplied `idPlayer` in three handlers
 * (`OnAddFriendReqest`, `OnAddFriendNameReqest`, `OnAddFriendCancel` all call
 * `GetUserByPlayerID( uLeaderid )` with the packet's value). That is spoofable:
 * any client can send another player's id and act as them. We resolve the actor
 * from the socket session and treat the packet's id as advisory, logging a
 * mismatch. Recorded in `docs/c++-fidelity-audit.md`.
 *
 * `OnSetFrinedState` (`DPCacheSrvr.cpp:2086`) also accepts an unvalidated `int
 * state`; we clamp to `0 <= state < MAX_FRIENDSTAT`.
 *
 * No WAL: roster edges are not in the rule-04 journal list, and every mutation
 * is written through to the main DB immediately (matching C++, which has no
 * batch save for the messenger).
 *
 * @module social/services/friend
 */

import type { FriendRepository, CharacterRepository } from '@flyff/database';
import { MAX_FRIEND } from '@flyff/database';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import { FRS, MAX_FRIENDSTAT, FRIEND_ERROR, TID_GAME_BATTLE_NOTFRIEND, TID_GAME_MSGINVATECOM } from '../constants/friend';
import {
  buildAddFriend, buildFriendRequest, buildFriendCancel, buildFriendError,
  buildRemoveFriend, buildFriendGameJoin, buildGetFriendState, buildSetFriendState,
  buildFriendJoin, buildFriendLogout, buildRemoveFriendState, buildFriendChangeJob,
  buildBlock, type FriendEntry,
} from '../net/snapshot/friend.serializer';

const logger = createLogger({ module: 'friend-service' });

export interface FriendServiceDeps {
  playerManager: PlayerManager;
  friendRepo: FriendRepository;
  charRepo: Pick<CharacterRepository, 'findByName' | 'findById'>;
  /** Emits a `TID_*` notice with printf args to one player (DEFINEDTEXT). */
  sendDefinedText?: (player: CPlayer, tid: number, args?: string) => void;
}

export type FriendResult =
  | { ok: true }
  | { ok: false; reason: string };

const OK: FriendResult = { ok: true };
const fail = (reason: string): FriendResult => ({ ok: false, reason });

export class FriendService {
  /**
   * Live roster cache, charId -> (friendId -> blocked). Mirrors the in-memory
   * `CRTMessenger` map so presence fan-out and the `MAX_FRIEND` gate do not hit
   * the DB per packet. Loaded on JOIN, dropped on disconnect.
   */
  private readonly rosters = new Map<number, Map<number, boolean>>();
  /** Own `FRS_*` status per live character (`CRTMessenger::m_dwState`). */
  private readonly states = new Map<number, number>();

  constructor(private readonly deps: FriendServiceDeps) {}

  // ── Session lifecycle ─────────────────────────────────────────────────────

  /**
   * JOIN -- hydrate the roster, push ADDFRIENDGAMEJOIN, and tell every online
   * friend we came online (`PACKETTYPE_ADDFRIENDJOIN`).
   */
  async onJoin(player: CPlayer): Promise<void> {
    const rows = await this.deps.friendRepo.loadByCharacter(player.m_idPlayer);
    const roster = new Map<number, boolean>();
    for (const r of rows) roster.set(r.friend_id, r.blocked);
    this.rosters.set(player.m_idPlayer, roster);

    const ownState = await this.deps.friendRepo.getState(player.m_idPlayer);
    this.states.set(player.m_idPlayer, clampState(ownState));

    const entries: FriendEntry[] = [...roster].map(([friendId, blocked]) => ({
      friendId, blocked, state: this.visibleState(friendId, player.m_idPlayer),
    }));
    this.deps.playerManager.sendTo(player,
      buildFriendGameJoin(player.m_idPlayer, this.ownState(player.m_idPlayer), entries));

    this.notifyFriends(player.m_idPlayer, (friend, myState) =>
      buildFriendJoin(player.m_idPlayer, myState, friend.m_idPlayer));
  }

  /** Disconnect -- drop the cache and push ADDFRIENDLOGOUT to online friends. */
  onDisconnect(charId: number): void {
    this.notifyFriends(charId, () => buildFriendLogout(charId));
    this.rosters.delete(charId);
    this.states.delete(charId);
  }

  // ── Invite / accept ───────────────────────────────────────────────────────

  /**
   * `OnAddFriendNameReqest` (`DPSrvr.cpp:1573`) -- add by typed name. Resolves
   * the name through the character table (C++ uses `CPlayerDataCenter`, which is
   * the same data), then routes to the same gates as an id-based request.
   */
  async requestByName(player: CPlayer, name: string): Promise<FriendResult> {
    const row = await this.deps.charRepo.findByName(name);
    if (!row) {
      this.deps.playerManager.sendTo(player,
        buildFriendError(player.m_idPlayer, FRIEND_ERROR.NAME_NOT_FOUND, name));
      return fail('no-such-name');
    }
    if (this.roster(player.m_idPlayer).has(row.id)) {
      this.deps.playerManager.sendTo(player,
        buildFriendError(player.m_idPlayer, FRIEND_ERROR.ALREADY_FRIEND, name));
      return fail('already-friend');
    }
    return this.request(player, row.id, name);
  }

  /**
   * `OnAddFriendReqest` (`DPSrvr.cpp:1523`) -- pop the invite dialog on the
   * target. Gates, in C++ order: both alive in world, neither in a duel, target
   * not already a friend, target not in combat.
   *
   * `nameForError` is only used to address an ADDFRIENDERROR back to the
   * requester, which needs the typed string rather than the resolved row.
   */
  request(player: CPlayer, targetId: number, nameForError = ''): FriendResult {
    if (targetId === player.m_idPlayer) return fail('self');
    const target = this.deps.playerManager.get(targetId);
    if (!target) return fail('not-online');
    if (player.m_nDuel > 0 || target.m_nDuel > 0) return fail('duel');

    if (this.roster(player.m_idPlayer).has(targetId)) {
      this.deps.playerManager.sendTo(player,
        buildFriendError(player.m_idPlayer, FRIEND_ERROR.ALREADY_FRIEND, nameForError));
      return fail('already-friend');
    }
    if (this.roster(player.m_idPlayer).size >= MAX_FRIEND) return fail('roster-full');

    if (isAttackMode(target, Date.now())) {
      this.deps.sendDefinedText?.(player, TID_GAME_BATTLE_NOTFRIEND);
      return fail('target-in-combat');
    }

    this.deps.playerManager.sendTo(target, buildFriendRequest(
      target.m_idPlayer, player.m_idPlayer, player.m_nSex, player.m_nJob, player.m_szName,
    ));
    return OK;
  }

  /**
   * `OnAddFriend` (`CORESERVER/DPCacheSrvr.cpp:1970`) -- the accept leg. Inserts
   * BOTH directions and sends each side the OTHER's id + name.
   *
   * `accepter` is the invitee (the socket that sent ADDFRIEND); `leaderId` is
   * whose invite is being accepted.
   */
  async accept(accepter: CPlayer, leaderId: number): Promise<FriendResult> {
    if (leaderId === accepter.m_idPlayer) return fail('self');
    const leader = this.deps.playerManager.get(leaderId);
    if (!leader) return fail('leader-offline');

    // C++ checks MAX_FRIEND on both sides and bails silently on either
    // (`DPCacheSrvr.cpp:1996-2009`).
    if (this.roster(accepter.m_idPlayer).size >= MAX_FRIEND) return fail('roster-full');
    if (this.roster(leaderId).size >= MAX_FRIEND) return fail('leader-roster-full');
    if (this.roster(accepter.m_idPlayer).has(leaderId)) return fail('already-friend');

    await this.deps.friendRepo.add(leaderId, accepter.m_idPlayer);
    this.roster(leaderId).set(accepter.m_idPlayer, false);
    this.roster(accepter.m_idPlayer).set(leaderId, false);

    this.deps.playerManager.sendTo(leader,
      buildAddFriend(leader.m_idPlayer, accepter.m_idPlayer, accepter.m_szName));
    this.deps.playerManager.sendTo(accepter,
      buildAddFriend(accepter.m_idPlayer, leaderId, leader.m_szName));

    // `DPCoreClient.cpp:1480-1484` -- each side gets TID_GAME_MSGINVATECOM with
    // the OTHER player's name. Both branches fire because we only reach here
    // when both inserts succeeded (C++ `bAdd == 3`).
    this.deps.sendDefinedText?.(leader, TID_GAME_MSGINVATECOM, accepter.m_szName);
    this.deps.sendDefinedText?.(accepter, TID_GAME_MSGINVATECOM, leader.m_szName);

    logger.info(
      { leaderId, leaderName: leader.m_szName, accepterId: accepter.m_idPlayer, accepterName: accepter.m_szName },
      'friend request accepted',
    );
    return OK;
  }

  /**
   * `OnAddFriendCancel` (`DPSrvr.cpp:1610`) -- the invitee declined. Bodyless
   * reply to the leader; C++ discards the member id it was sent.
   */
  cancel(player: CPlayer, leaderId: number): FriendResult {
    const leader = this.deps.playerManager.get(leaderId);
    if (!leader) return fail('leader-offline');
    this.deps.playerManager.sendTo(leader, buildFriendCancel(leader.m_idPlayer));
    return OK;
  }

  // ── Roster mutation / status ──────────────────────────────────────────────

  /**
   * `OnRemoveFriend` (`DPCacheSrvr.cpp:2190`) -- delete BOTH directions and tell
   * the other side (`PACKETTYPE_REMOVEFRIENDSTATE`). Friendship is symmetric, so
   * a one-sided delete would leave the other party with a phantom entry.
   */
  async remove(player: CPlayer, friendId: number): Promise<FriendResult> {
    if (!this.roster(player.m_idPlayer).has(friendId)) return fail('not-friend');

    await this.deps.friendRepo.remove(player.m_idPlayer, friendId);
    this.roster(player.m_idPlayer).delete(friendId);
    this.rosters.get(friendId)?.delete(player.m_idPlayer);

    this.deps.playerManager.sendTo(player,
      buildRemoveFriend(player.m_idPlayer, friendId));
    const other = this.deps.playerManager.get(friendId);
    if (other) {
      this.deps.playerManager.sendTo(other, buildRemoveFriendState(player.m_idPlayer));
    }
    return OK;
  }

  /**
   * `OnGetFriendState` (`DPCacheSrvr.cpp:2062`) -- full roster status list.
   * Non-blocked entries first, then blocked, each `{ id, state, idOfMulti }`.
   * C++ reads a `u_long` from the body and ignores it, resolving the player from
   * the socket -- we do the same.
   */
  getState(player: CPlayer): FriendResult {
    const friends: { id: number; state: number; idOfMulti?: number }[] = [];
    const blockedList: { id: number; state: number; idOfMulti?: number }[] = [];

    for (const [friendId, blocked] of this.roster(player.m_idPlayer)) {
      const entry = { id: friendId, state: this.visibleState(friendId, player.m_idPlayer) };
      (blocked ? blockedList : friends).push(entry);
    }
    this.deps.playerManager.sendTo(player, buildGetFriendState(friends, blockedList));
    return OK;
  }

  /**
   * `OnSetFrinedState` (`DPCacheSrvr.cpp:2075`) -- set own status, echo to self,
   * then relay to every non-blocked friend. `FRS_AUTOABSENT` is deliberately NOT
   * relayed (`:2091`) -- auto-away is a local-only state.
   *
   * The state is clamped; C++ accepts any int (see module doc).
   */
  setState(player: CPlayer, state: number): FriendResult {
    const clamped = clampState(state);
    this.states.set(player.m_idPlayer, clamped);
    void this.deps.friendRepo.setState(player.m_idPlayer, clamped)
      .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'setState failed'));

    this.deps.playerManager.sendTo(player, buildSetFriendState(player.m_idPlayer, clamped));
    if (clamped !== FRS.AUTOABSENT) {
      this.notifyFriends(player.m_idPlayer, () =>
        buildSetFriendState(player.m_idPlayer, clamped));
    }
    return OK;
  }

  /**
   * `OnFriendInterceptState` (`DPCacheSrvr.cpp:2734`) -- toggle the per-friend
   * `bBlock` flag. `nGu=2` for friend block (the only one we implement; chat and
   * trade blocks are separate systems). Toggling: if currently blocked, unblock
   * and restore the friend's real presence state; if currently unblocked, block
   * and zero their state. DB write-through via `friendRepo.setBlocked`.
   */
  async toggleBlock(player: CPlayer, targetName: number | string): Promise<FriendResult> {
    // Resolve target id from name if needed.
    let targetId: number;
    if (typeof targetName === 'string') {
      const row = await this.deps.charRepo.findByName(targetName);
      if (!row) return fail('no-such-name');
      targetId = row.id;
    } else {
      targetId = targetName;
    }
    if (!this.roster(player.m_idPlayer).has(targetId)) return fail('not-friend');

    const currentlyBlocked = this.roster(player.m_idPlayer).get(targetId) ?? false;
    const newBlocked = !currentlyBlocked;
    this.roster(player.m_idPlayer).set(targetId, newBlocked);

    await this.deps.friendRepo.setBlocked(player.m_idPlayer, targetId, newBlocked);

    // C++ OnFriendInterceptState:2752-2763 -- when blocking, dwState=0;
    // when unblocking, restore real state (online or FRS_OFFLINE).
    if (!newBlocked) {
      // Unblocked: visible state will naturally resolve via visibleState().
    }

    this.deps.playerManager.sendTo(player, buildBlock(player.m_idPlayer, 2, String(targetName)));
    return OK;
  }

  /**
   * `CUser::AddFriendChangeJob` (`User.cpp:1845`) -- push a job change to every
   * online friend so their roster shows the new class icon.
   */
  onJobChange(player: CPlayer): void {
    for (const friendId of this.roster(player.m_idPlayer).keys()) {
      const friend = this.deps.playerManager.get(friendId);
      if (!friend) continue;
      // Skip friends who blocked us -- they get no updates from us at all.
      if (this.rosters.get(friendId)?.get(player.m_idPlayer)) continue;
      this.deps.playerManager.sendTo(friend,
        buildFriendChangeJob(friend.m_idPlayer, player.m_idPlayer, player.m_nJob));
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Live roster for `charId`, creating an empty one if not yet hydrated. */
  private roster(charId: number): Map<number, boolean> {
    let r = this.rosters.get(charId);
    if (!r) { r = new Map(); this.rosters.set(charId, r); }
    return r;
  }

  private ownState(charId: number): number {
    return this.states.get(charId) ?? FRS.ONLINE;
  }

  /**
   * The state `viewerId` should see for `friendId`, per `SendFriendState`
   * (`DPCacheSrvr.cpp:336-348`): FRS_OFFLINE when the friend is not online, OR
   * when the FRIEND has blocked the viewer. Otherwise the friend's own state.
   */
  private visibleState(friendId: number, viewerId: number): number {
    if (!this.deps.playerManager.get(friendId)) return FRS.OFFLINE;
    if (this.rosters.get(friendId)?.get(viewerId)) return FRS.OFFLINE;
    return this.ownState(friendId);
  }

  /**
   * Send a packet to every online friend of `charId` who has not blocked them.
   * `build` receives the recipient and the sender's current state.
   */
  private notifyFriends(charId: number, build: (friend: CPlayer, myState: number) => Buffer): void {
    const myState = this.ownState(charId);
    for (const friendId of this.roster(charId).keys()) {
      const friend = this.deps.playerManager.get(friendId);
      if (!friend) continue;
      if (this.rosters.get(friendId)?.get(charId)) continue;   // they blocked us
      this.deps.playerManager.sendTo(friend, build(friend, myState));
    }
  }
}

/** Clamp to a valid `FRS_*` value -- C++ does no range check (see module doc). */
function clampState(state: number): number {
  if (!Number.isInteger(state) || state < 0 || state >= MAX_FRIENDSTAT) return FRS.ONLINE;
  return state;
}

/**
 * `CMover::IsAttackMode` (`_Common/Mover.cpp:9485`) -- damaged in the last 10 s.
 * Ported against the wall-clock `m_tmLastDamage` cursor, as RecoverySystem does.
 */
function isAttackMode(player: CPlayer, now: number): boolean {
  return player.m_tmLastDamage > 0 && now - player.m_tmLastDamage < 10_000;
}
