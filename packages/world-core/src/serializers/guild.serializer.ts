/**
 * Guild S->C snapshots + packets -- `SNAPSHOTTYPE_GUILD/ALL_GUILDS/SET_GUILD/
 * CREATE_GUILD/DESTROY_GUILD/GUILD_INVITE/GUILD_NOTICE/GUILD_AUTHORITY/
 * GUILD_PENYA/GUILD_LOGO/GUILD_CONTRIBUTION/GUILD_REAL_PENYA` and the
 * `PACKETTYPE_*` guild frames (`_Network/MsgHdr.h:315-332, 455-506, 1064-1180`).
 *
 * Real Flyff splits these across CoreServer (`CDPCacheSrvr::SendGuild*`,
 * `CORESERVER/DPCacheSrvr.cpp:1856-1967`) and world-server (`CUser::AddGuild*`
 * / `CUserMng::AddCreateGuild*`, `WORLDSERVER/User.cpp:1892-2033, 5268-5325`).
 * This emulator is single-process, so both families are built here.
 *
 * **Two different frame shapes live in this file** -- do not mix them up:
 *
 * 1. *Snapshot* records (`{@link snap}`): `PACKETTYPE_SNAPSHOT | NULL_ID |
 *    WORD 1 | DWORD objid | WORD subtype | body`. Used by everything the C++
 *    writes through `m_Snapshot.ar` or `CUserMng::Add*`.
 * 2. *Direct* packets (`{@link pkt}`): `DWORD PACKETTYPE_X | body`. Used by
 *    everything CoreServer sends via `BEFORESENDSOLE(ar, PACKETTYPE_X, ...)`
 *    -- GUILD, ADD/REMOVE_GUILD_MEMBER, GUILD_MEMBER_LEVEL, GUILD_CLASS,
 *    GUILD_NICKNAME, CHG_MASTER, GUILD_SETNAME, GUILD_CHAT, GUILD_GAMELOGIN,
 *    GUILD_GAMEJOIN, GUILD_ERROR.
 *
 * Width rules: every explicit `CAr` operator in `_Network/Misc/Include/ar.h`
 * is commented out, so the live path is the template at `ar.h:253` which writes
 * exactly `sizeof(T)` of the argument's STATIC type. `int`/`LONG`/`u_long`/
 * `DWORD`/`BOOL` -> 4 bytes, `short` -> 2, `BYTE` -> 1, **no widening**. The
 * traps here are `m_nMemberLv` (BYTE), `m_nWin`/`m_nLose` on a member (short),
 * `nGuildLevel` in CONTRIBUTION_CHANGED_INFO (WORD), and `m_nQuestSize` (BYTE).
 *
 * `ar.Write(ptr, size)` blobs (`m_adwPower`, `m_adwPenya`, `GUILD_MEMBER_INFO`,
 * `GUILDQUEST[]`) are RAW struct/array writes with **no count prefix** and
 * C struct padding -- see {@link writeGuildMemberInfo}.
 *
 * @module serializers/guild
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import type { InventorySlot } from '@flyff/entities';
import { NULL_ID } from '../snapshot-constants';
import { writeItemContainer } from './itemContainer';
import { writeCItemElemBody } from './itemElemBody.serializer';

/** `MAX_GM_LEVEL` (`guild.h:21`) -- number of ranks, and the width of the
 *  `m_adwPower` / `m_adwPenya` arrays. */
export const MAX_GM_LEVEL = 5;

/** Rank ids -- `resource/defineJob.h:215-219`. Lower is more senior. */
export const GUD_MASTER = 0;
export const GUD_KINGPIN = 1;
export const GUD_CAPTAIN = 2;
export const GUD_SUPPORTER = 3;
export const GUD_ROOKIE = 4;

/**
 * Per-rank headcount caps -- `CGuild::sm_anMaxMemberLvSize` (`guild.cpp:328`)
 * = `{ GM_MASTER, GM_KINGPIN, GM_CAPTAIN, GM_SUPPORTER, GM_ROOKIE }`
 * (`guild.h:32-36`). Index by rank. `GUD_ROOKIE`'s entry is never consulted:
 * `GetMaxMemberLvSize` returns the whole-guild cap for it (`guild.cpp:499`).
 */
export const MAX_MEMBER_LV_SIZE: readonly number[] = [1, 5, 10, 20, 80];

/** `m_adwPower` bits -- `guild.h:38-42`. */
export const PF_MEMBERLEVEL = 0x01;
export const PF_LEVEL = 0x02;
export const PF_INVITATION = 0x04;
export const PF_PENYA = 0x08;
export const PF_ITEM = 0x10;

/**
 * The master's authority mask. C++ hardcodes `m_adwPower[GUD_MASTER] =
 * 0x000000FF` both on create (`DPCoreSrvr.cpp:1385`) and on every DB load
 * (`DbManager.cpp:2837`) -- it is never stored and never editable, so the
 * authority window cannot lock a master out of their own guild.
 */
export const GUILD_MASTER_POWER = 0xff;

/** `MAX_G_NAME` (`guild.h:24`) -- in-memory guild-name buffer. */
export const MAX_G_NAME = 48;
/** `MAX_BYTE_NOTICE` (`guild.h:26`). */
export const MAX_BYTE_NOTICE = 128;
/** `MAX_GM_ALIAS` (`guild.h:20`) -- member nickname buffer. */
export const MAX_GM_ALIAS = 48;
/** `MAX_GUILD_LEVEL` (`guild.h:27`). */
export const MAX_GUILD_LEVEL = 50;
/** `CUSTOM_LOGO_MAX` (`resource/define.h:162`). */
export const CUSTOM_LOGO_MAX = 27;
/**
 * Logo ids above this need `AUTH_GAMEMASTER` (`DPSrvr.cpp:1830`). The check is
 * `dwLogo > 20`, separate from the `> CUSTOM_LOGO_MAX` hard reject.
 */
export const GUILD_LOGO_GM_ONLY_ABOVE = 20;

/** `GUILD_ERROR` codes (`SendGuildError`, DPCacheSrvr.cpp:1962). */
export const GUILD_ERROR_DUPLICATE_NAME = 1;
export const GUILD_ERROR_BAD_PENYA = 2;

/** Rank salary ceiling -- `0 <= dwPenya < 1000000` (`OnGuildPenya`, :1617). */
export const MAX_GUILD_RANK_PENYA = 1_000_000;

/** One roster entry, in `CGuildMember::Serialize` order (`guild.cpp:266`). */
export interface GuildMemberSnapshot {
  /** `m_idPlayer`. */
  id: number;
  /** `m_nPay` -- salary received. */
  pay: number;
  /** `m_nGiveGold` -- penya contributed. */
  giveGold: number;
  /** `m_dwGivePxpCount` -- PXP contributed. */
  givePxp: number;
  /** `m_nWin` -- **short**, 2 bytes. */
  win: number;
  /** `m_nLose` -- **short**, 2 bytes. */
  lose: number;
  /** `m_nMemberLv` -- **BYTE**, 1 byte. GUD_MASTER..GUD_ROOKIE. */
  memberLv: number;
  /** `m_idSelectedVote`. */
  selectedVoteId: number;
  /** `m_nSurrender`. */
  surrender: number;
  /** `m_nClass` -- sub-grade A/B/C, 0..2. */
  cls: number;
  /** `m_szAlias` -- nickname; empty string when unset. */
  alias: string;
}

/** `GUILDQUEST` (`guildquest.h:39`) -- 12 bytes, raw-written as an array. */
export interface GuildQuestEntry {
  /** `nId` -- -1 marks a removed slot (C++ never shrinks the array). */
  nId: number;
  /** `nState`. */
  nState: number;
  /** `idGuild`. */
  idGuild: number;
}

/** `CGuild::Serialize` state. */
export interface GuildSnapshot {
  /** `m_idGuild`. */
  id: number;
  /** `m_idMaster`. */
  masterId: number;
  /** `m_nLevel` -- 1..50. Written TWICE in the full form; see {@link writeCGuild}. */
  level: number;
  /** `m_szGuild`. */
  name: string;
  /** `m_dwLogo` -- 0 = unset. Write-once. */
  logo: number;
  /** `m_nGoldGuild` -- guild bank penya pool. */
  gold: number;
  /** `m_nWin` / `m_nLose` / `m_nSurrender` -- guild war record (**int**, 4 B). */
  win: number;
  lose: number;
  surrender: number;
  /** `m_adwPower[5]` -- PF_* mask per rank. Raw 20-byte blob. */
  power: readonly number[];
  /** `m_adwPenya[5]` -- daily salary per rank. Raw 20-byte blob. */
  penya: readonly number[];
  /** `m_szNotice`. */
  notice: string;
  /** `m_dwContributionPxp`. */
  contributionPxp: number;
  /** `m_idEnemyGuild` -- 0 when not at war. */
  enemyGuildId: number;
  members: GuildMemberSnapshot[];
  /** `m_votes` -- serialized inline. Empty until guild votes ship. */
  votes?: GuildVoteSnapshot[];
  /** `m_aQuest[m_nQuestSize]` -- the guild's quest ledger. */
  quests?: GuildQuestEntry[];
}

/** `CGuildVote::Serialize` (`guild.cpp:114`). Exactly 4 selections, always. */
export interface GuildVoteSnapshot {
  /** `m_idVote`. */
  id: number;
  /** `m_bCompleted` -- **BYTE** on the wire. */
  completed: boolean;
  /** `m_szTitle`. */
  title: string;
  /** `m_szQuestion`. */
  question: string;
  /** `m_selects[4]` -- `{ szString, cbCount }`; `cbCount` is a **BYTE**. */
  selects: { text: string; count: number }[];
}

/** Snapshot record frame: `SNAPSHOT | NULL_ID | 1 | objid | subtype`. */
function snap(subtype: number, objid: number): PacketWriter {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(subtype);
  return w;
}

/** Direct packet frame: `DWORD PACKETTYPE_X`, body written by the caller. */
function pkt(packetType: number): PacketWriter {
  const w = new PacketWriter();
  w.writeDword(packetType);
  return w;
}

/**
 * `GUILD_MEMBER_INFO` (`guild.h:243-260`) written the way C++ does it:
 * `ar.Write(&info, sizeof(GUILD_MEMBER_INFO))`. Under v19 (`__VER >= 11 //
 * __SYS_PLAYER_DATA`) the struct is `{ u_long idPlayer; BYTE nMultiNo; }`,
 * which MSVC pads to a 4-byte boundary -- so it is **8 bytes on the wire**,
 * not 5: 4 for the id, 1 for nMultiNo, 3 of tail padding.
 *
 * Getting this wrong shifts every field after it. It appears in the C->S
 * ADD_GUILD_MEMBER body and in the S->C ADD_GUILD_MEMBER reply.
 *
 * `nMultiNo` is the CoreServer "multi-server number" and defaults to 100 in the
 * C++ constructor. Single-world here, so callers pass the default.
 */
export const GUILD_MEMBER_INFO_SIZE = 8;
/** Default `nMultiNo` -- the C++ `_GUILD_MEMBER_INFO()` ctor value. */
export const GUILD_MULTI_NO_DEFAULT = 100;

export function writeGuildMemberInfo(w: PacketWriter, idPlayer: number, multiNo = GUILD_MULTI_NO_DEFAULT): void {
  w.writeDword(idPlayer);
  w.writeByte(multiNo & 0xff);
  w.writeByte(0); // struct tail padding
  w.writeByte(0);
  w.writeByte(0);
}

/** `CGuildMember::Serialize` (`guild.cpp:266`), v19 field set. */
function writeCGuildMember(w: PacketWriter, m: GuildMemberSnapshot): void {
  w.writeDword(m.id);
  w.writeDword(m.pay);
  w.writeDword(m.giveGold);
  w.writeDword(m.givePxp);
  w.writeWord(m.win & 0xffff);   // short
  w.writeWord(m.lose & 0xffff);  // short
  w.writeByte(m.memberLv & 0xff); // BYTE -- no widening
  w.writeDword(m.selectedVoteId);
  w.writeDword(m.surrender);
  w.writeDword(m.cls);
  w.writeString(m.alias);
}

/** `CGuildVote::Serialize` (`guild.cpp:114`). */
function writeCGuildVote(w: PacketWriter, v: GuildVoteSnapshot): void {
  w.writeDword(v.id);
  w.writeByte(v.completed ? 1 : 0);
  w.writeString(v.title);
  w.writeString(v.question);
  for (let i = 0; i < 4; i++) {
    const s = v.selects[i];
    w.writeString(s?.text ?? '');
    w.writeByte((s?.count ?? 0) & 0xff);
  }
}

/**
 * `CGuild::Serialize(ar, bDesc)` (`guild.cpp:409`).
 *
 * `bDesc = TRUE` is the DESCRIPTOR form used by ALL_GUILDS: header fields only,
 * no roster. `bDesc = FALSE` is the full form used by GUILD (my own guild).
 *
 * Note `m_nLevel` is written **twice** in the full form -- once in the header
 * (`:413`) and again after the notice (`:424`). The client reads it twice
 * (`:445`, `:456`). It is not a typo to fix: dropping the second write shifts
 * `m_idEnemyGuild` and the whole roster.
 */
export function writeCGuild(w: PacketWriter, g: GuildSnapshot, desc: boolean): void {
  w.writeDword(g.id);
  w.writeDword(g.masterId);
  w.writeDword(g.level);
  w.writeString(g.name);
  w.writeDword(g.logo);
  w.writeDword(g.gold);
  w.writeDword(g.win);
  w.writeDword(g.lose);
  w.writeDword(g.surrender);
  if (desc) return;
  // ar.Write(m_adwPower, sizeof(...)) -- raw 20-byte blob, no count prefix.
  for (let i = 0; i < MAX_GM_LEVEL; i++) w.writeDword(g.power[i] ?? 0);
  for (let i = 0; i < MAX_GM_LEVEL; i++) w.writeDword(g.penya[i] ?? 0);
  w.writeString(g.notice);
  w.writeDword(g.contributionPxp);
  w.writeDword(g.level); // second m_nLevel -- intentional (guild.cpp:424)
  w.writeDword(g.enemyGuildId);
  w.writeWord(g.members.length & 0xffff); // (short)GetSize()
  for (const m of g.members) writeCGuildMember(w, m);
  const votes = g.votes ?? [];
  w.writeWord(votes.length & 0xffff);     // (short)m_votes.size()
  for (const v of votes) writeCGuildVote(w, v);
  const quests = g.quests ?? [];
  w.writeByte(quests.length & 0xff);      // m_nQuestSize -- BYTE
  for (const q of quests) {               // raw GUILDQUEST[] -- 12 B each
    w.writeDword(q.nId);
    w.writeDword(q.nState);
    w.writeDword(q.idGuild);
  }
}

// ── Snapshot records ────────────────────────────────────────────────────────

/**
 * `SNAPSHOTTYPE_GUILD` (0x009e) -- `CUser::AddMyGuild` (User.cpp:1915).
 * Body: `DWORD idGuild | CGuild::Serialize(FALSE)`. Note `idGuild` is written
 * BEFORE the serialize, which itself starts with `m_idGuild` again -- so the
 * guild id genuinely appears twice. Sent on JOIN and after every roster change.
 */
export function buildGuild(guild: GuildSnapshot): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD, NULL_ID);
  w.writeDword(guild.id);
  writeCGuild(w, guild, false);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_ALL_GUILDS` (0x009f) -- `CUser::AddAllGuilds` (User.cpp:1904)
 * -> `CGuildMng::Serialize(ar, TRUE)` (guild.cpp:802):
 * `DWORD m_id (the id counter) | int count | count x CGuild::Serialize(TRUE)`.
 *
 * This is EVERY guild on the shard in descriptor form, and it must reach the
 * client before any ADD_OBJ carrying a nonzero `m_idGuild`: nothing on the
 * mover wire carries a guild NAME, so the client resolves it out of the
 * `g_GuildMng` cache this packet seeds. Without it, guilded players render
 * with a blank guild tag.
 *
 * The `__GUILDRANK` block that follows in C++ is compiled out in v19 (the
 * symbol is undefined in every `VersionCommon.h`), so nothing trails the list.
 */
export function buildAllGuilds(idCounter: number, guilds: GuildSnapshot[]): Buffer {
  const w = snap(SNAPSHOTTYPE.ALL_GUILDS, NULL_ID);
  w.writeDword(idCounter);
  w.writeDword(guilds.length);
  for (const g of guilds) writeCGuild(w, g, true);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_SET_GUILD` (0x009b) -- `CUserMng::AddSetGuild` (User.cpp:5291).
 * Body: `DWORD idGuild`, and the record's `objid` is the AFFECTED mover, not
 * the recipient. Broadcast to the affected player's visibility range so peers
 * re-render their guild tag without a full ADD_OBJ.
 */
export function buildSetGuild(affectedObjid: number, idGuild: number): Buffer {
  const w = snap(SNAPSHOTTYPE.SET_GUILD, affectedObjid);
  w.writeDword(idGuild);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_CREATE_GUILD` (0x009c) -- `CUserMng::AddCreateGuild`
 * (User.cpp:5268). Body: `DWORD idPlayer | DWORD idGuild | String playerName |
 * String guildName`. Broadcast to **all** connected players (the client caches
 * the new guild in `g_GuildMng` and the player name in `CPlayerDataCenter`).
 */
export function buildCreateGuild(
  idPlayer: number, idGuild: number, playerName: string, guildName: string,
): Buffer {
  const w = snap(SNAPSHOTTYPE.CREATE_GUILD, NULL_ID);
  w.writeDword(idPlayer);
  w.writeDword(idGuild);
  w.writeString(playerName);
  w.writeString(guildName);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_DESTROY_GUILD` (0x009d) -- `CUserMng::AddDestroyGuild`
 * (User.cpp:5280). Body: `String masterName | DWORD idGuild`.
 *
 * Note the order is REVERSED relative to CREATE_GUILD: the name comes first
 * here, the id second. Broadcast to all.
 */
export function buildDestroyGuild(masterName: string, idGuild: number): Buffer {
  const w = snap(SNAPSHOTTYPE.DESTROY_GUILD, NULL_ID);
  w.writeString(masterName);
  w.writeDword(idGuild);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_INVITE` (0x009a) -- `CUser::AddGuildInvite`
 * (User.cpp:1892). Body: `DWORD idGuild | DWORD idMaster`. Opens the invite
 * confirm dialog on the target.
 */
export function buildGuildInvite(idGuild: number, idMaster: number): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_INVITE, NULL_ID);
  w.writeDword(idGuild);
  w.writeDword(idMaster);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_NOTICE` (0x00fd) -- `CUser::AddSetNotice`
 * (User.cpp:1985). Body: `DWORD idGuild | String szNotice`.
 */
export function buildGuildNotice(idGuild: number, notice: string): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_NOTICE, NULL_ID);
  w.writeDword(idGuild);
  w.writeString(notice);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_AUTHORITY` (0x00fe) -- `CUser::AddSetGuildAuthority`
 * (User.cpp:1998). Body: RAW `DWORD[5]`, 20 bytes, **no count prefix**.
 */
export function buildGuildAuthority(power: readonly number[]): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_AUTHORITY, NULL_ID);
  for (let i = 0; i < MAX_GM_LEVEL; i++) w.writeDword(power[i] ?? 0);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_PENYA` (0x00ff) -- `CUser::AddSetGuildPenya`
 * (User.cpp:2010). Body: `DWORD dwType (rank) | DWORD dwPenya`.
 */
export function buildGuildPenya(rank: number, penya: number): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_PENYA, NULL_ID);
  w.writeDword(rank);
  w.writeDword(penya);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_LOGO` (0x00fb) -- `CUserMng::AddSetLogo`
 * (User.cpp:5316). Body: `DWORD idGuild | DWORD dwLogo`. Broadcast to all.
 */
export function buildGuildLogo(idGuild: number, logo: number): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_LOGO, NULL_ID);
  w.writeDword(idGuild);
  w.writeDword(logo);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_CONTRIBUTION` (0x00fc) -- `CUser::AddContribution`
 * (User.cpp:1947) -> `operator<<(CONTRIBUTION_CHANGED_INFO)` (guild.cpp:56).
 * Body: `DWORD idGuild | DWORD idPlayer | DWORD dwPxpCount | DWORD dwPenya |
 * DWORD dwGuildPxpCount | DWORD dwGuildPenya | WORD nGuildLevel`.
 *
 * `nGuildLevel` is a **WORD** (2 bytes) -- the struct field is `WORD`, and the
 * live `CAr` template writes `sizeof(T)`. Widening it to a DWORD trails 2 junk
 * bytes into the next record.
 */
export function buildGuildContribution(
  idGuild: number, idPlayer: number,
  pxpCount: number, penya: number,
  guildPxpCount: number, guildPenya: number, guildLevel: number,
): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_CONTRIBUTION, NULL_ID);
  w.writeDword(idGuild);
  w.writeDword(idPlayer);
  w.writeDword(pxpCount);
  w.writeDword(penya);
  w.writeDword(guildPxpCount);
  w.writeDword(guildPenya);
  w.writeWord(guildLevel & 0xffff); // WORD -- no widening
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GUILD_REAL_PENYA` (0x00d5) -- `CUser::AddGuildRealPenya`
 * (User.cpp:2022). Body: `int nGoldGuild | int nType`.
 *
 * `nType` is the RECIPIENT's own rank (`pMember->m_nMemberLv`,
 * DPCoreClient.cpp:2484), so this is built per-member, not once per guild.
 * Sent after the 21:00 salary payout.
 */
export function buildGuildRealPenya(goldGuild: number, rank: number): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_REAL_PENYA, NULL_ID);
  w.writeDword(goldGuild);
  w.writeDword(rank);
  return w.build();
}

// ── Direct packets (CoreServer `BEFORESENDSOLE` family) ─────────────────────

/**
 * `PACKETTYPE_ADD_GUILD_MEMBER` (0xffffff33) -- `SendAddGuildMember`
 * (DPCacheSrvr.cpp:1866). Body: RAW `GUILD_MEMBER_INFO` (8 B) |
 * `DWORD idGuild` | `String playerName`.
 *
 * Sent to every EXISTING member when someone joins. The joiner themself gets a
 * full {@link buildGuild} instead (the C++ branches on `pPlayertmp == pPlayer`
 * at DPCacheSrvr.cpp:1341).
 */
export function buildAddGuildMember(idPlayer: number, idGuild: number, playerName: string): Buffer {
  const w = pkt(PACKETTYPE.ADD_GUILD_MEMBER);
  writeGuildMemberInfo(w, idPlayer);
  w.writeDword(idGuild);
  w.writeString(playerName);
  return w.build();
}

/**
 * `PACKETTYPE_REMOVE_GUILD_MEMBER` (0xffffff34) -- `SendRemoveGuildMember`
 * (DPCacheSrvr.cpp:1879). Body: `DWORD idPlayer | DWORD idGuild`.
 * Sent to every remaining member AND to the removed player themself.
 */
export function buildRemoveGuildMember(idPlayer: number, idGuild: number): Buffer {
  const w = pkt(PACKETTYPE.REMOVE_GUILD_MEMBER);
  w.writeDword(idPlayer);
  w.writeDword(idGuild);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_MEMBER_LEVEL` (0xffffff3a) -- `SendGuildMemberLv`
 * (DPCacheSrvr.cpp:1889). Body: `DWORD idPlayer | int nMemberLv`.
 * `nMemberLv` is an **int** here (4 bytes), unlike the BYTE inside
 * `CGuildMember::Serialize`.
 */
export function buildGuildMemberLevel(idPlayer: number, memberLv: number): Buffer {
  const w = pkt(PACKETTYPE.GUILD_MEMBER_LEVEL);
  w.writeDword(idPlayer);
  w.writeDword(memberLv);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_CLASS` (0xffffff74) -- `SendGuildClass`
 * (DPCacheSrvr.cpp:1897). Body: `DWORD idPlayer | int nClass`.
 */
export function buildGuildClass(idPlayer: number, cls: number): Buffer {
  const w = pkt(PACKETTYPE.GUILD_CLASS);
  w.writeDword(idPlayer);
  w.writeDword(cls);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_NICKNAME` (0xffffff75) -- `SendGuildNickName`
 * (DPCacheSrvr.cpp:1904). Body: `DWORD idPlayer | String alias`.
 */
export function buildGuildNickname(idPlayer: number, alias: string): Buffer {
  const w = pkt(PACKETTYPE.GUILD_NICKNAME);
  w.writeDword(idPlayer);
  w.writeString(alias);
  return w.build();
}

/**
 * `PACKETTYPE_CHG_MASTER` (0xf000f000) -- `SendChgMaster`
 * (DPCacheSrvr.cpp:1912). Body: `DWORD idOldMaster | DWORD idNewMaster`.
 */
export function buildChgMaster(idOldMaster: number, idNewMaster: number): Buffer {
  const w = pkt(PACKETTYPE.CHG_MASTER);
  w.writeDword(idOldMaster);
  w.writeDword(idNewMaster);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_SETNAME` (0xf000b032) -- `SendGuildSetName`
 * (DPCacheSrvr.cpp:1919). Body: `DWORD idGuild | String szName`.
 * Broadcast to ALL players (`DPID_ALLPLAYERS`), not just the guild, because
 * every client caches guild names in `g_GuildMng`.
 */
export function buildGuildSetName(idGuild: number, name: string): Buffer {
  const w = pkt(PACKETTYPE.GUILD_SETNAME);
  w.writeDword(idGuild);
  w.writeString(name);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_CHAT` (0xffffff39) -- `SendGuildChat`
 * (DPCacheSrvr.cpp:1937). Body: `DWORD objid | String playerName |
 * String chat`. `objid` is the SPEAKER's mover objid.
 */
export function buildGuildChat(objid: number, playerName: string, chat: string): Buffer {
  const w = pkt(PACKETTYPE.GUILD_CHAT);
  w.writeDword(objid);
  w.writeString(playerName);
  w.writeString(chat);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_GAMELOGIN` (0xf000b029) -- `SendGuildMemberLogin`
 * (DPCacheSrvr.cpp:1946). Body: `BYTE nLogin | DWORD idPlayer | DWORD uMultiNo`.
 *
 * `nLogin` is a **BYTE**: 1 = came online, 0 = went offline. C++ passes
 * `uMultiNo = 100` (the "unknown" default) on the logout notice.
 */
export function buildGuildGameLogin(login: boolean, idPlayer: number, multiNo: number): Buffer {
  const w = pkt(PACKETTYPE.GUILD_GAMELOGIN);
  w.writeByte(login ? 1 : 0);
  w.writeDword(idPlayer);
  w.writeDword(multiNo);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_GAMEJOIN` (0xf000b030) -- `SendGuildMemberGameJoin`
 * (DPCacheSrvr.cpp:1953). Body: `int nMaxLogin | RAW DWORD ids[n] |
 * RAW DWORD multiNos[n]`. Both arrays are `ar.Write` blobs with no per-array
 * count -- the single leading `nMaxLogin` sizes both.
 *
 * Pushed to a member as they log in, listing which guildmates are already on.
 */
export function buildGuildGameJoin(ids: readonly number[], multiNos: readonly number[]): Buffer {
  const w = pkt(PACKETTYPE.GUILD_GAMEJOIN);
  w.writeDword(ids.length);
  for (const id of ids) w.writeDword(id);
  for (let i = 0; i < ids.length; i++) w.writeDword(multiNos[i] ?? GUILD_MULTI_NO_DEFAULT);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_ERROR` (0xf000b035) -- `SendGuildError`
 * (DPCacheSrvr.cpp:1962). Body: `int nError`. See
 * {@link GUILD_ERROR_DUPLICATE_NAME} / {@link GUILD_ERROR_BAD_PENYA}.
 */
export function buildGuildError(error: number): Buffer {
  const w = pkt(PACKETTYPE.GUILD_ERROR);
  w.writeDword(error);
  return w.build();
}

/**
 * `PACKETTYPE_GUILD_DB_REALPENYA` (0xf000b028) -- `SendGuildGetPay`
 * (DPCoreClient.cpp:2705). Body: `DWORD idGuild | DWORD nGoldGuild`.
 *
 * Server-internal in C++ (world <-> core). Kept because the single-process
 * collapse still needs the guild-gold sync shape; the per-player UI update is
 * {@link buildGuildRealPenya}.
 */
export function buildGuildDbRealPenya(idGuild: number, goldGuild: number): Buffer {
  const w = pkt(PACKETTYPE.GUILD_DB_REALPENYA);
  w.writeDword(idGuild);
  w.writeDword(goldGuild);
  return w.build();
}

// ── Guild bank (42 slots) ───────────────────────────────────────────────────

/** `MAX_GUILDBANK` (`guild.h:30`) -- guild-bank slot count. */
export const MAX_GUILDBANK = 42;

/**
 * `CNpcChecker::IsCloseNpc` gate, squared (`npchecker.h:4`
 * `MAX_LEN_MOVER_MENU = 1024`). Same constant the personal bank uses.
 */
export const MAX_LEN_MOVER_MENU_SQ = 1024;

/**
 * Deposit-echo recipient discriminator -- the leading BYTE of
 * SNAPSHOTTYPE_PUTITEMGUILDBANK / GETITEMGUILDBANK. C++ multiplexes several
 * different bodies onto one subtype and the client switches on this byte, so it
 * is NOT decorative.
 *
 * `SELF` (1) `AddPutItemGuildBank`/`AddGetItemGuildBank` -- the actor's own echo.
 * `PEER` (3) `CUserMng::AddPutItemElem`/`AddGetItemElem` -- other guild members
 * who ALSO have the bank window open (`USERPTR->m_bGuildBank == TRUE`), so their
 * open grid refreshes live.
 * `PENYA_SELF` (0) / `PENYA_PEER` (2) -- `AddGetGoldGuildBank`, the penya
 * withdrawal, which carries a completely different body from the item form.
 */
export const GUILD_BANK_ECHO_PENYA_SELF = 0;
export const GUILD_BANK_ECHO_SELF = 1;
export const GUILD_BANK_ECHO_PENYA_PEER = 2;
export const GUILD_BANK_ECHO_PEER = 3;

/**
 * `SNAPSHOTTYPE_GUILD_BANK_WND` (0x00fa) -- `CUser::AddGuildBankWindow`
 * (`User.cpp:1036`). Body: `int nMode | DWORD m_nGoldGuild |
 * CItemContainer::Serialize(42)`.
 *
 * `objid` is SELF here (`m_Snapshot.ar << GetId()`), not NULL_ID -- this is a
 * per-user window, unlike the guild-wide records above.
 *
 * `nMode` is 0 on open (`AddGuildBankWindow( 0 )`, `DPSrvr.cpp:3290`). The penya
 * figure is `CGuild::m_nGoldGuild` -- the SAME field the level-up consumes, which
 * is why the bank balance moves when a guild levels.
 */
export function buildGuildBankWindow(
  selfObjid: number, mode: number, gold: number,
  contents: readonly (InventorySlot | null)[],
): Buffer {
  const w = snap(SNAPSHOTTYPE.GUILD_BANK_WND, selfObjid);
  w.writeDword(mode);
  w.writeDword(gold);
  writeItemContainer(w, MAX_GUILDBANK, contents);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_PUTITEMGUILDBANK` (0x00ef) -- deposit echo.
 * Body: `BYTE recipient | CItemElem::Serialize`.
 *
 * Pass {@link GUILD_BANK_ECHO_SELF} for the depositor (`User.cpp:932`) or
 * {@link GUILD_BANK_ECHO_PEER} for guild members with the window open (`:5341`).
 *
 * `objId` is the item's stable `m_dwObjId` -- the handle the client addresses the
 * bank slot by, NOT the slot index (same rule as UPDATE_ITEM).
 */
export function buildPutItemGuildBank(
  selfObjid: number, recipient: number, objId: number, item: InventorySlot,
): Buffer {
  const w = snap(SNAPSHOTTYPE.PUTITEMGUILDBANK, selfObjid);
  w.writeByte(recipient & 0xff);
  writeCItemElemBody(w, objId, item);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GETITEMGUILDBANK` (0x00d4), ITEM form --
 * `CUser::AddGetItemGuildBank` (`User.cpp:942`).
 * Body: `BYTE recipient (1 self / 3 peer) | CItemElem::Serialize`.
 */
export function buildGetItemGuildBank(
  selfObjid: number, recipient: number, objId: number, item: InventorySlot,
): Buffer {
  const w = snap(SNAPSHOTTYPE.GETITEMGUILDBANK, selfObjid);
  w.writeByte(recipient & 0xff);
  writeCItemElemBody(w, objId, item);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_GETITEMGUILDBANK` (0x00d4), PENYA form --
 * `CUser::AddGetGoldGuildBank` (`User.cpp:952`). Body:
 * `BYTE mode (0 self / 2 peer) | DWORD gold | DWORD playerId | BYTE cbCloak`.
 *
 * Same subtype as the item form, different body -- the client discriminates on
 * the leading byte alone, so sending mode 1/3 with this body (or 0/2 with the
 * item body) desyncs the read. `playerId` is the WITHDRAWER, so peers can name
 * who took it. `cbCloak` is the guild-cloak flag, 0 for a plain withdrawal.
 */
export function buildGetGoldGuildBank(
  selfObjid: number, mode: number, gold: number, playerId: number, cloak = 0,
): Buffer {
  const w = snap(SNAPSHOTTYPE.GETITEMGUILDBANK, selfObjid);
  w.writeByte(mode & 0xff);
  w.writeDword(gold);
  w.writeDword(playerId);
  w.writeByte(cloak & 0xff);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_REMOVE_GUILD_BANK_ITEM` (0x00f3) -- a bank slot emptied.
 * Body: `DWORD idGuild | DWORD dwId | DWORD dwItemNum`.
 */
export function buildRemoveGuildBankItem(
  selfObjid: number, idGuild: number, objId: number, itemNum: number,
): Buffer {
  const w = snap(SNAPSHOTTYPE.REMOVE_GUILD_BANK_ITEM, selfObjid);
  w.writeDword(idGuild);
  w.writeDword(objId);
  w.writeDword(itemNum);
  return w.build();
}

// ── Guild war ───────────────────────────────────────────────────────────────

/**
 * `WF_*` -- `CGuildWar::m_nFlag` (`guildwar.h:16-23`). These are ASCII CHARACTER
 * literals in C++ (`'0'`..`'9'`), not small integers, and the field is a `char`
 * written as ONE byte. `WF_WARTIME` is `'0'` = 48, so a naive `0` here is wrong.
 * Note `'7'` and `'8'` are unused.
 */
export const WF_WARTIME = 0x30; // '0' -- live war
export const WF_W_GN = 0x31;    // '1' -- won by killing the enemy master
export const WF_W_SR = 0x32;    // '2' -- won by surrender
export const WF_L_GN = 0x33;    // '3' -- lost, master killed
export const WF_L_SR = 0x34;    // '4' -- lost by surrender
export const WF_TRUCE = 0x35;   // '5'
export const WF_DRAW = 0x36;    // '6'
export const WF_END = 0x39;     // '9' -- timed out, awaiting resolution

/**
 * War result types -- the anonymous enum at `guildwar.h:25-29`, ordinals 0..9.
 * `GN` = won by killing the enemy master, `SR` = won by surrender, `AB` = won on
 * master-absent count at timeout, `DD` = won on death count at timeout.
 *
 * The ordering is load-bearing twice over: `CGuildWarMng::Result` branches
 * `if( nType < WR_TRUCE )` to decide whether to touch the win/lose record at all
 * (`guildwar.cpp:195`), so TRUCE and DRAW update NOTHING; and `OnWarDead` passes
 * `(int)bDecl` directly as the type (`DPCoreSrvr.cpp:1647`), which only works
 * because `WR_DECL_GN` is 0 and `WR_ACPT_GN` is 1.
 */
export const WR_DECL_GN = 0;
export const WR_ACPT_GN = 1;
export const WR_DECL_SR = 2;
export const WR_ACPT_SR = 3;
export const WR_DECL_AB = 4;
export const WR_ACPT_AB = 5;
export const WR_DECL_DD = 6;
export const WR_ACPT_DD = 7;
export const WR_TRUCE = 8;
export const WR_DRAW = 9;

/** War duration -- `CGuildWar::GetEndTime` (`guildwar.h:64`). The
 *  `__INTERNALSERVER` 10-minute arm is dead in this tree (`__MAINSERVER` is
 *  hardcoded), so the retail 2 hours is the live value. */
export const GUILD_WAR_DURATION_MS = 2 * 60 * 60 * 1000;

/** Declare-war gates -- all three are `#ifndef __INTERNALSERVER`, hence LIVE
 *  (`DPCacheSrvr.cpp:2451`, `:2471`, `:2484`). */
export const GUILD_WAR_MIN_LEVEL = 6;
export const GUILD_WAR_MIN_TARGET_MEMBERS = 10;

/** Surrender ratio that ends a war -- `( nSurrender * 100 ) / nSize > 70`
 *  (`DPCacheSrvr.cpp:2312`). Strictly greater, and integer division. */
export const GUILD_WAR_SURRENDER_PERCENT = 70;

/**
 * One side of a war -- `WAR_ENTRY` (`guildwar.h:6-14`).
 *
 * All five members are 4 bytes and 4-aligned, so the struct is exactly 20 bytes
 * with **no padding** -- which matters because `CGuildWar::Serialize` writes it
 * as a RAW blob via `ar.Write( &m_Decl, sizeof(m_Decl) )`, not field-by-field.
 */
export interface WarEntry {
  /** `idGuild`. */
  guildId: number;
  /** `nSize` -- roster headcount SNAPSHOT taken at accept. Only ever read as the
   *  denominator of the 70% surrender ratio; it is never refreshed, so a war does
   *  NOT end because a guild shrank. */
  size: number;
  /** `nSurrender` -- cumulative surrenders from this side. */
  surrender: number;
  /** `nDead` -- non-master deaths; the timeout tiebreak. */
  dead: number;
  /** `nAbsent` -- TICK count where this side's master was offline, not seconds.
   *  Bumped once per `CGuildWarMng::Process` pass (`DPCoreSrvr.cpp:1690`), so its
   *  scale follows the tick period. */
  absent: number;
}

/** `CGuildWar` state -- the wire shape of {@link writeCGuildWar}. */
export interface GuildWarSnapshot {
  /** `m_idWar`. */
  id: number;
  /** `m_Decl` -- the declaring side. */
  decl: WarEntry;
  /** `m_Acpt` -- the accepting side. */
  acpt: WarEntry;
  /** `m_nFlag` -- one of the `WF_*` byte constants. */
  flag: number;
  /** `m_time` -- war START (not end), epoch SECONDS. */
  startedAtSec: number;
}

/** `WAR_ENTRY` as a raw 20-byte blob -- five LE DWORDs, no count prefix. */
function writeWarEntry(w: PacketWriter, e: WarEntry): void {
  w.writeDword(e.guildId);
  w.writeDword(e.size);
  w.writeDword(e.surrender);
  w.writeDword(e.dead);
  w.writeDword(e.absent);
}

/**
 * `CGuildWar::Serialize` (`guildwar.cpp:41-61`) -- 49 bytes flat:
 * `4 + 20 + 20 + 1 + 4`.
 *
 * `m_nFlag` is a `char`, so ONE byte (the `sizeof(T)` template at `ar.h:253`
 * never widens). The trailing time is `(time_t)m_time.GetTime()` and every
 * server `StdAfx.h` defines `_USE_32BIT_TIME_T`, so it is 4 bytes, not 8.
 *
 * The odd total is worth noticing rather than "correcting": because CAr never
 * pads, that single flag byte pushes the trailing DWORD onto an UNALIGNED
 * offset (45). `ar.h:253` casts through `UNALIGNED` precisely so this works.
 */
export function writeCGuildWar(w: PacketWriter, war: GuildWarSnapshot): void {
  w.writeDword(war.id);
  writeWarEntry(w, war.decl);
  writeWarEntry(w, war.acpt);
  w.writeByte(war.flag & 0xff);
  w.writeDword(war.startedAtSec >>> 0);
}

/**
 * `SNAPSHOTTYPE_SET_WAR` (0x007a) -- `CUserMng::AddSetWar`
 * (`User.cpp:5303-5313`). Body: `DWORD idWar`; `0` means the war ended.
 *
 * `objid` is the mover whose war id CHANGED, and the fan-out is
 * `FOR_VISIBILITYRANGE` -- vicinity, not the guild roster. That is deliberate:
 * the recipients who need it are whoever can currently SEE the player, because
 * this is what lets their client resolve `IsWarTarget` and draw the enemy flag.
 */
export function buildSetWar(affectedObjid: number, idWar: number): Buffer {
  const w = snap(SNAPSHOTTYPE.SET_WAR, affectedObjid);
  w.writeDword(idWar);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_WAR` (0x00da) -- `CUser::AddMyGuildWar` (`User.cpp:1930-1945`).
 * **JOIN only**, sent third after ALL_GUILDS then GUILD (`User.cpp:330-332`).
 *
 * The `idWar` DWORD is written TWICE and that is not a bug in this port: C++
 * writes a bare `pWar->m_idWar` at `:1942` and then calls `pWar->Serialize`,
 * whose first field is `m_idWar` again. The client reads it twice to match
 * (`DPClientGuildWar.cpp:193-226`); collapsing the duplicate desyncs the stream.
 *
 * `objid` is NULL_ID -- this record is about the war, not about a mover.
 */
export function buildMyGuildWar(war: GuildWarSnapshot): Buffer {
  const w = snap(SNAPSHOTTYPE.WAR, NULL_ID);
  w.writeDword(war.id); // the duplicate -- see above
  writeCGuildWar(w, war);
  return w.build();
}


/**
 * `PACKETTYPE_DECL_GUILD_WAR` (`SendDeclWar`, `DPCacheSrvr.cpp:2596-2602`) --
 * "guild X declares war on you". Body: `DWORD idDecl | String szMaster`.
 * Sent to the TARGET guild's master only; it opens `CWndGuildWarRequest`.
 *
 * Note the asymmetry with the C→S opcode of the same value: inbound it carries
 * the target guild's NAME, outbound it carries the declarer's guild ID.
 */
export function buildDeclWar(idDecl: number, masterName: string): Buffer {
  const w = pkt(PACKETTYPE.DECL_GUILD_WAR);
  w.writeDword(idDecl);
  w.writeString(masterName);
  return w.build();
}

/**
 * `PACKETTYPE_ACPT_GUILD_WAR` (`SendAcptWar`, `:2604-2609`) -- the war is on.
 * Body: `DWORD idWar | DWORD idDecl | DWORD idAcpt`.
 *
 * C++ sends this to `DPID_ALLPLAYERS` -- the whole shard, not the two guilds,
 * because every client keeps its own `g_GuildWarMng` so any observer can resolve
 * `IsWarTarget` on the participants.
 */
export function buildAcptWar(idWar: number, idDecl: number, idAcpt: number): Buffer {
  const w = pkt(PACKETTYPE.ACPT_GUILD_WAR);
  w.writeDword(idWar);
  w.writeDword(idDecl);
  w.writeDword(idAcpt);
  return w.build();
}

/**
 * `PACKETTYPE_SURRENDER` (`SendSurrender`, `:2351-2358`) -- somebody gave up.
 * Body: `DWORD idWar | DWORD idPlayer | String szPlayer | BOOL bDecl`.
 *
 * `bDecl` is a `BOOL`, so **4 bytes** (`ar.h:253` writes `sizeof(BOOL)`), not a
 * byte. Recipients are every online member of BOTH rosters (`:2335-2349`).
 */
export function buildSurrender(
  idWar: number, idPlayer: number, playerName: string, isDecl: boolean,
): Buffer {
  const w = pkt(PACKETTYPE.SURRENDER);
  w.writeDword(idWar);
  w.writeDword(idPlayer);
  w.writeString(playerName);
  w.writeDword(isDecl ? 1 : 0);
  return w.build();
}

/**
 * `PACKETTYPE_QUERY_TRUCE` (`SendQueryTruce`, `:2627-2631`) -- "the other master
 * proposes a truce". **Empty body**: the recipient is the only party that
 * matters and the client already knows its own war.
 */
export function buildQueryTruce(): Buffer {
  return pkt(PACKETTYPE.QUERY_TRUCE).build();
}

/**
 * `PACKETTYPE_WAR_END` (`SendWarEnd`, `DPCacheSrvr.cpp:2611-2616`).
 * Body: `DWORD idWar | int nWptDecl | int nWptAcpt | int nType`.
 *
 * The two win points are the ratings AFTER the update: the client re-runs
 * `CGuildWarMng::Result` locally, and its non-CoreServer branch ASSIGNS them
 * rather than recomputing the formula (`guildwar.cpp:218-219`), so these values
 * are authoritative. `nType` is a `WR_*` ordinal -- and note the client uses it
 * to pick which end-of-war line to print, so TRUCE (8) and DRAW (9) must be sent
 * as themselves even though they leave the record untouched.
 */
export function buildWarEnd(
  idWar: number, winPointDecl: number, winPointAcpt: number, resultType: number,
): Buffer {
  const w = pkt(PACKETTYPE.WAR_END);
  w.writeDword(idWar);
  w.writeDword(winPointDecl | 0);
  w.writeDword(winPointAcpt | 0);
  w.writeDword(resultType | 0);
  return w.build();
}

/**
 * `PACKETTYPE_WAR_DEAD` (`SendWarDead`, `:2618-2625`) -- a non-master casualty.
 * Body: `DWORD idWar | String szPlayer | BOOL bDecl` (`BOOL` = 4 bytes).
 *
 * Only sent for NON-masters: a master's death ends the war instead and produces
 * WAR_END (`DPCoreSrvr.cpp:1645-1648`).
 */
export function buildWarDead(idWar: number, playerName: string, isDecl: boolean): Buffer {
  const w = pkt(PACKETTYPE.WAR_DEAD);
  w.writeDword(idWar);
  w.writeString(playerName);
  w.writeDword(isDecl ? 1 : 0);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_SETGUILDQUEST` (0x00b5) -- one guild-quest entry changed.
 * Body: `int nQuestId | int nState` (`CUser::AddSetGuildQuest`, `User.cpp:2297`).
 *
 * Sent per online member from `CGuild::SetQuest`'s notify loop
 * (`guild.cpp:930-943`), which is why the leading objid is the RECIPIENT's own
 * id rather than an affected third party -- the client handler
 * (`DPClient.cpp:8403`) ignores the objid entirely and applies the entry to
 * `GetActiveMover()->GetGuild()`, so the recipient's id is the only value that
 * cannot mislead a future reader.
 *
 * There is no removal counterpart in practice: `SNAPSHOTTYPE_REMOVEGUILDQUEST`
 * (0x00b6) has a writer but no reachable caller (`CGuild::RemoveQuest` returns
 * above its notify loop, `guild.cpp:952`), so a faithful port never sends it.
 */
export function buildSetGuildQuest(selfObjid: number, questId: number, state: number): Buffer {
  const w = snap(SNAPSHOTTYPE.SETGUILDQUEST, selfObjid);
  w.writeDword(questId);
  w.writeDword(state);
  return w.build();
}
