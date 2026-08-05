/**
 * PartyManager -- registry of live parties + pending invites, backed by the
 * `parties` / `party_member` tables (migration `022`).
 *
 * Mirrors `CPartyMng` (`_Common/party.cpp`): auto-increment party ids, a
 * {@link Party} per active id, and one pending inbound invite per target
 * member.
 *
 * **Persistence diverges from C++ on purpose.** Vanilla keeps rosters in
 * CoreServer RAM and persists only `characters.m_idparty`, so a CoreServer
 * restart destroys every party (`party.cpp:844`, `:1184`). It also reaps a
 * member offline for 10 minutes (`CPartyMng::Worker`, `party.cpp:1121`) and
 * deletes a party whose every member is offline (`RemoveConnection`, `:1259`).
 * Here parties are durable: {@link onDisconnect} marks a member offline and
 * NEVER removes them, an all-offline party survives, and {@link hydrate}
 * reloads the whole set at world boot. The 600 s reaper is not ported --
 * removal happens only via an explicit leave/kick that drops below 2 members.
 *
 * The offline flag itself (`PartyMember::m_bRemove`) is NOT stored here or in
 * the DB: it is derived from whether the character is in `PlayerManager`, the
 * same way `friends.dwState` is derived (migration `019`). A stored flag would
 * strand members "offline" after a crash.
 *
 * Roster invariant: `members[0]` is always the current leader (C++ keeps the
 * leader at slot 0 via `SwapPartyMember(0, idx)` in `CParty::ChangeLeader`),
 * and that order is what `party_member.slot` persists.
 *
 * ponytail: party-duel (`m_idDuelParty`), guild-party (`m_nKindTroup=1` +
 * party name + party-level + contribution mode + skills). Solo party only.
 *
 * @module managers/party
 */

import { NULL_ID } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'party-manager' });

/** Exp-mode constants (`m_nTroupsShareExp`). Solo party uses level-split. */
export const PARTY_EXP_MODE_LEVEL = 0;
/** `m_nTroupsShareExp = 1` -- contribution split (guild party only in C++). */
export const PARTY_EXP_MODE_CONTRIBUTION = 1;
/**
 * Item-mode constants (`m_nTroupeShareItem`, `MoverActEvent.cpp:2432-2477`).
 * 0 = finder keeps, 1 = sequential (round-robin over nearby members),
 * 2 = leader takes, 3 = random nearby member.
 */
export const PARTY_ITEM_MODE_FFA = 0;
export const PARTY_ITEM_MODE_SEQUENTIAL = 1;
export const PARTY_ITEM_MODE_LEADER = 2;
export const PARTY_ITEM_MODE_RANDOM = 3;
/** Highest valid `m_nTroupeShareItem`. */
export const PARTY_ITEM_MODE_MAX = PARTY_ITEM_MODE_RANDOM;

/** @deprecated Old name for {@link PARTY_ITEM_MODE_SEQUENTIAL}. */
export const PARTY_ITEM_MODE_ROUND_ROBIN = PARTY_ITEM_MODE_SEQUENTIAL;

/** 30s invite expiry -- generous C++ has no hard TTL; matches duel pattern. */
export const PARTY_INVITE_TIMEOUT_MS = 30_000;

/** Max members in a solo party (mirrors C++ `MAX_PARYMEMBER` default). */
export const MAX_PARTY_MEMBERS = 8;

/** `m_nKindTroup` -- 0 = solo party, 1 = troupe ("advance party"). */
export const PARTY_KIND_SOLO = 0;
export const PARTY_KIND_TROUPE = 1;

/** `m_sParty` capacity -- `ar.ReadString(sParty, 33)` (32 chars + NUL). */
export const MAX_PARTY_NAME_LEN = 32;

/** `MAX_PARTYLEVEL` (`ProjectCmn.h:34`) -- a solo party stops levelling here. */
export const MAX_PARTY_LEVEL = 10;

/**
 * `expParty` block of `expTable.inc` (parsed by `CProject::OpenExpTable`,
 * `Project.cpp:3459`) -- `{ exp-to-next, point-on-levelup }` indexed by the
 * party's CURRENT level. C++ reads `m_aExpParty[m_nLevel]`, and the table is
 * "0 based" per its own comment, so index 0 is unreachable for a live party
 * (`m_nLevel` starts at 1) and index 10 is the `MAX_PARTYLEVEL` terminator.
 */
export const PARTY_EXP_TABLE: readonly { readonly exp: number; readonly point: number }[] = [
  { exp: 0, point: 0 },     // 0 (unused -- parties start at level 1)
  { exp: 200, point: 15 },  // 1 -> 2
  { exp: 200, point: 15 },  // 2 -> 3
  { exp: 250, point: 15 },  // 3 -> 4
  { exp: 300, point: 15 },  // 4 -> 5
  { exp: 350, point: 15 },  // 5 -> 6
  { exp: 400, point: 15 },  // 6 -> 7
  { exp: 450, point: 15 },  // 7 -> 8
  { exp: 500, point: 15 },  // 8 -> 9
  { exp: 500, point: 15 },  // 9 -> 10
];

/** One live party. `members[0]` is the leader. */
export interface Party {
  readonly id: number;
  /** Character ids; index 0 is always the leader. */
  members: number[];
  /** `m_nTroupsShareExp` (0 = level-based split). */
  expMode: number;
  /** `m_nTroupeShareItem` (0 finder, 1 sequential, 2 leader, 3 random). */
  itemMode: number;
  /** `m_nLevel` -- party level. C++ ctor seeds 1 (`party.cpp:55`). */
  level: number;
  /** `m_nExp` -- within-level party exp (resets on each party level-up). */
  exp: number;
  /** `m_nPoint` -- accrued party-skill points. */
  point: number;
  /**
   * `CParty::m_nGetItemPlayerId` -- who received the LAST distributed item.
   * Sequential mode hands the next drop to the member AFTER this one in the
   * nearby-member list. NULL_ID until the first distributed drop.
   *
   * Note this is a member **id**, not an index: C++ stores the id and rescans
   * the (varying) nearby list each drop, so members walking in and out of range
   * cannot desync a stored cursor.
   */
  lastItemGetterId: number;
  /**
   * `m_nKindTroup` -- 0 solo, 1 troupe ("advance party"). One-way: C++ has no
   * packet that demotes a troupe back to a solo party.
   */
  kindTroup: number;
  /** `m_sParty` -- troupe name; empty while `kindTroup === 0`. */
  name: string;
}

/** One pending inbound invite targeting `memberId`. */
export interface PendingPartyInvite {
  readonly leaderId: number;
  readonly memberId: number;
  readonly expiresAt: number;
  /** Live timer; cleared on accept/decline/expiry/disconnect. */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Persistence port -- structurally satisfied by
 * `PartyRepository` (`@flyff/database`). An interface rather than the concrete
 * class so the manager stays testable with a plain object and carries no
 * knowledge of Knex.
 */
export interface PartyPersistence {
  loadAll(): Promise<{
    id: number; kindTroup: number; name: string; level: number; exp: number;
    point: number; expMode: number; itemMode: number; lastItemGetterId: number;
    members: number[];
  }[]>;
  maxId(): Promise<number>;
  create(party: {
    id: number; kindTroup: number; name: string; level: number; exp: number;
    point: number; expMode: number; itemMode: number; lastItemGetterId: number;
    members: number[];
  }): Promise<void>;
  update(partyId: number, data: {
    kind_troup?: number; name?: string; level?: number; exp?: number;
    point?: number; exp_mode?: number; item_mode?: number;
    last_item_getter_id?: number;
  }): Promise<void>;
  replaceMembers(partyId: number, members: number[]): Promise<void>;
  remove(partyId: number): Promise<void>;
}

export class PartyManager {
  private readonly parties = new Map<number, Party>();
  private readonly pending = new Map<number, PendingPartyInvite>();
  private nextId = 1;

  /**
   * Optional persistence port. Absent (tests, or a world with no DB wired) =
   * the manager behaves exactly as the old in-memory version. Every write is
   * fire-and-forget: a DB failure must never break a live roster broadcast, so
   * each call swallows its own rejection into a log line (rule 01 -- all async
   * handles rejection).
   */
  constructor(private readonly repo?: PartyPersistence) {}

  /**
   * World-boot hydrate -- reload every persisted party and seed the id counter
   * past the highest stored id. Equivalent in spirit to CoreServer pushing
   * `PACKETTYPE_LOAD_WORLD` -> `CPartyMng::Serialize` into each world
   * (`DPCoreSrvr.cpp:251`), except the source is the DB rather than RAM.
   *
   * Parties that fell below 2 members while offline (a character was deleted,
   * cascading its `party_member` row) are dropped here rather than resurrected
   * -- the same floor {@link removeMember} enforces at runtime.
   */
  async hydrate(): Promise<void> {
    if (!this.repo) return;
    const rows = await this.repo.loadAll();
    let dropped = 0;
    for (const r of rows) {
      if (r.members.length < 2) {
        dropped++;
        void this.repo.remove(r.id).catch((err: unknown) => {
          logger.warn({ err, partyId: r.id }, 'party prune failed');
        });
        continue;
      }
      this.parties.set(r.id, {
        id: r.id,
        members: [...r.members],
        expMode: r.expMode,
        itemMode: r.itemMode,
        level: r.level,
        exp: r.exp,
        point: r.point,
        lastItemGetterId: r.lastItemGetterId,
        kindTroup: r.kindTroup,
        name: r.name,
      });
    }
    this.nextId = (await this.repo.maxId()) + 1;
    logger.info({ parties: this.parties.size, dropped, nextId: this.nextId }, 'parties loaded');
  }

  hasPending(memberId: number): boolean { return this.pending.has(memberId); }

  getPending(memberId: number): PendingPartyInvite | undefined {
    return this.pending.get(memberId);
  }

  addPending(p: PendingPartyInvite): void { this.pending.set(p.memberId, p); }

  /** Remove + clear the timer. Returns the removed entry (or undefined). */
  removePending(memberId: number): PendingPartyInvite | undefined {
    const e = this.pending.get(memberId);
    if (!e) return undefined;
    clearTimeout(e.timer);
    this.pending.delete(memberId);
    return e;
  }

  /** Create a fresh party with 2 members (leader at index 0). */
  create(leaderId: number, memberId: number): Party {
    const party: Party = {
      id: this.nextId++,
      members: [leaderId, memberId],
      expMode: PARTY_EXP_MODE_LEVEL,
      itemMode: PARTY_ITEM_MODE_FFA,
      level: 1,
      exp: 0,
      point: 0,
      lastItemGetterId: NULL_ID,
      kindTroup: PARTY_KIND_SOLO,
      name: '',
    };
    this.parties.set(party.id, party);
    this.persistCreate(party);
    return party;
  }

  get(partyId: number): Party | undefined { return this.parties.get(partyId); }

  /** Find the party a character belongs to (linear scan -- rosters are small). */
  getByMember(charId: number): Party | undefined {
    for (const p of this.parties.values()) {
      if (p.members.includes(charId)) return p;
    }
    return undefined;
  }

  addMember(partyId: number, charId: number): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p || p.members.length >= MAX_PARTY_MEMBERS || p.members.includes(charId)) return undefined;
    p.members.push(charId);
    this.persistMembers(p);
    return p;
  }

  /**
   * Remove a member. Returns `{ party, disbanded }`; `disbanded=true` means the
   * party dropped below 2 members and was deleted. Caller is responsible for
   * clearing `m_idParty` on remaining members + sending disband notices.
   *
   * This is the ONLY path that shrinks a roster -- a logout does not (see
   * {@link onDisconnect}).
   */
  removeMember(partyId: number, charId: number): { party: Party | undefined; disbanded: boolean } {
    const p = this.parties.get(partyId);
    if (!p) return { party: undefined, disbanded: false };
    const idx = p.members.indexOf(charId);
    if (idx === -1) return { party: p, disbanded: false };
    p.members.splice(idx, 1);
    if (p.members.length < 2) {
      this.parties.delete(partyId);
      this.persistRemove(partyId);
      return { party: p, disbanded: true };
    }
    this.persistMembers(p);
    return { party: p, disbanded: false };
  }

  /**
   * Swap `targetId` into slot 0 -- C++ `CParty::ChangeLeader`.
   *
   * Returns undefined when `targetId` is NOT a member: C++ `ChangeLeader` feeds
   * `FindMember`'s -1 straight into `SwapPartyMember(0, -1)`, which memcpy's
   * out of bounds. The client runs the same code on the ADDPARTYCHANGELEADER
   * notice, so promoting a non-member would corrupt every member's client.
   * Also undefined for `idx === 0` (already the leader) -- nothing to notify.
   */
  promoteLeader(partyId: number, targetId: number): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    const idx = p.members.indexOf(targetId);
    if (idx <= 0) return undefined;
    const tmp = p.members[0];
    p.members[0] = p.members[idx];
    p.members[idx] = tmp;
    this.persistMembers(p);
    return p;
  }

  /** List members (leader first). Returns empty for an unknown id. */
  members(partyId: number): number[] { return this.parties.get(partyId)?.members ?? []; }

  /**
   * `SubLootDropMobParty` sequential pick (`MoverActEvent.cpp:2434-2456`): find
   * `lastItemGetterId` in `candidates` (the NEARBY members, leader-ordered) and
   * return the NEXT one, wrapping to `candidates[0]`. When the last getter is
   * not in range (or there was none), `candidates[0]` takes it -- exactly the
   * C++ `pGetUser == NULL` fallback.
   *
   * Takes the candidate list rather than the full roster because the C++ walks
   * `pListMember` (range-filtered), not `m_aMember`. Caller records the winner
   * via {@link setLastItemGetter}.
   */
  nextSequentialLooter(partyId: number, candidates: number[]): number | undefined {
    if (candidates.length === 0) return undefined;
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    const idx = candidates.indexOf(p.lastItemGetterId);
    if (idx === -1) return candidates[0];
    return candidates[(idx + 1) % candidates.length];
  }

  /** `pParty->m_nGetItemPlayerId = pGetUser->m_idPlayer` after a distribution. */
  setLastItemGetter(partyId: number, charId: number): void {
    const p = this.parties.get(partyId);
    if (!p) return;
    p.lastItemGetterId = charId;
    this.persistUpdate(partyId, { last_item_getter_id: charId });
  }

  /**
   * Leader-only mode change (`m_nTroupsShareExp` / `m_nTroupeShareItem`). The
   * service validates the range and does the broadcast; this just records +
   * persists. Returns the party, or undefined for an unknown id.
   */
  setExpMode(partyId: number, mode: number): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    p.expMode = mode;
    this.persistUpdate(partyId, { exp_mode: mode });
    return p;
  }

  /** Item-share counterpart of {@link setExpMode}. */
  setItemMode(partyId: number, mode: number): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    p.itemMode = mode;
    this.persistUpdate(partyId, { item_mode: mode });
    return p;
  }

  /**
   * Party-level exp accrual -- `CDPCoreSrvr::OnAddPartyExp` solo-party branch
   * (`DPCoreSrvr.cpp:764-786`), reached from `CParty::GetPoint`
   * (`party.cpp:264`) once per party kill:
   *
   * ```
   * nAddExp = int((nMonLv / 25 + 1) * 10) * s_fPartyExpRate   // int div on nMonLv
   * m_nExp += nAddExp
   * if( m_nExp >= m_aExpParty[m_nLevel].Exp ) {
   *   m_nExp   -= m_aExpParty[m_nLevel].Exp
   *   m_nPoint += m_aExpParty[m_nLevel].Point
   *   m_nLevel++
   * }
   * ```
   *
   * Note the single `if`, not a `while`: C++ levels the party at most ONCE per
   * kill and carries the remainder, so a huge `rate` cannot skip levels. Kept
   * verbatim. A solo party at `MAX_PARTY_LEVEL` gains nothing (the C++ guard is
   * on the level check, so exp stops accruing entirely -- it does not sit
   * capped at the threshold).
   *
   * Returns the mutated party when anything changed (so the caller can push
   * PARTYEXP), or `undefined` for an unknown id / a maxed party.
   *
   * ponytail: `bSuperLeader` (II_SYS_SYS_SCR_SUPERLEADERPARTY buff -> x2) and
   * the v12 `bLeaderSMExpUp` scroll (x1.5); neither buff item is ported. The
   * guild-party branch (`m_nKindTroup == 1`, its own uncapped level curve at
   * `DPCoreSrvr.cpp:788-820`) is out of scope with guild parties.
   */
  addPartyExp(partyId: number, monsterLevel: number, rate = 1.0): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    // Solo-party only, and only below the cap (C++ gates on both).
    if (p.kindTroup !== PARTY_KIND_SOLO) return undefined;
    if (p.level >= MAX_PARTY_LEVEL) return undefined;
    const addExp = Math.trunc(Math.trunc(Math.trunc(monsterLevel / 25) + 1) * 10 * rate);
    if (addExp <= 0) return undefined;
    p.exp += addExp;
    const row = PARTY_EXP_TABLE[p.level];
    if (row !== undefined && p.exp >= row.exp) {
      p.exp -= row.exp;
      p.point += row.point;
      p.level++;
    }
    this.persistUpdate(p.id, { level: p.level, exp: p.exp, point: p.point });
    return p;
  }

  /**
   * `pParty->m_nKindTroup = 1; strcpy(m_sParty, sParty)` --
   * `CDPCoreClient::OnPartyChangeTroup` (`DPCoreClient.cpp:1348`). One-way.
   * Returns the party, or undefined for an unknown id.
   */
  advanceToTroupe(partyId: number, name: string): Party | undefined {
    const p = this.parties.get(partyId);
    if (!p) return undefined;
    p.kindTroup = PARTY_KIND_TROUPE;
    p.name = name.slice(0, MAX_PARTY_NAME_LEN);
    this.persistUpdate(partyId, { kind_troup: p.kindTroup, name: p.name });
    return p;
  }

  /**
   * Disconnect hook -- clear pending invites referencing `charId` (as leader or
   * target), then report the party they are (still) in.
   *
   * **The member is NOT removed.** This mirrors `CPartyMng::RemoveConnection`
   * (`party.cpp:1199`), which sets `m_bRemove = TRUE` and leaves the roster
   * intact; only an explicit leave/kick or the (unported) 600 s reaper calls
   * `DeleteMember`. It diverges from C++ in one place: when the LEADER
   * disconnects and every other member is already offline, C++ deletes the party
   * (`:1259`) -- here it survives, which is the whole point of durable parties.
   *
   * `wasLeader` lets the service hand leadership to a still-online member (the
   * `SwapPartyMember(0, j)` half of `RemoveConnection`, which the client mirrors
   * on receiving the PP_REMOVE delta at `DPClient.cpp:5402`).
   */
  onDisconnect(charId: number): { party: Party | undefined; wasLeader: boolean } {
    if (this.pending.has(charId)) this.removePending(charId);
    for (const [memberId, inv] of this.pending) {
      if (inv.leaderId === charId) { clearTimeout(inv.timer); this.pending.delete(memberId); }
    }
    const party = this.getByMember(charId);
    if (!party) return { party: undefined, wasLeader: false };
    return { party, wasLeader: party.members[0] === charId };
  }

  // ── Persistence (fire-and-forget; a DB failure never breaks a broadcast) ───

  private persistCreate(p: Party): void {
    void this.repo?.create(snapshotForDb(p)).catch((err: unknown) => {
      logger.error({ err, partyId: p.id }, 'party create persist failed');
    });
  }

  private persistMembers(p: Party): void {
    void this.repo?.replaceMembers(p.id, [...p.members]).catch((err: unknown) => {
      logger.error({ err, partyId: p.id }, 'party roster persist failed');
    });
  }

  private persistUpdate(partyId: number, data: PartyUpdatePatch): void {
    void this.repo?.update(partyId, data).catch((err: unknown) => {
      logger.error({ err, partyId }, 'party update persist failed');
    });
  }

  private persistRemove(partyId: number): void {
    void this.repo?.remove(partyId).catch((err: unknown) => {
      logger.error({ err, partyId }, 'party remove persist failed');
    });
  }
}

/** Column patch shape accepted by {@link PartyPersistence.update}. */
type PartyUpdatePatch = Parameters<PartyPersistence['update']>[1];

/** Flatten a live {@link Party} into the repo's insert shape. */
function snapshotForDb(p: Party): Parameters<PartyPersistence['create']>[0] {
  return {
    id: p.id, kindTroup: p.kindTroup, name: p.name, level: p.level, exp: p.exp,
    point: p.point, expMode: p.expMode, itemMode: p.itemMode,
    lastItemGetterId: p.lastItemGetterId, members: [...p.members],
  };
}
