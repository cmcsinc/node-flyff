/**
 * GuildWarService -- declare / accept / surrender / truce / death / timeout.
 *
 * Collapses three C++ layers: the CoreServer authority half
 * (`CDPCacheSrvr::OnDeclWar` / `OnAcptWar` / `OnSurrender` / `OnQueryTruce` /
 * `OnAcptTruce`, `DPCacheSrvr.cpp:2275-2594`), the CoreServer event half
 * (`CDPCoreSrvr::OnWarDead` / `OnWarMasterAbsent` / `OnWarTimeout`,
 * `DPCoreSrvr.cpp:1623-1750`), and the world-side tick (`CGuildWar::Process`,
 * `guildwar.cpp:64-89`). Real Flyff round-trips each of these between two
 * processes; this emulator is single-world, so they become direct calls.
 *
 * **Two deliberate divergences from the C++.** Both are recorded in
 * `docs/c++-fidelity-audit.md`; each site carries a `divergence:` comment.
 *
 * 1. **Declaration is gated on the war flag.** In C++ `EVE_GUILDWAR` gates only
 *    world-side behaviour (`IsWarTarget`, the expiry tick) while CoreServer's
 *    declare/accept run unconditionally. With the flag off -- its default -- a
 *    war can therefore be started, lock every roster mutation on BOTH guilds
 *    (ten `GetWar()` guards), and never end, because the only thing that ends it
 *    is the tick the flag disables. That is not a behaviour worth reproducing.
 *
 * 2. **Accept is validated against a stored proposal.** C++ `OnAcptWar` takes
 *    `idDecl` straight off the wire and never checks that guild ever declared
 *    anything (the author's own `// fixme - raiders` sits on the function,
 *    `DPCacheSrvr.cpp:2502`), so any master could forge a war against any
 *    eligible guild. Truce has the mirror hole: `OnAcptTruce` calls `Result`
 *    with no master check and no check that the accepter is the guild that was
 *    ASKED. Both are validated here.
 *
 * ponytail: `SetPKTargetLimit(10)` (`guildwar.cpp:244`) -- the PK-target counter
 * is unported, so nothing to reset. The TID_* refusal texts are also unsent; see
 * `GuildService`'s note on the notice seam.
 *
 * @module services/guildWar
 */

import type { CPlayer } from '@flyff/entities';
import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import {
  NULL_ID, VISIBILITY_RADIUS,
  buildDeclWar, buildAcptWar, buildSurrender, buildQueryTruce,
  buildWarEnd, buildWarDead, buildSetWar, buildMyGuildWar,
  WR_DECL_SR, WR_ACPT_SR, WR_TRUCE,
  WR_DECL_GN, WR_ACPT_GN, WR_ACPT_AB, WR_ACPT_DD,
  GUILD_WAR_MIN_LEVEL, GUILD_WAR_MIN_TARGET_MEMBERS, GUILD_WAR_SURRENDER_PERCENT,
} from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';
import type { GuildManager, Guild } from '../managers/guild.manager';
import type { GuildWarManager, War } from '../managers/guildWar.manager';
import {
  TID_GAME_COMNOHAVECOM, TID_GAME_COMDELNOTKINGPIN,
  TID_GAME_GUILDWARREQLV6, TID_GAME_GUILDWARSTILLNOWAR,
  TID_GAME_GUILDWARNOTHINGGUILD, TID_GAME_GUILDWAROHTERLV6,
  TID_GAME_GUILDWARMASTEROFF, TID_GAME_GUILDWARMEMBER10,
  TID_GAME_GUILDWAROTHERWAR, TID_GAME_GUILDWARNOREQUEST,
  TID_GAME_GUILDWARNOFINDGUILD, TID_GAME_GUILDWARNOETC,
} from '../guildText';

const logger = createLogger({ module: 'guild-war-service' });

/**
 * A live declaration awaiting the target master's answer.
 *
 * This record is the fix for divergence 2. Keyed by the TARGET guild id, since
 * that is who answers; C++ keeps no such state at all, which is precisely the
 * hole. There is no decline opcode (the client's "No" button is a bare
 * `Destroy()` with no send, `WndGuildWarRequest.cpp:84-91`), so the only way a
 * proposal leaves is by being accepted or expiring.
 */
export interface WarProposal {
  readonly declGuildId: number;
  readonly targetGuildId: number;
  readonly expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A live truce request awaiting the other master's answer. Same shape and same
 * reason as {@link WarProposal}: `OnAcptTruce` validates nothing, so the ASK has
 * to be remembered. Keyed by the war id -- there is at most one truce question
 * open per war.
 */
export interface TruceRequest {
  readonly warId: number;
  /** The guild that ASKED for the truce. */
  readonly fromGuildId: number;
  /** The guild being asked -- only its master may accept. */
  readonly toGuildId: number;
}

/** How long a declaration stays open. C++ has no TTL; matches the invite TTL. */
export const WAR_PROPOSAL_TIMEOUT_MS = 60_000;

export interface GuildWarServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  guildManager: GuildManager;
  guildWarManager: GuildWarManager;
  /**
   * `g_eLocal.GetState( EVE_GUILDWAR )` -- the runtime event flag, config-backed
   * (`world.guildWarEnabled`, default false = vanilla). A closure rather than a
   * boolean so a GM command can flip it without recomposing.
   */
  isWarEnabled: () => boolean;
  /**
   * Refusal-notice sink -- `CDPCacheSrvr::SendDefinedText` (`:657`). Optional;
   * without it the nine declare gates all refuse silently, which makes a failed
   * declaration indistinguishable from a bug.
   */
  sendDefinedText?: (player: CPlayer, tid: number, args?: string) => void;
  /** Injector seam for tests. */
  now?: () => number;
}

export class GuildWarService {
  private readonly now: () => number;
  /** Open declarations, keyed by the TARGET guild id. */
  private readonly proposals = new Map<number, WarProposal>();
  /** Open truce questions, keyed by war id. */
  private readonly truces = new Map<number, TruceRequest>();

  constructor(private readonly deps: GuildWarServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  // ── Declare ────────────────────────────────────────────────────────────────

  /**
   * DECL_GUILD_WAR -- `CDPCacheSrvr::OnDeclWar` (`DPCacheSrvr.cpp:2426-2500`).
   *
   * Every gate below is a port, in C++ order, with the TID it would send:
   * caller is guilded (TID_GAME_COMNOHAVECOM), caller is master
   * (TID_GAME_COMDELNOTKINGPIN), own level >= 6 (TID_GAME_GUILDWARREQLV6), not
   * already at war (TID_GAME_GUILDWARSTILLNOWAR), target guild exists
   * (TID_GAME_GUILDWARNOTHINGGUILD), target level >= 6
   * (TID_GAME_GUILDWAROHTERLV6), target master ONLINE
   * (TID_GAME_GUILDWARMASTEROFF), target roster >= 10
   * (TID_GAME_GUILDWARMEMBER10), target not at war
   * (TID_GAME_GUILDWAROTHERWAR), and not self.
   *
   * The three level/roster gates sit behind `#ifndef __INTERNALSERVER`, which is
   * UNSET in this tree, so all three are live.
   */
  declare_(master: CPlayer, targetGuildName: string): boolean {
    // divergence 1: C++ does not check the flag here -- see the module note.
    // TID_GAME_GUILDWARNOTSERVER is the closest C++ text ("not a war server"),
    // but it is never sent from the declare path there, so nothing is sent here
    // either: with the flag off the client should not show the button at all.
    if (!this.deps.isWarEnabled()) return false;

    const decl = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!decl) return this.refuse(master, TID_GAME_COMNOHAVECOM);                    // :2443
    if (decl.masterId !== master.m_idPlayer) {
      return this.refuse(master, TID_GAME_COMDELNOTKINGPIN);                          // :2448
    }
    if (decl.level < GUILD_WAR_MIN_LEVEL) {
      return this.refuse(master, TID_GAME_GUILDWARREQLV6);                            // :2454
    }
    if (this.warOf(decl)) return this.refuse(master, TID_GAME_GUILDWARSTILLNOWAR);     // :2461
    const acpt = this.deps.guildManager.getByName(targetGuildName.trim());
    if (!acpt) return this.refuse(master, TID_GAME_GUILDWARNOTHINGGUILD);              // :2468
    if (acpt.level < GUILD_WAR_MIN_LEVEL) {
      return this.refuse(master, TID_GAME_GUILDWAROHTERLV6);                           // :2474
    }
    const targetMaster = this.deps.playerManager.get(acpt.masterId);
    if (!targetMaster) return this.refuse(master, TID_GAME_GUILDWARMASTEROFF);          // :2481
    if (acpt.members.length < GUILD_WAR_MIN_TARGET_MEMBERS) {
      return this.refuse(master, TID_GAME_GUILDWARMEMBER10);                            // :2487
    }
    if (this.warOf(acpt)) return this.refuse(master, TID_GAME_GUILDWAROTHERWAR);        // :2493
    if (decl.id === acpt.id) return false;                                             // :2496
    // Not in C++ (which stores nothing), but a second open declaration against
    // the same guild would just overwrite the first -- refuse instead. Reuses the
    // "other guild is busy" text since that is what it means from here.
    if (this.proposals.has(acpt.id)) return this.refuse(master, TID_GAME_GUILDWAROTHERWAR);

    this.proposals.set(acpt.id, {
      declGuildId: decl.id, targetGuildId: acpt.id,
      expiresAt: this.now() + WAR_PROPOSAL_TIMEOUT_MS,
      timer: setTimeout(() => this.proposals.delete(acpt.id), WAR_PROPOSAL_TIMEOUT_MS),
    });
    // `SendDeclWar( pDecl->m_idGuild, pMaster->lpszPlayer, pPlayer )` (:2499):
    // the DECLARING guild's id and the declaring MASTER's name -- not the
    // target's name, and not the master's id.
    this.deps.playerManager.sendTo(targetMaster, buildDeclWar(decl.id, master.m_szName));
    logger.info({ decl: decl.id, acpt: acpt.id }, 'guild war declared');
    return true;
  }

  // ── Accept ─────────────────────────────────────────────────────────────────

  /**
   * ACPT_GUILD_WAR -- `CDPCacheSrvr::OnAcptWar` (`DPCacheSrvr.cpp:2503-2594`),
   * the function carrying the author's `// fixme - raiders`.
   *
   * Gates in C++ order: accepter guilded (TID_GAME_COMNOHAVECOM), accepter is
   * master (TID_GAME_COMDELNOTKINGPIN), accepter not at war
   * (TID_GAME_GUILDWARNOREQUEST), declaring guild exists
   * (TID_GAME_GUILDWARNOFINDGUILD), not self, declaring master ONLINE
   * (TID_GAME_GUILDWARMASTEROFF), declaring guild not at war
   * (TID_GAME_GUILDWAROTHERWAR).
   *
   * Note what C++ does NOT re-check here: neither guild's level, and not the
   * ten-member roster. Those are declare-time gates only, so a guild that drops
   * below ten between declare and accept still gets its war. Faithful.
   */
  accept(master: CPlayer, declGuildId: number): boolean {
    if (!this.deps.isWarEnabled()) return false;

    const acpt = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!acpt) return this.refuse(master, TID_GAME_COMNOHAVECOM);                       // :2518
    if (acpt.masterId !== master.m_idPlayer) {
      return this.refuse(master, TID_GAME_COMDELNOTKINGPIN);                            // :2523
    }
    if (this.warOf(acpt)) return this.refuse(master, TID_GAME_GUILDWARNOREQUEST);        // :2528
    const decl = this.deps.guildManager.get(declGuildId);
    if (!decl) return this.refuse(master, TID_GAME_GUILDWARNOFINDGUILD);                 // :2535
    if (decl.id === acpt.id) return false;                                              // :2539
    const declMaster = this.deps.playerManager.get(decl.masterId);
    if (!declMaster) return this.refuse(master, TID_GAME_GUILDWARMASTEROFF);              // :2548
    if (this.warOf(decl)) return this.refuse(master, TID_GAME_GUILDWAROTHERWAR);          // :2553

    // divergence 2: C++ trusts the client-supplied `idDecl` outright, so any
    // master could forge a war against any eligible guild. Require the
    // declaration we actually recorded. TID_GAME_GUILDWARNOREQUEST is the honest
    // text -- there is no request.
    const proposal = this.proposals.get(acpt.id);
    if (!proposal || proposal.declGuildId !== decl.id) {
      logger.warn(
        { acpt: acpt.id, claimed: declGuildId, master: master.m_idPlayer },
        'guild war accept with no matching declaration -- refused',
      );
      return this.refuse(master, TID_GAME_GUILDWARNOREQUEST);
    }
    this.clearProposal(acpt.id);

    // `nSize` is frozen here on purpose (`:2559`, `:2561`) -- the surrender
    // threshold divides by it, so a live count would let a guild dodge the 70%
    // rule by recruiting mid-war.
    const warId = this.deps.guildWarManager.addWar(
      decl.id, decl.members.length, acpt.id, acpt.members.length,
    );
    if (warId === 0) return false;                               // AddWar collision

    this.deps.guildManager.setWar(decl.id, warId, acpt.id);
    this.deps.guildManager.setWar(acpt.id, warId, decl.id);
    const war = this.deps.guildWarManager.get(warId);
    for (const guild of [decl, acpt]) this.enterWar(guild, warId, war);

    // `SendAcptWar` goes to DPID_ALLPLAYERS (`:2606`) -- the whole shard, not
    // just the two rosters: every client's war tab tracks live wars.
    this.deps.playerManager.broadcastAll(buildAcptWar(warId, decl.id, acpt.id));
    logger.info({ warId, decl: decl.id, acpt: acpt.id }, 'guild war started');
    return true;
  }

  /**
   * Stamp `m_idWar` on every online member and re-render them to their
   * neighbours -- the two roster loops of `OnAcptWar` (`:2573-2585`) plus the
   * SET_WAR fan-out that `Result` does on the way out (`guildwar.cpp:243`).
   *
   * SET_WAR goes to the affected player's VISIBILITY RANGE, not the roster
   * (`CUserMng::AddSetWar`, `User.cpp:5303-5313`): it is what makes a warring
   * player render as attackable to the enemy standing next to them.
   */
  private enterWar(guild: Guild, warId: number, war: War | undefined): void {
    for (const m of guild.members) {
      const p = this.deps.playerManager.get(m.characterId);
      if (!p) continue;
      p.m_idWar = warId;
      this.broadcastSetWar(p, warId);
      // The joining side's own client needs the full war record too; C++ sends
      // this only at JOIN (`AddMyGuildWar`), which leaves everyone already
      // online with an empty war window until they relog.
      if (war) this.deps.playerManager.sendTo(p, buildMyGuildWar(this.deps.guildWarManager.snapshot(war)));
    }
  }

  // ── Surrender ──────────────────────────────────────────────────────────────

  /**
   * SURRENDER -- `CDPCacheSrvr::OnSurrender` (`DPCacheSrvr.cpp:2275-2333`).
   *
   * Any member may surrender, not just the master. Two things end the war: the
   * MASTER surrendering, or the side's surrender count passing 70% of its frozen
   * roster size (`:2312`). Note the C++ comparison is `> 70`, strictly greater,
   * on integer-truncated `(count * 100) / size` -- so at size 10 it takes 8
   * surrenders, not 7.
   *
   * The result type is the OPPOSING side's win: the declarer surrendering yields
   * `WR_ACPT_SR` (`:2313`).
   *
   * Two faithful oddities kept: the surrender notice fans out to BOTH rosters
   * (`SendSurrender`, `:2337-2348`), and `pPlayer->m_idWar = 0` at the tail
   * (`:2332`) runs unconditionally -- even for a non-member whose `if` block
   * never ran, and even when the war continues. So a surrendering member drops
   * out of the war individually while their guild stays in it.
   */
  surrender(player: CPlayer): boolean {
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return this.refuse(player, TID_GAME_COMNOHAVECOM);
    const war = this.warOf(guild);
    // TID_GAME_GUILDWARNOETC -- not in a war (:2291).
    if (!war) { player.m_idWar = 0; return this.refuse(player, TID_GAME_GUILDWARNOETC); }
    const other = this.otherGuild(war, guild.id);
    if (!other) return false;                                    // :2297

    const side = this.deps.guildWarManager.sideOf(war, guild.id);
    if (!side) return false;
    if (!this.deps.guildManager.getMember(guild.id, player.m_idPlayer)) return false;

    this.deps.guildManager.addMemberSurrender(guild.id, player.m_idPlayer);
    const count = this.deps.guildWarManager.addSurrender(war, guild.id);
    const isDecl = this.deps.guildWarManager.isDecl(war, guild.id);

    const notice = buildSurrender(war.id, player.m_idPlayer, player.m_szName, isDecl);
    this.toBothRosters(war, notice);

    const isMaster = guild.masterId === player.m_idPlayer;
    const ratio = side.size > 0 ? Math.trunc((count * 100) / side.size) : 0;
    if (isMaster || ratio > GUILD_WAR_SURRENDER_PERCENT) {
      this.result(war, isDecl ? WR_ACPT_SR : WR_DECL_SR);
    }
    // Unconditional in C++ (:2332) -- see the doc note.
    player.m_idWar = 0;
    return true;
  }

  // ── Truce ──────────────────────────────────────────────────────────────────

  /**
   * QUERY_TRUCE -- `CDPCacheSrvr::OnQueryTruce` (`:2360-2400`). Master only;
   * asks the OTHER master, whose client shows the truce popup. The forwarded
   * packet has an EMPTY body (`SendQueryTruce`, `:2627-2631`) -- the receiving
   * client already knows which war it is in.
   */
  queryTruce(master: CPlayer): boolean {
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!guild) return this.refuse(master, TID_GAME_COMNOHAVECOM);
    const war = this.warOf(guild);
    if (!war) return this.refuse(master, TID_GAME_GUILDWARNOETC);                        // :2373
    if (guild.masterId !== master.m_idPlayer) {
      return this.refuse(master, TID_GAME_COMDELNOTKINGPIN);                             // :2380
    }
    const other = this.otherGuild(war, guild.id);
    if (!other) return false;                                                           // :2391
    const otherMaster = this.deps.playerManager.get(other.masterId);
    // TID_GAME_GUILDWARMASTEROFF -- nobody to ask (:2394 is silent in C++, but
    // silence here reads as a broken button).
    if (!otherMaster) return this.refuse(master, TID_GAME_GUILDWARMASTEROFF);

    this.truces.set(war.id, {
      warId: war.id, fromGuildId: guild.id, toGuildId: other.id,
    });
    this.deps.playerManager.sendTo(otherMaster, buildQueryTruce());
    return true;
  }

  /**
   * ACPT_TRUCE -- `CDPCacheSrvr::OnAcptTruce` (`:2402-2424`).
   *
   * C++ resolves the war from the accepter's `m_idWar` and calls `Result` with
   * ZERO further checks: no master test, and no test that this guild is the one
   * that was asked. So any member of either guild could end a war at will, and
   * the guild that ASKED could accept its own request.
   *
   * divergence 2: require the open truce request, require the accepter to be the
   * guild that was asked, and require them to be its master.
   */
  acceptTruce(master: CPlayer): boolean {
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!guild) return this.refuse(master, TID_GAME_COMNOHAVECOM);
    const war = this.warOf(guild);
    if (!war) return this.refuse(master, TID_GAME_GUILDWARNOETC);                        // :2415
    if (!this.otherGuild(war, guild.id)) return false;                                  // :2420

    const req = this.truces.get(war.id);
    if (!req || req.toGuildId !== guild.id) {
      logger.warn(
        { warId: war.id, guild: guild.id, player: master.m_idPlayer },
        'truce accept without a matching request -- refused',
      );
      return this.refuse(master, TID_GAME_GUILDWARNOREQUEST);
    }
    if (guild.masterId !== master.m_idPlayer) {
      return this.refuse(master, TID_GAME_COMDELNOTKINGPIN);
    }
    this.truces.delete(war.id);
    // WR_TRUCE is >= WR_TRUCE, so `Result` skips the whole win/lose block: a
    // truce ends the war and changes neither record (`guildwar.cpp:195`).
    this.result(war, WR_TRUCE);
    return true;
  }

  // ── Death ──────────────────────────────────────────────────────────────────

  /**
   * A warring player died -- `CDPCoreSrvr::OnWarDead`
   * (`DPCoreSrvr.cpp:1623-1676`). Called from the death path, not from a packet.
   *
   * Killing EITHER master ends the war immediately, and the winner falls out of
   * an ordinal coincidence worth pinning: `Result( ..., (int)bDecl )` (`:1647`)
   * passes the boolean "the dead player was on the declaring side" AS the result
   * type, which lands on `WR_DECL_GN` (0) or `WR_ACPT_GN` (1). So a dead
   * declaring master yields nType 1 = the ACCEPTER wins. Correct, but only
   * because those two enum values sit in that order.
   *
   * Any other death just bumps that side's `nDead` and notifies both rosters.
   */
  onWarDeath(player: CPlayer): void {
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const war = this.warOf(guild);
    if (!war) return;
    const other = this.otherGuild(war, guild.id);
    if (!other) return;

    const isDecl = this.deps.guildWarManager.isDecl(war, guild.id);
    // Either master, not just this guild's: C++ tests both (`:1645`), which is
    // the same condition here since the dead player belongs to one of them.
    if (guild.masterId === player.m_idPlayer || other.masterId === player.m_idPlayer) {
      this.result(war, isDecl ? WR_ACPT_GN : WR_DECL_GN);
      return;
    }
    this.deps.guildWarManager.addDead(war, guild.id);
    this.toBothRosters(war, buildWarDead(war.id, player.m_szName, isDecl));
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  /**
   * `CGuildWarMng::Process` -> `CGuildWar::Process` (`guildwar.cpp:64-89`),
   * called from the world loop behind the `EVE_GUILDWAR` flag
   * (`ThreadMng.cpp:466`).
   *
   * Two jobs, and only one runs per war per tick: past the two-hour mark, latch
   * `WF_END` and resolve; otherwise accumulate master-absence for whichever
   * side's master is offline.
   *
   * In C++ the latch and the resolution are separated by a round trip
   * (`SendWarTimeout` -> `OnWarTimeout`), so a war sits in `WF_END` for one
   * network hop. Here they are adjacent; the latch is still set first so a
   * re-entrant tick cannot resolve the same war twice.
   */
  tick(dtMs: number): void {
    if (!this.deps.isWarEnabled()) return;
    const nowMs = this.now();
    for (const war of this.deps.guildWarManager.all()) {
      if (this.deps.guildWarManager.isExpired(war, nowMs)) {
        this.deps.guildWarManager.markEnded(war);
        this.result(war, this.deps.guildWarManager.resolveTimeout(war));
        continue;
      }
      const decl = this.deps.guildManager.get(war.decl.guildId);
      const acpt = this.deps.guildManager.get(war.acpt.guildId);
      if (!decl || !acpt) continue;                               // :78
      if (!this.deps.playerManager.get(decl.masterId)) {
        this.deps.guildWarManager.addAbsent(war, true, dtMs);      // :82
      }
      if (!this.deps.playerManager.get(acpt.masterId)) {
        this.deps.guildWarManager.addAbsent(war, false, dtMs);     // :85
      }
    }
  }

  // ── Resolution ─────────────────────────────────────────────────────────────

  /**
   * `CGuildWarMng::Result` (`guildwar.cpp:165-330`) -- apply a WR_* outcome, tell
   * everyone, and delete the war.
   *
   * The winner mapping is the C++ switch verbatim: every `WR_DECL_*` picks the
   * declarer, every `WR_ACPT_*` the accepter -- and TRUCE/DRAW fall into the
   * DECL arm too (`:174-175`). That looks like a bug and is not: both are
   * `>= WR_TRUCE`, so the win/lose block is skipped entirely and `pWin`/`pLose`
   * are used only to name the two guilds being cleaned up.
   *
   * Order matters at the tail: WAR_END is sent BEFORE the war is removed
   * (`:265` vs `:329`) because the packet carries `pWar->m_idWar`.
   */
  private result(war: War, resultType: number): void {
    const decl = this.deps.guildManager.get(war.decl.guildId);
    const acpt = this.deps.guildManager.get(war.acpt.guildId);
    if (!decl || !acpt) {
      // Both guilds gone (disbanded while the flag was off, say). Nothing to
      // credit and nobody to tell -- just drop the record.
      this.deps.guildWarManager.removeWar(war.id);
      return;
    }
    // The C++ switch verbatim (`:170-189`). Parity would ALMOST work -- every
    // even WR_* is a DECL win and every odd one an ACPT win -- except WR_DRAW is
    // 9 and sits in the DECL arm anyway. Enumerate rather than be clever.
    const declWins = resultType !== WR_ACPT_GN
      && resultType !== WR_ACPT_SR
      && resultType !== WR_ACPT_AB
      && resultType !== WR_ACPT_DD;
    const win = declWins ? decl : acpt;
    const lose = declWins ? acpt : decl;

    if (this.deps.guildWarManager.isScoring(resultType)) {
      this.deps.guildManager.applyWarResult(win.id, lose.id);
    }

    // Clean up both sides (`:226-263`) -- unconditional, scoring or not.
    for (const guild of [decl, acpt]) {
      this.deps.guildManager.clearWar(guild.id);
      for (const m of guild.members) {
        const p = this.deps.playerManager.get(m.characterId);
        if (!p) continue;
        p.m_idWar = 0;
        // idWar 0 is the war-over signal; peers stop rendering them as hostile.
        this.broadcastSetWar(p, 0);
        // ponytail: `SetPKTargetLimit( 10 )` (`:244`) -- unported counter.
      }
    }

    // DPID_ALLPLAYERS (`SendWarEnd`, `:2613`) -- the whole shard.
    this.deps.playerManager.broadcastAll(
      buildWarEnd(war.id, decl.winPoint, acpt.winPoint, resultType),
    );
    this.truces.delete(war.id);
    this.deps.guildWarManager.removeWar(war.id);
    logger.info({ warId: war.id, resultType, winner: win.id }, 'guild war ended');
  }

  // ── Query / seams ──────────────────────────────────────────────────────────

  /**
   * `CMover::IsWarTarget` (`MoverAttack.cpp:2047-2055`) -- may these two players
   * hit each other on account of a guild war?
   *
   * All four conditions are load-bearing: the flag, a non-zero war id, the SAME
   * war id, and DIFFERENT guilds. The last one is what stops friendly fire
   * inside a warring guild, and it is why a member who surrendered
   * (`m_idWar = 0`) becomes untargetable rather than switching sides.
   */
  isWarTarget(attacker: CPlayer, target: CPlayer): boolean {
    if (!this.deps.isWarEnabled()) return false;
    return attacker.m_idWar > 0
      && attacker.m_idWar === target.m_idWar
      && attacker.m_idGuild !== target.m_idGuild;
  }

  /**
   * Is this player currently in a live war? The gate behind two C++ refusals
   * that are easy to miss because they live outside the war files:
   *
   * - **Ordinary PK is suppressed entirely.** `GetHitType`/`GetHitType2` return
   *   HITTYPE_FAIL when the flag is on and EITHER side has `m_idWar > 0`
   *   (`MoverAttack.cpp:1945-1949`, mirrored at `:1963-1967`). So a warring
   *   player cannot PK anyone — not even an unrelated stranger with PK mode on.
   *   The war branch runs BEFORE this, so enemies are still attackable.
   * - **Duels are refused.** `CMover::CanDuel` bails with
   *   TID_GAME_GUILDWARERRORDUEL (`Mover.cpp:7173-7181`).
   */
  isInWar(player: CPlayer): boolean {
    if (!this.deps.isWarEnabled()) return false;
    return player.m_idWar > 0;
  }

  /**
   * JOIN seam -- `CUser::AddMyGuildWar` (`User.cpp:1930-1945`), sent third after
   * ALL_GUILDS then GUILD (`:330-332`). Also re-stamps `m_idWar` on the mover,
   * which C++ gets for free because the CoreServer player record carries it.
   */
  onJoin(player: CPlayer): void {
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const war = this.warOf(guild);
    if (!war) { player.m_idWar = 0; return; }
    player.m_idWar = war.id;
    this.deps.playerManager.sendTo(player, buildMyGuildWar(this.deps.guildWarManager.snapshot(war)));
  }

  /**
   * Re-link guilds to wars after both managers have hydrated -- the tail of the
   * C++ war-load query, which sets each side's `m_idEnemyGuild` from the loaded
   * rows. A war whose guilds are both gone is dropped.
   */
  relinkAfterHydrate(): void {
    for (const war of this.deps.guildWarManager.all()) {
      const decl = this.deps.guildManager.get(war.decl.guildId);
      const acpt = this.deps.guildManager.get(war.acpt.guildId);
      if (!decl || !acpt) {
        logger.warn({ warId: war.id }, 'war references a missing guild -- dropping');
        this.deps.guildWarManager.removeWar(war.id);
        continue;
      }
      this.deps.guildManager.setWar(decl.id, war.id, acpt.id);
      this.deps.guildManager.setWar(acpt.id, war.id, decl.id);
    }
  }

  /** Drop a pending declaration aimed at this guild (disband / test cleanup). */
  clearProposal(targetGuildId: number): void {
    const p = this.proposals.get(targetGuildId);
    if (!p) return;
    clearTimeout(p.timer);
    this.proposals.delete(targetGuildId);
  }

  /** Cancel every timer -- shutdown. */
  dispose(): void {
    for (const p of this.proposals.values()) clearTimeout(p.timer);
    this.proposals.clear();
    this.truces.clear();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Send the TID line and return false, so guards stay single-expression. */
  private refuse(player: CPlayer, tid: number, args?: string): false {
    this.deps.sendDefinedText?.(player, tid, args);
    return false;
  }

  /** `pGuild->GetWar()` -- the registry lookup, with stale-id self-heal. */
  private warOf(guild: Guild): War | undefined {
    if (guild.idWar === 0) return undefined;
    const war = this.deps.guildWarManager.get(guild.idWar);
    if (war) return war;
    this.deps.guildManager.clearWar(guild.id);
    return undefined;
  }

  /** The opposing guild in a war, or undefined when either side is gone. */
  private otherGuild(war: War, guildId: number): Guild | undefined {
    const otherId = war.decl.guildId === guildId ? war.acpt.guildId : war.decl.guildId;
    return this.deps.guildManager.get(otherId);
  }

  /** Fan a packet out to every online member of BOTH sides. */
  private toBothRosters(war: War, packet: Buffer): void {
    for (const id of [war.decl.guildId, war.acpt.guildId]) {
      const guild = this.deps.guildManager.get(id);
      if (!guild) continue;
      for (const m of guild.members) {
        const p = this.deps.playerManager.get(m.characterId);
        if (p) this.deps.playerManager.sendTo(p, packet);
      }
    }
  }

  /** SET_WAR to the affected player's visibility range (`User.cpp:5303`). */
  private broadcastSetWar(player: CPlayer, idWar: number): void {
    const packet = buildSetWar(player.m_idPlayer, idWar);
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet, player,
    );
    // The affected player is `except` above, but their own client also drives
    // the war UI off this, so send it directly too.
    this.deps.playerManager.sendTo(player, packet);
  }
}
