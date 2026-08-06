/**
 * GuildService -- the v19 guild state machine.
 *
 * Collapses two C++ layers into one: the CoreServer authority half
 * (`CDPCacheSrvr::On*`, `CORESERVER/DPCacheSrvr.cpp:1185-1855` + the create path
 * in `CDPCoreSrvr::OnCreateGuild`, `DPCoreSrvr.cpp:1345`) and the world-server
 * relay half (`CDPSrvr::OnGuild*`, `WORLDSERVER/DPSrvr.cpp:1790-1955`). Real
 * Flyff round-trips every guild mutation through CoreServer; this emulator is
 * single-world, so those hops become direct calls.
 *
 * **Every permission check in this file is a port, not a design.** The C++
 * refusal branches (and the TID_* message each one sends) are named at each
 * guard so a future reader can diff them against `DPCacheSrvr.cpp` directly.
 * The refusal *messages* are not sent yet -- `SendDefinedText` needs the guild
 * TID block wired through the notice seam (ponytail below); the guards
 * themselves are faithful and simply return.
 *
 * Sends: guild notices fan out over the whole roster (which can span zones), so
 * everything is a member-loop `playerManager.sendTo` -- never `broadcastAround`.
 * The three global announcements (CREATE_GUILD, DESTROY_GUILD, GUILD_SETNAME,
 * GUILD_LOGO) go to every connected player because each client keeps its own
 * `g_GuildMng` name cache.
 *
 * ponytail: guild bank, votes, guild war (every `pGuild->GetWar()` guard below
 * is a no-op stub until phase 5), guild quests, contribution/level-up, the
 * 21:00 salary tick, and the TID_* refusal texts.
 *
 * @module services/guild
 */

import type { CPlayer } from '@flyff/entities';
import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import {
  NULL_ID, VISIBILITY_RADIUS,
  buildGuild, buildAllGuilds, buildSetGuild, buildCreateGuild, buildDestroyGuild,
  buildGuildInvite, buildGuildNotice, buildGuildAuthority, buildGuildPenya,
  buildGuildLogo, buildAddGuildMember, buildRemoveGuildMember,
  buildGuildMemberLevel, buildGuildClass, buildGuildNickname, buildChgMaster,
  buildGuildSetName, buildGuildChat, buildGuildGameLogin, buildGuildGameJoin,
  buildGuildError,
  GUD_MASTER, GUD_ROOKIE, MAX_GM_LEVEL, PF_MEMBERLEVEL, PF_LEVEL, PF_INVITATION,
  MAX_G_NAME, MAX_BYTE_NOTICE, CUSTOM_LOGO_MAX, GUILD_LOGO_GM_ONLY_ABOVE,
  GUILD_ERROR_DUPLICATE_NAME, GUILD_ERROR_BAD_PENYA, MAX_GUILD_RANK_PENYA,
  GUILD_MULTI_NO_DEFAULT,
  type GuildSnapshot, type GuildMemberSnapshot,
} from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';
import {
  GuildManager, type Guild, type GuildMemberState,
} from '../managers/guild.manager';
import type { GuildWarManager } from '../managers/guildWar.manager';
import {
  GUILD_INVITE_TIMEOUT_MS, GUILD_NICKNAME_MIN_LEVEL,
  GUILD_NICKNAME_MIN_LEN, GUILD_NICKNAME_MAX_LEN,
  GUILD_CLASS_MIN, GUILD_CLASS_MAX,
} from '../guildTable';

const logger = createLogger({ module: 'guild-service' });

export interface GuildServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  guildManager: GuildManager;
  /**
   * GM-authority probe -- `CUser::IsAuthHigher( AUTH_GAMEMASTER )`, used only by
   * the logo gate (`DPSrvr.cpp:1833`). A closure so this package stays free of
   * any authority-constant import.
   */
  isGameMaster?: (player: CPlayer) => boolean;
  /**
   * Live war registry -- the backing store for {@link GuildService.isAtWar}.
   * Optional: a world composed without the war subsystem simply reads every
   * guild as at peace, which is exactly what `EVE_GUILDWAR = 0` means anyway.
   */
  guildWarManager?: Pick<GuildWarManager, 'get'>;
  /** Injector seam for tests. */
  now?: () => number;
}

export class GuildService {
  private readonly now: () => number;
  private readonly isGameMaster: (player: CPlayer) => boolean;

  constructor(private readonly deps: GuildServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.isGameMaster = deps.isGameMaster ?? ((): boolean => false);
  }

  // ── Creation / destruction ─────────────────────────────────────────────────

  /**
   * Create a guild with `master` at GUD_MASTER and `memberIds` at GUD_ROOKIE --
   * `CDPCoreSrvr::OnCreateGuild` (`DPCoreSrvr.cpp:1345-1447`).
   *
   * The *eligibility* rules (quest done, 3M penya, party of 3+ all guildless --
   * `NpcScript.cpp:10940` + `ScriptLib.cpp:737 IsPartyGuild`) live at the NPC
   * script call site, not here; this is the `CreateGuild()` primitive itself.
   * The two guards C++ puts in `OnCreateGuild` proper ARE here: caller already
   * guilded, and duplicate name.
   *
   * Returns the new guild, or undefined on either refusal.
   */
  create(master: CPlayer, name: string, memberIds: readonly number[] = []): Guild | undefined {
    // TID_GAME_COMCREATECOM -- already in a guild (:1367).
    if (this.deps.guildManager.getByMember(master.m_idPlayer)) return undefined;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_G_NAME) return undefined;
    // TID_GAME_COMOVERLAPNAME -- duplicate name (:1375).
    if (this.deps.guildManager.getByName(trimmed)) {
      this.deps.playerManager.sendTo(master, buildGuildError(GUILD_ERROR_DUPLICATE_NAME));
      return undefined;
    }
    const guild = this.deps.guildManager.create(trimmed, master.m_idPlayer, memberIds);
    if (!guild) return undefined;

    for (const m of guild.members) {
      const p = this.deps.playerManager.get(m.characterId);
      if (p) {
        p.m_idGuild = guild.id;
        this.deps.playerManager.sendTo(p, buildGuild(this.snapshot(guild)));
        this.broadcastSetGuild(p, guild.id);
      }
    }
    // Global announcement -- every client caches the new guild (User.cpp:5268).
    this.broadcastAll(buildCreateGuild(master.m_idPlayer, guild.id, master.m_szName, guild.name));
    logger.info({ guildId: guild.id, name: guild.name, master: master.m_idPlayer }, 'guild created');
    return guild;
  }

  /**
   * Disband -- `CDPCacheSrvr::OnDestroyGuild` (`:1185`). Master only, not at
   * war. Every member is cleared, cooldown-stamped, and told; then the whole
   * shard is told.
   */
  destroy(master: CPlayer): void {
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    // TID_GAME_COMNOHAVECOM -- not in a guild; C++ also clears the stale id.
    if (!guild) { master.m_idGuild = NULL_ID; return; }
    // TID_GAME_COMDELNOTKINGPIN -- not the master (:1211).
    if (guild.masterId !== master.m_idPlayer) return;
    // TID_GAME_GUILDWARNODISMISS -- at war (:1218).
    if (this.isAtWar(guild)) return;

    const members = [...guild.members];
    this.deps.guildManager.destroy(guild.id);
    for (const m of members) {
      const p = this.deps.playerManager.get(m.characterId);
      if (!p) continue;
      p.m_idGuild = NULL_ID;
      this.deps.playerManager.sendTo(p, buildRemoveGuildMember(m.characterId, guild.id));
      this.broadcastSetGuild(p, 0);
    }
    this.broadcastAll(buildDestroyGuild(master.m_szName, guild.id));
    logger.info({ guildId: guild.id }, 'guild destroyed');
  }

  // ── Invite / accept / decline ──────────────────────────────────────────────

  /**
   * Invite the player behind mover `targetObjid` -- `CDPSrvr::InviteCompany`
   * (`DPSrvr.cpp:9960`). Note the client sends an OBJID, not a player id.
   *
   * Guards, in C++ order: inviter is a member; inviter's rank holds
   * PF_INVITATION (TID_GAME_GUILDINVAITNOTWARR); target not already guilded
   * (TID_GAME_COMACCEPTHAVECOM); target not duelling; guild not at war
   * (TID_GAME_GUILDWARNOMEMBER); target not in attack mode
   * (TID_GAME_BATTLE_NOTGUILD).
   */
  invite(inviter: CPlayer, targetObjid: number): void {
    const guild = this.deps.guildManager.getByMember(inviter.m_idPlayer);
    if (!guild) return;
    const member = this.deps.guildManager.getMember(guild.id, inviter.m_idPlayer);
    if (!member) return;
    if (!this.deps.guildManager.rankHasPower(guild.id, member.memberLv, PF_INVITATION)) return;

    const target = this.resolveByObjid(targetObjid);
    if (!target || target.m_idPlayer === inviter.m_idPlayer) return;
    if (this.deps.guildManager.getByMember(target.m_idPlayer)) return;
    if (target.m_nDuel > 0) return;
    if (this.isAtWar(guild)) return;
    if (this.deps.guildManager.hasPending(target.m_idPlayer)) return;
    // Roster full is checked again on accept (C++ checks it there, :1313) but
    // refusing early avoids a popup that can only fail.
    if (guild.members.length >= this.deps.guildManager.maxMembers(guild.id)) return;

    const timer = setTimeout(() => this.expireInvite(target.m_idPlayer), GUILD_INVITE_TIMEOUT_MS);
    this.deps.guildManager.addPending({
      guildId: guild.id, inviterId: inviter.m_idPlayer, targetId: target.m_idPlayer,
      expiresAt: this.now() + GUILD_INVITE_TIMEOUT_MS, timer,
    });
    // C++ zeroes the target's stale guild id before opening the dialog (:10014).
    target.m_idGuild = NULL_ID;
    this.deps.playerManager.sendTo(target, buildGuildInvite(guild.id, inviter.m_idPlayer));
  }

  /** Silent expiry -- C++ has no invite TTL, so there is no notice to port. */
  private expireInvite(targetId: number): void {
    this.deps.guildManager.removePending(targetId);
  }

  /**
   * Accept -- `CDPCacheSrvr::OnAddGuildMember` (`:1245`). Guards: inviter still
   * online (TID_GAME_GUILDCHROFFLINE), rejoin cooldown elapsed
   * (TID_GAME_GUILDNOTINCLUDE), guild still exists, not at war, target not
   * already guilded (TID_GAME_COMHAVECOM), roster not full
   * (TID_GAME_COMOVERMEMBER).
   *
   * The joiner receives a FULL guild snapshot; every existing member receives
   * the incremental ADD_GUILD_MEMBER -- the C++ branches on
   * `pPlayertmp == pPlayer` at `:1341`.
   */
  accept(target: CPlayer): void {
    const pending = this.deps.guildManager.getPending(target.m_idPlayer);
    if (!pending) return;
    this.deps.guildManager.removePending(target.m_idPlayer);

    const inviter = this.deps.playerManager.get(pending.inviterId);
    if (!inviter) return;
    if (this.deps.guildManager.onCooldown(target.m_idPlayer)) return;
    const guild = this.deps.guildManager.get(pending.guildId);
    if (!guild) return;
    if (this.isAtWar(guild)) return;
    if (this.deps.guildManager.getByMember(target.m_idPlayer)) return;
    if (!this.deps.guildManager.addMember(guild.id, target.m_idPlayer)) return;

    target.m_idGuild = guild.id;
    for (const m of guild.members) {
      const p = this.deps.playerManager.get(m.characterId);
      if (!p) continue;
      if (p.m_idPlayer === target.m_idPlayer) {
        this.deps.playerManager.sendTo(p, buildGuild(this.snapshot(guild)));
      } else {
        this.deps.playerManager.sendTo(p, buildAddGuildMember(target.m_idPlayer, guild.id, target.m_szName));
      }
    }
    this.broadcastSetGuild(target, guild.id);
  }

  /**
   * Decline -- `CDPSrvr::OnIgnoreGuildInvite` (`DPSrvr.cpp:1801`). The only
   * effect is a TID_GAME_COMACCEPTDENY line to the inviter, which needs the
   * notice seam; for now it just clears the pending slot.
   */
  decline(target: CPlayer): void {
    this.deps.guildManager.removePending(target.m_idPlayer);
  }

  // ── Leave / kick ───────────────────────────────────────────────────────────

  /**
   * Leave (requester === targetId) or kick (master only) --
   * `CDPCacheSrvr::OnRemoveGuildMember` (`:1357`).
   *
   * The asymmetry is the point: kicking requires mastership
   * (TID_GAME_COMLEAVENOKINGPIN), while leaving requires you NOT be the master
   * (TID_GAME_COMLEAVEKINGPIN) -- a master must transfer or disband. Both are
   * blocked during a war (TID_GAME_GUILDWARNOMEMBER).
   */
  leaveOrKick(requester: CPlayer, targetId: number): void {
    const guild = this.deps.guildManager.getByMember(requester.m_idPlayer);
    if (!guild) { requester.m_idGuild = NULL_ID; return; }
    if (this.isAtWar(guild)) return;

    const isSelf = requester.m_idPlayer === targetId;
    if (isSelf) {
      // A master may not simply leave (:1406).
      if (guild.masterId === requester.m_idPlayer) return;
    } else {
      if (!this.deps.guildManager.getMember(guild.id, targetId)) return;
      if (guild.masterId !== requester.m_idPlayer) return;
    }
    if (!this.deps.guildManager.removeMember(guild.id, targetId)) return;

    const removed = this.deps.playerManager.get(targetId);
    if (removed) {
      removed.m_idGuild = NULL_ID;
      this.deps.playerManager.sendTo(removed, buildRemoveGuildMember(targetId, guild.id));
      this.broadcastSetGuild(removed, 0);
    }
    this.toRoster(guild, buildRemoveGuildMember(targetId, guild.id));
  }

  // ── Ranks / class / nickname / mastership ──────────────────────────────────

  /**
   * Promote or demote -- `CDPCacheSrvr::OnGuildMemberLv` (`:1441`).
   *
   * Guards in C++ order: not at war; target is a member; requester's rank is
   * strictly MORE senior than the target's (`pMember1->m_nMemberLv >=
   * pMember2->m_nMemberLv` refuses -- TID_GAME_GUILDAPPOVER); requester's rank
   * is strictly more senior than the NEW rank (TID_GAME_GUILDWARRANTREGOVER);
   * requester holds PF_MEMBERLEVEL (TID_GAME_GUILDAPPNOTWARRANT); the rank id is
   * in range; and the target rank's headcount cap is not exceeded
   * (TID_GAME_GUILDAPPNUMOVER).
   *
   * Numerically lower == more senior, so "strictly more senior" is `<`.
   */
  setMemberLevel(requester: CPlayer, targetId: number, memberLv: number): void {
    const guild = this.deps.guildManager.getByMember(requester.m_idPlayer);
    if (!guild) { requester.m_idGuild = NULL_ID; return; }
    if (this.isAtWar(guild)) return;
    const me = this.deps.guildManager.getMember(guild.id, requester.m_idPlayer);
    const them = this.deps.guildManager.getMember(guild.id, targetId);
    if (!me || !them) return;
    if (me.memberLv >= them.memberLv) return;
    if (me.memberLv >= memberLv) return;
    if (!this.deps.guildManager.rankHasPower(guild.id, me.memberLv, PF_MEMBERLEVEL)) return;
    if (memberLv < 0 || memberLv >= MAX_GM_LEVEL) return;
    const cap = this.deps.guildManager.maxRankMembers(guild.id, memberLv);
    if (this.deps.guildManager.rankCount(guild.id, memberLv) + 1 > cap) return;

    if (!this.deps.guildManager.setMemberLevel(guild.id, targetId, memberLv)) return;
    this.toRoster(guild, buildGuildMemberLevel(targetId, memberLv));
  }

  /**
   * Bump a member's sub-grade up (`up = true`) or down --
   * `CDPCacheSrvr::OnGuildClass` (`:1640`). Requires PF_LEVEL; the result is
   * range-checked to 0..2 and silently dropped outside it (C++ returns without
   * a message, `:1707`).
   */
  setMemberClass(requester: CPlayer, targetId: number, up: boolean): void {
    const guild = this.deps.guildManager.getByMember(requester.m_idPlayer);
    if (!guild) { requester.m_idGuild = NULL_ID; return; }
    if (this.isAtWar(guild)) return;
    const me = this.deps.guildManager.getMember(guild.id, requester.m_idPlayer);
    const them = this.deps.guildManager.getMember(guild.id, targetId);
    if (!me || !them) return;
    if (!this.deps.guildManager.rankHasPower(guild.id, me.memberLv, PF_LEVEL)) return;
    const next = up ? them.memberClass + 1 : them.memberClass - 1;
    if (next < GUILD_CLASS_MIN || next > GUILD_CLASS_MAX) return;

    if (!this.deps.guildManager.setMemberClass(guild.id, targetId, next)) return;
    this.toRoster(guild, buildGuildClass(targetId, next));
  }

  /**
   * Set a member's guild nickname -- `CDPCacheSrvr::OnGuildNickName` (`:1783`).
   * Master only, guild level >= 10 (TID_GAME_GUILDNOTLEVEL), 2..12 chars
   * (TID_DIAG_0011_01).
   */
  setMemberAlias(requester: CPlayer, targetId: number, alias: string): void {
    const guild = this.deps.guildManager.getByMember(requester.m_idPlayer);
    if (!guild) { requester.m_idGuild = NULL_ID; return; }
    if (guild.level < GUILD_NICKNAME_MIN_LEVEL) return;
    if (this.isAtWar(guild)) return;
    if (guild.masterId !== requester.m_idPlayer) return;
    const trimmed = alias.trim();
    if (trimmed.length < GUILD_NICKNAME_MIN_LEN || trimmed.length > GUILD_NICKNAME_MAX_LEN) return;
    if (!this.deps.guildManager.getMember(guild.id, targetId)) return;

    if (!this.deps.guildManager.setMemberAlias(guild.id, targetId, trimmed)) return;
    this.toRoster(guild, buildGuildNickname(targetId, trimmed));
  }

  /**
   * Hand the guild to another member -- `CDPCacheSrvr::OnChgMaster` (`:1719`).
   * Master only, both must be members, not at war, and not self.
   */
  changeMaster(master: CPlayer, newMasterId: number): void {
    if (master.m_idPlayer === newMasterId) return;
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!guild) { master.m_idGuild = NULL_ID; return; }
    if (!this.deps.guildManager.getMember(guild.id, newMasterId)) return;
    if (this.isAtWar(guild)) return;
    if (guild.masterId !== master.m_idPlayer) return;

    if (!this.deps.guildManager.changeMaster(guild.id, master.m_idPlayer, newMasterId)) return;
    this.toRoster(guild, buildChgMaster(master.m_idPlayer, newMasterId));
  }

  // ── Guild-wide settings ────────────────────────────────────────────────────

  /**
   * Rename -- `CDPCacheSrvr::OnGuildSetName` (`:1559`). Master only; a clash
   * sends GUILD_ERROR 1. Broadcast to ALL players, not just the guild.
   *
   * C++ additionally gates on `pGuild->m_szGuild == ""` (`:1578`) -- the rename
   * scroll path only works on an as-yet-unnamed guild. That branch is dead for
   * us: every guild here is created with a name (the `/createguild` + NPC paths
   * both supply one), so porting the guard would make rename permanently
   * unreachable. Faithful to intent (master-only, unique name) rather than to a
   * check that only fires on the unported QUERYSETGUILDNAME item flow.
   */
  rename(master: CPlayer, name: string): void {
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!guild) { master.m_idGuild = NULL_ID; return; }
    if (guild.masterId !== master.m_idPlayer) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_G_NAME) return;
    if (!this.deps.guildManager.rename(guild.id, trimmed)) {
      this.deps.playerManager.sendTo(master, buildGuildError(GUILD_ERROR_DUPLICATE_NAME));
      return;
    }
    this.broadcastAll(buildGuildSetName(guild.id, trimmed));
  }

  /**
   * Set the guild notice -- `CDPSrvr::OnGuildNotice` (`DPSrvr.cpp:1919`).
   * C++ drops an empty string on the floor and applies no rank check here (the
   * authority is implied by the client only showing the field to officers), so
   * only the length bound is enforced.
   */
  setNotice(player: CPlayer, notice: string): void {
    if (notice.length === 0) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const clipped = notice.slice(0, MAX_BYTE_NOTICE - 1);
    if (!this.deps.guildManager.setNotice(guild.id, clipped)) return;
    this.toRoster(guild, buildGuildNotice(guild.id, clipped));
  }

  /**
   * Set the guild logo -- `CDPSrvr::OnGuildLogo` (`DPSrvr.cpp:1818`).
   * `> CUSTOM_LOGO_MAX` is rejected outright; `> 20` needs AUTH_GAMEMASTER.
   * The logo is **write-once** (`CGuild::SetLogo` refuses a second call), so a
   * repeat is a silent no-op. Broadcast to ALL players.
   */
  setLogo(player: CPlayer, logo: number): void {
    if (logo > CUSTOM_LOGO_MAX) return;
    if (logo > GUILD_LOGO_GM_ONLY_ABOVE && !this.isGameMaster(player)) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    if (this.isAtWar(guild)) return;
    if (!this.deps.guildManager.setLogo(guild.id, logo)) return;
    this.broadcastAll(buildGuildLogo(guild.id, logo));
  }

  /**
   * Replace the rank authority mask -- `CDPCacheSrvr::OnGuildAuthority`
   * (`:1527`). Master only, not at war.
   */
  setAuthority(master: CPlayer, power: readonly number[]): void {
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!guild) return;
    if (guild.masterId !== master.m_idPlayer) return;
    if (this.isAtWar(guild)) return;
    const updated = this.deps.guildManager.setAuthority(guild.id, power);
    if (!updated) return;
    this.toRoster(guild, buildGuildAuthority(updated.power));
  }

  /**
   * Set one rank's daily salary -- `CDPCacheSrvr::OnGuildPenya` (`:1607`).
   * Master only; `0 <= penya < 1000000` or GUILD_ERROR 2.
   */
  setRankPenya(master: CPlayer, rank: number, penya: number): void {
    const guild = this.deps.guildManager.getByMember(master.m_idPlayer);
    if (!guild) return;
    if (guild.masterId !== master.m_idPlayer) return;
    if (rank < 0 || rank >= MAX_GM_LEVEL) return;
    if (penya < 0 || penya >= MAX_GUILD_RANK_PENYA) {
      this.deps.playerManager.sendTo(master, buildGuildError(GUILD_ERROR_BAD_PENYA));
      return;
    }
    if (!this.deps.guildManager.setRankPenya(guild.id, rank, penya)) return;
    this.toRoster(guild, buildGuildPenya(rank, penya));
  }

  /**
   * Guild chat -- `CDPCoreSrvr::OnGuildChat` (`DPCoreSrvr.cpp:1450`). There is
   * no C->S guild-chat opcode: the client sends `/g <msg>` as a normal CHAT
   * packet and the text-command router (`FuncTextCmd.cpp:1122`) dispatches it,
   * so the chat handler calls straight into here.
   *
   * ponytail: mute check.
   */
  chat(sender: CPlayer, msg: string): void {
    const guild = this.deps.guildManager.getByMember(sender.m_idPlayer);
    if (!guild) return;
    this.toRoster(guild, buildGuildChat(sender.m_idPlayer, sender.m_szName, msg));
  }

  // ── Session seams ──────────────────────────────────────────────────────────

  /**
   * JOIN seam -- `CGuildMng::AddConnection` (`guild.cpp:841`) plus the
   * `CUser::Open` snapshot trio (`User.cpp:330-332`).
   *
   * Order matters: ALL_GUILDS must go first, because it seeds the client's
   * `g_GuildMng` cache that every later guild id (ours and every peer's
   * ADD_OBJ) resolves against. Then the player's own full guild, then the
   * online-roster push, then a login notice to each mate.
   *
   * Returns false when the player is guildless -- which also clears a stale
   * `m_idGuild`, matching the C++ `pPlayer->m_idGuild = 0` fallback (`:848`).
   */
  onJoin(player: CPlayer): boolean {
    // ALL_GUILDS goes to EVERY player on join, guilded or not: a guildless
    // player still has to render peers' guild tags.
    this.deps.playerManager.sendTo(player, buildAllGuilds(
      this.deps.guildManager.idCounter,
      this.deps.guildManager.all().map((g) => this.snapshot(g)),
    ));

    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) { player.m_idGuild = NULL_ID; return false; }
    player.m_idGuild = guild.id;
    this.deps.playerManager.sendTo(player, buildGuild(this.snapshot(guild)));

    // Who else is online right now -> the joiner (GUILD_GAMEJOIN).
    const onlineIds: number[] = [];
    for (const m of guild.members) {
      if (this.deps.playerManager.get(m.characterId)) onlineIds.push(m.characterId);
    }
    if (onlineIds.length > 0) {
      this.deps.playerManager.sendTo(player, buildGuildGameJoin(
        onlineIds, onlineIds.map(() => GUILD_MULTI_NO_DEFAULT),
      ));
    }
    // "<name> came online" -> every other online mate (GUILD_GAMELOGIN 1).
    this.broadcastMemberLogin(guild, player.m_idPlayer, true);
    return true;
  }

  /**
   * Disconnect seam -- `CGuildMng::RemoveConnection` (`guild.cpp:882`). The
   * member is NEVER removed from the roster; the mates just get a logout
   * notice. C++ passes `uMultiNo = 100` on this one.
   */
  onDisconnect(player: CPlayer): void {
    this.deps.guildManager.onDisconnect(player.m_idPlayer);
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    this.broadcastMemberLogin(guild, player.m_idPlayer, false);
  }

  // ── Script predicates (NPC dialog bridge) ──────────────────────────────────

  /** `IsGuild` (`ScriptLib.cpp:782`) -- 1 when the player is in a guild. */
  isGuild(characterId: number): number {
    return this.deps.guildManager.getByMember(characterId) ? 1 : 0;
  }

  /** `IsGuildMaster` (`ScriptLib.cpp:790`). */
  isGuildMaster(characterId: number): number {
    const g = this.deps.guildManager.getByMember(characterId);
    return g && g.masterId === characterId ? 1 : 0;
  }

  /** Roster size, for the `guildSize` quest condition. 0 when guildless. */
  guildSize(characterId: number): number {
    return this.deps.guildManager.getByMember(characterId)?.members.length ?? 0;
  }

  /**
   * `IsPartyGuild` (`ScriptLib.cpp:737`) -- the guild-creation eligibility
   * probe, and it is INVERTED: **0 means eligible**. Returns 1 when there is no
   * party, a member is offline, or a member is already guilded; 2 when a member
   * is inside their 2-day rejoin cooldown.
   *
   * `partyMemberIds` is empty when the player has no party (the C++ `f = 1`
   * branch at `:753`).
   */
  isPartyGuild(partyMemberIds: readonly number[]): number {
    if (partyMemberIds.length === 0) return 1;
    for (const id of partyMemberIds) {
      const p = this.deps.playerManager.get(id);
      if (!p) return 1;                                        // offline
      if (this.deps.guildManager.getByMember(id)) return 1;    // already guilded
      if (this.deps.guildManager.onCooldown(id)) return 2;     // rejoin cooldown
    }
    return 0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * `pGuild->GetWar()` (`guild.cpp:678-682`) -- a REGISTRY lookup, not an
   * `m_idWar != 0` test. That distinction is load-bearing: a guild holding a
   * stale war id (the war ended while it was unloaded) must read as NOT at war
   * rather than blocking every roster mutation forever.
   *
   * Self-heals the stale id on read, which C++ never needs because CoreServer
   * holds both maps in one process and clears `m_idWar` in `Result`.
   */
  private isAtWar(guild: Guild): boolean {
    if (guild.idWar === 0) return false;
    const wars = this.deps.guildWarManager;
    if (!wars) return false;      // world composed without the war subsystem
    if (wars.get(guild.idWar)) return true;
    this.deps.guildManager.clearWar(guild.id);
    return false;
  }

  /** Fan a packet out to every ONLINE member of a guild. */
  private toRoster(guild: Guild, packet: Buffer): void {
    for (const m of guild.members) {
      const p = this.deps.playerManager.get(m.characterId);
      if (p) this.deps.playerManager.sendTo(p, packet);
    }
  }

  /** GUILD_GAMELOGIN to every online member except the subject themself. */
  private broadcastMemberLogin(guild: Guild, characterId: number, online: boolean): void {
    const packet = buildGuildGameLogin(
      online, characterId, online ? GUILD_MULTI_NO_DEFAULT : GUILD_MULTI_NO_DEFAULT,
    );
    for (const m of guild.members) {
      if (m.characterId === characterId) continue;
      const p = this.deps.playerManager.get(m.characterId);
      if (p) this.deps.playerManager.sendTo(p, packet);
    }
  }

  /**
   * SET_GUILD to the affected player's visibility range -- `CUserMng::AddSetGuild`
   * (`User.cpp:5291`), so peers re-render the guild tag without a full ADD_OBJ.
   * The affected player is `except`: their own client already knows (it just got
   * a full GUILD or a REMOVE_GUILD_MEMBER).
   */
  private broadcastSetGuild(player: CPlayer, idGuild: number): void {
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      buildSetGuild(player.m_idPlayer, idGuild), player,
    );
  }

  /** Global announcement -- CREATE/DESTROY/SETNAME/LOGO reach every client. */
  private broadcastAll(packet: Buffer): void {
    this.deps.playerManager.broadcastAll(packet);
  }

  /** Resolve a player from a mover objid (the invite path's addressing). */
  private resolveByObjid(objid: number): CPlayer | undefined {
    // Player objids ARE player ids in this emulator (see PlayerManager), so the
    // direct lookup is correct; kept as a named seam for when that stops holding.
    return this.deps.playerManager.get(objid);
  }

  /** Live {@link Guild} -> the wire shape `CGuild::Serialize` expects. */
  private snapshot(guild: Guild): GuildSnapshot {
    return {
      id: guild.id, masterId: guild.masterId, level: guild.level,
      name: guild.name, logo: guild.logo, gold: guild.gold,
      win: guild.win, lose: guild.lose, surrender: guild.surrender,
      power: guild.power, penya: guild.penya, notice: guild.notice,
      contributionPxp: guild.contributionPxp,
      enemyGuildId: guild.idEnemyGuild,
      members: guild.members.map(toMemberSnapshot),
    };
  }
}

/** Roster entry -> `CGuildMember::Serialize` shape. */
function toMemberSnapshot(m: GuildMemberState): GuildMemberSnapshot {
  return {
    id: m.characterId, pay: m.pay, giveGold: m.giveGold, givePxp: m.givePxp,
    win: m.win, lose: m.lose, memberLv: m.memberLv,
    selectedVoteId: m.selectedVoteId, surrender: m.surrender,
    cls: m.memberClass, alias: m.alias,
  };
}
