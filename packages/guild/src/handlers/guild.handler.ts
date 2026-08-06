/**
 * Guild C->S handlers -- the 16 guild opcodes
 * (`_Network/MsgHdr.h:315-332, 381-384, 455-506, 581`).
 *
 * Each body is parsed from the `PacketReader`, validated against the socket's
 * session (anti-forgery -- a client-sent `idMaster`/`idPlayer` that names
 * someone else is dropped), and delegated to {@link GuildService}. All send
 * paths live in the service; handlers never call `socket.write`.
 *
 * Wire layouts (`Neuz/DPClient.cpp` senders -- the client is the authority on
 * what actually arrives). Every field is 4 bytes unless flagged, because the
 * live `CAr` template writes `sizeof(T)` and `u_long`/`DWORD`/`int`/`BOOL` are
 * all 4 on Win32:
 *   GUILD_INVITE          `OBJID objid`                                  (:12503)
 *   IGNORE_GUILD_INVITE   `u_long idPlayer` (the INVITER)                (:12510)
 *   DESTROY_GUILD         `u_long idPlayer`                              (:12524)
 *   ADD_GUILD_MEMBER      `u_long idMaster | GUILD_MEMBER_INFO info`     (:12532)
 *   REMOVE_GUILD_MEMBER   `u_long idMaster | u_long idPlayer`            (:12540)
 *   GUILD_MEMBER_LEVEL    `u_long idMaster | u_long idPlayer | int lv`   (:13182)
 *   GUILD_CLASS           `BYTE nFlag | u_long idMaster | u_long idPlayer` (:13189)
 *   GUILD_NICKNAME        `u_long idSelf | u_long idPlayer | String alias` (:13201)
 *   NW_GUILDLOGO          `DWORD dwLogo`                                 (:13209)
 *   NW_GUILDCONTRIBUTION  `BYTE cbPxp | int nGold | BYTE cbItemFlag`     (:13221)
 *   NW_GUILDNOTICE        `String szNotice`                              (:13235)
 *   GUILD_AUTHORITY       `u_long idSelf | u_long idGuild | DWORD[5]`    (:13244)
 *   GUILD_PENYA           `u_long idSelf | u_long idGuild | DWORD type | DWORD penya` (:13254)
 *   GUILD_SETNAME         `u_long idSelf | u_long idGuild | String name` (:13262)
 *   CHG_MASTER            `u_long idSelf | u_long idPlayer2`             (:13277)
 *
 * Two shapes deserve a second look:
 *
 * - `GUILD_CLASS` leads with a **1-byte** `nFlag` (1 = promote class, 0 =
 *   demote) BEFORE the two ids. Reading it as a DWORD shifts both ids.
 * - `GUILD_AUTHORITY` ends with a RAW `DWORD[5]` (`ar.Write(dwAuthority,
 *   sizeof(DWORD) * MAX_GM_LEVEL)`) -- 20 bytes, no count prefix.
 * - `ADD_GUILD_MEMBER` carries a RAW `GUILD_MEMBER_INFO` struct: under v19 that
 *   is `{ u_long idPlayer; BYTE nMultiNo; }` padded to **8 bytes**, not 5. We
 *   resolve the accepting member from the session anyway (C++ CoreServer does
 *   the same, `DPCacheSrvr.cpp:1260`) but the bytes must still be consumed.
 *
 * There is no C->S guild-CHAT opcode: `/g <msg>` rides PACKETTYPE_CHAT and is
 * dispatched by the chat command router, which calls `GuildService.chat`
 * directly.
 *
 * Guards (rule 03): session IN_WORLD, player resolves, client-sent self-ids
 * match the session.
 *
 * @module handlers/guild
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { Validate } from '@flyff/core/utils/validate';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import { MAX_GM_LEVEL, MAX_G_NAME } from '@flyff/world-core';
import type { GuildService } from '../services/guild.service';
import type { GuildWarService } from '../services/guildWar.service';
import type { GuildContributionService } from '../services/guildContribution.service';
import type { GuildBankService } from '../services/guildBank.service';

const logger = createLogger({ module: 'guild-handler' });

export interface GuildHandlerDeps {
  playerManager: PlayerManager;
  guildService: GuildService;
  /**
   * Contribution service -- only NW_GUILDCONTRIBUTION needs it. Optional so a
   * world composed without the inventory port still handles the other 15
   * opcodes; a contribution packet is then parsed and dropped.
   */
  contributionService?: Pick<GuildContributionService, 'contribute'>;
  /**
   * Guild-bank service -- the 5 bank opcodes. Optional for the same reason as
   * {@link contributionService}: a world composed without the inventory port
   * still serves the roster half.
   */
  bankService?: Pick<GuildBankService, 'open_' | 'close' | 'putItem' | 'getItem' | 'moveItem'>;
  /**
   * Guild-war service -- the 5 war opcodes. Optional for the same reason as the
   * others, and additionally because guild war is off by default
   * (`EVE_GUILDWAR`): a world composed without it parses the packets and drops
   * them, which is the same observable behaviour as the flag being 0.
   */
  warService?: Pick<
    GuildWarService, 'declare_' | 'accept' | 'surrender' | 'queryTruce' | 'acceptTruce'
  >;
}

export class GuildHandler {
  constructor(private readonly deps: GuildHandlerDeps) {}

  /** GUILD_INVITE (0xffffff35) -- invite the player behind mover `objid`. */
  handleGuildInvite(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_INVITE', (player) => {
      const objid = reader.readDword();
      Validate.dword(objid);
      this.deps.guildService.invite(player, objid);
    });
  }

  /** IGNORE_GUILD_INVITE (0xffffff36) -- the invitee declines. */
  handleIgnoreGuildInvite(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'IGNORE_GUILD_INVITE', (player) => {
      void reader.readDword(); // inviter id -- resolved from the pending slot
      this.deps.guildService.decline(player);
    });
  }

  /**
   * ADD_GUILD_MEMBER (0xffffff33) -- the invitee accepts. Both the leading
   * `idMaster` and the 8-byte `GUILD_MEMBER_INFO` are echoed client state; the
   * accepting member and the guild both come from the pending invite, matching
   * `CDPCacheSrvr::OnAddGuildMember`'s use of `GetPlayerBySerial( dpidUser )`.
   */
  handleAddGuildMember(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'ADD_GUILD_MEMBER', (player) => {
      void reader.readDword(); // idMaster
      const infoPlayerId = reader.readDword(); // GUILD_MEMBER_INFO.idPlayer
      void reader.readByte();  // GUILD_MEMBER_INFO.nMultiNo
      void reader.readByte();  // struct tail padding x3
      void reader.readByte();
      void reader.readByte();
      // C++ rejects outright when the struct names a different player (:1260).
      if (infoPlayerId !== player.m_idPlayer) return;
      this.deps.guildService.accept(player);
    });
  }

  /** REMOVE_GUILD_MEMBER (0xffffff34) -- leave (self) or kick (master). */
  handleRemoveGuildMember(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'REMOVE_GUILD_MEMBER', (player) => {
      void reader.readDword(); // idMaster -- requester comes from the session
      const idPlayer = reader.readDword();
      Validate.dword(idPlayer);
      this.deps.guildService.leaveOrKick(player, idPlayer);
    });
  }

  /** DESTROY_GUILD (0xffffff32) -- master disbands. */
  handleDestroyGuild(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'DESTROY_GUILD', (player) => {
      void reader.readDword(); // idPlayer -- self, re-derived from the session
      this.deps.guildService.destroy(player);
    });
  }

  /** GUILD_MEMBER_LEVEL (0xffffff3a) -- promote/demote a member's rank. */
  handleGuildMemberLevel(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_MEMBER_LEVEL', (player) => {
      void reader.readDword(); // idMaster
      const idPlayer = reader.readDword();
      const nMemberLv = reader.readDword();
      Validate.dword(idPlayer);
      // The service re-checks this against the rank caps; bound it here too so a
      // wild value never reaches an array index (rule 03).
      if (nMemberLv >= MAX_GM_LEVEL) return;
      this.deps.guildService.setMemberLevel(player, idPlayer, nMemberLv);
    });
  }

  /**
   * GUILD_CLASS (0xffffff74) -- bump a member's sub-grade. `nFlag` is a
   * **1-byte** leading field: 1 = up, 0 = down.
   */
  handleGuildClass(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_CLASS', (player) => {
      const nFlag = reader.readByte(); // BYTE -- must not be read as a DWORD
      void reader.readDword();         // idMaster
      const idPlayer = reader.readDword();
      Validate.dword(idPlayer);
      this.deps.guildService.setMemberClass(player, idPlayer, nFlag === 1);
    });
  }

  /** GUILD_NICKNAME (0xffffff75) -- master sets a member's guild nickname. */
  handleGuildNickname(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_NICKNAME', (player) => {
      const idSelf = reader.readDword();
      const idPlayer = reader.readDword();
      const alias = reader.readString();
      if (idSelf !== player.m_idPlayer) return;
      Validate.dword(idPlayer);
      this.deps.guildService.setMemberAlias(player, idPlayer, alias);
    });
  }

  /** CHG_MASTER (0xf000f000) -- hand the guild to another member. */
  handleChgMaster(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'CHG_MASTER', (player) => {
      const idSelf = reader.readDword();
      const idPlayer2 = reader.readDword();
      if (idSelf !== player.m_idPlayer) return;
      Validate.dword(idPlayer2);
      this.deps.guildService.changeMaster(player, idPlayer2);
    });
  }

  /** NW_GUILDLOGO (0xf000b010) -- set the (write-once) guild logo. */
  handleGuildLogo(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'NW_GUILDLOGO', (player) => {
      const dwLogo = reader.readDword();
      Validate.dword(dwLogo);
      this.deps.guildService.setLogo(player, dwLogo);
    });
  }

  /** NW_GUILDNOTICE (0xf000b012) -- set the guild notice. */
  handleGuildNotice(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'NW_GUILDNOTICE', (player) => {
      const notice = reader.readString();
      this.deps.guildService.setNotice(player, notice);
    });
  }

  /**
   * GUILD_AUTHORITY (0xf000b026) -- replace the whole rank permission mask.
   * The trailing `DWORD[5]` is a raw blob with no count prefix.
   */
  handleGuildAuthority(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_AUTHORITY', (player) => {
      const idSelf = reader.readDword();
      void reader.readDword(); // idGuild -- resolved from membership instead
      if (idSelf !== player.m_idPlayer) return;
      const power: number[] = [];
      for (let i = 0; i < MAX_GM_LEVEL; i++) power.push(reader.readDword());
      this.deps.guildService.setAuthority(player, power);
    });
  }

  /** GUILD_PENYA (0xf000b027) -- set one rank's daily salary. */
  handleGuildPenya(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_PENYA', (player) => {
      const idSelf = reader.readDword();
      void reader.readDword(); // idGuild
      const dwType = reader.readDword();
      const dwPenya = reader.readDword();
      if (idSelf !== player.m_idPlayer) return;
      if (dwType >= MAX_GM_LEVEL) return; // bound the array index (rule 03)
      this.deps.guildService.setRankPenya(player, dwType, dwPenya);
    });
  }

  /** GUILD_SETNAME (0xf000b032) -- master renames the guild. */
  handleGuildSetName(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_SETNAME', (player) => {
      const idSelf = reader.readDword();
      void reader.readDword(); // idGuild
      const name = reader.readString();
      if (idSelf !== player.m_idPlayer) return;
      this.deps.guildService.rename(player, name);
    });
  }

  /**
   * NW_GUILDCONTRIBUTION (0xf000b011) -- contribute penya or gems.
   * Body: `BYTE cbPxpCount | int nGold | BYTE cbItemFlag`. Note the BYTE/int/
   * BYTE alternation: reading any of them at the wrong width desyncs the rest.
   *
   * The two modes are mutually exclusive and penya wins -- C++ tests `nGold > 0`
   * first (`DPSrvr.cpp:1855`) and only reaches the gem branch in the `else if`.
   */
  handleGuildContribution(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'NW_GUILDCONTRIBUTION', (player) => {
      const cbPxpCount = reader.readByte();
      const nGold = reader.readDword();
      const cbItemFlag = reader.readByte();
      // A negative/absurd amount can only come from a forged packet; the service
      // re-checks the balance, but bound it here too (rule 03).
      if (nGold < 0) return;
      this.deps.contributionService?.contribute(player, cbPxpCount, nGold, cbItemFlag);
    });
  }

  // ── Guild bank (42 slots) ──────────────────────────────────────────────────

  /**
   * GUILD_BANK_WND (0xf000b020) -- open the window. Bodyless.
   *
   * The trade/vendor/personal-bank exclusions C++ checks here (`DPSrvr.cpp:3279`)
   * live on other services, so they are not visible from this handler; the
   * service takes them as its `busy` argument and compose supplies the probe.
   */
  handleGuildBankWnd(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_BANK_WND', (player) => {
      this.deps.bankService?.open_(player);
    });
  }

  /** GUILD_BANK_WND_CLOSE (0xffffff3e) -- clears `m_bGuildBank`. Bodyless. */
  handleGuildBankWndClose(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_BANK_WND_CLOSE', (player) => {
      this.deps.bankService?.close(player);
    });
  }

  /**
   * PUTITEMGUILDBANK (0xf000b021) -- deposit.
   * Body: `BYTE nId (inv slot) | DWORD nItemNum | BYTE mode`.
   *
   * Note the BYTE/DWORD/BYTE alternation -- reading `nId` or `mode` as a DWORD
   * shifts everything after it. `mode == 0` means gold, which the service rejects
   * outright (penya is never deposited here).
   */
  handlePutItemGuildBank(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'PUTITEMGUILDBANK', (player) => {
      const nId = reader.readByte();
      const nItemNum = reader.readDword();
      const mode = reader.readByte();
      Validate.slot(nId);
      this.deps.bankService?.putItem(player, nId, nItemNum, mode);
    });
  }

  /**
   * GETITEMGUILDBANK (0xf000b022) -- withdraw.
   * Body: `BYTE nId (bank slot) | DWORD dwItemNum | BYTE mode`.
   *
   * `mode == 0` withdraws PENYA and `dwItemNum` is then the AMOUNT, not a count
   * -- so `nId` is meaningless in that branch and must not be slot-validated.
   */
  handleGetItemGuildBank(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GETITEMGUILDBANK', (player) => {
      const nId = reader.readByte();
      const dwItemNum = reader.readDword();
      const mode = reader.readByte();
      this.deps.bankService?.getItem(player, nId, dwItemNum, mode);
    });
  }

  /**
   * GUILD_BANK_MOVEITEM (0xffffff3f) -- reorder within the bank.
   * Body: `BYTE nSrc | BYTE nDest`. Both bounds-checked in the service against
   * MAX_GUILDBANK (42), which is smaller than the 73-slot inventory range
   * `Validate.slot` allows -- hence no `Validate.slot` here.
   */
  handleGuildBankMoveItem(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'GUILD_BANK_MOVEITEM', (player) => {
      const nSrc = reader.readByte();
      const nDest = reader.readByte();
      this.deps.bankService?.moveItem(player, nSrc, nDest);
    });
  }

  /**
   * Shared preamble: resolve the session player, then run `body` with the
   * `PacketError` -> warn-and-drop contract every other handler in this codebase
   * uses (a malformed packet must not kill the socket, but an unexpected error
   * must still surface).
   */
  // ── Guild war ──────────────────────────────────────────────────────────────

  /**
   * DECL_GUILD_WAR (0xf000b036) -- declare war on a guild BY NAME.
   * Body: `DWORD idMaster | String szGuild` (`DPClient.cpp` sender).
   *
   * The leading id is the client's own idea of who is asking; the service uses
   * the session player, so a forged id is dropped here rather than trusted.
   */
  handleDeclGuildWar(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'DECL_GUILD_WAR', (player) => {
      const idMaster = reader.readDword();
      const szGuild = reader.readString();
      if (idMaster !== player.m_idPlayer) return;
      // Bound the name before it reaches a Map lookup (rule 03). MAX_G_NAME is
      // the in-memory width the client itself reads with.
      if (szGuild.length === 0 || szGuild.length > MAX_G_NAME) return;
      this.deps.warService?.declare_(player, szGuild);
    });
  }

  /**
   * ACPT_GUILD_WAR (0xf000b037) -- the target master accepts.
   * Body: `DWORD idMaster | DWORD idDecl`.
   *
   * `idDecl` is the only piece of real information on the wire, and in C++ it is
   * trusted outright (`OnAcptWar`, the `// fixme - raiders` function). The
   * service validates it against the stored proposal.
   */
  handleAcptGuildWar(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'ACPT_GUILD_WAR', (player) => {
      const idMaster = reader.readDword();
      const idDecl = reader.readDword();
      if (idMaster !== player.m_idPlayer) return;
      Validate.dword(idDecl);
      this.deps.warService?.accept(player, idDecl);
    });
  }

  /** SURRENDER (0xf000b047) -- any member gives up. Body: `DWORD idPlayer`. */
  handleSurrender(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'SURRENDER', (player) => {
      const idPlayer = reader.readDword();
      if (idPlayer !== player.m_idPlayer) return;
      this.deps.warService?.surrender(player);
    });
  }

  /** QUERY_TRUCE (0xf000b048) -- master asks the enemy master for a truce. */
  handleQueryTruce(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'QUERY_TRUCE', (player) => {
      const idPlayer = reader.readDword();
      if (idPlayer !== player.m_idPlayer) return;
      this.deps.warService?.queryTruce(player);
    });
  }

  /**
   * ACPT_TRUCE (0xf000b049) -- the asked master agrees, ending the war with no
   * change to either record.
   *
   * There is deliberately no matching REJECT handler: the client's "No" button
   * is a bare `Destroy()` with no send (`WndGuildWarRequest.cpp:84-91`), so a
   * refused truce is indistinguishable from silence. The request simply stays
   * open until the war ends some other way.
   */
  handleAcptTruce(socket: ClientSocket, reader: PacketReader): void {
    this.guard(socket, reader, 'ACPT_TRUCE', (player) => {
      const idPlayer = reader.readDword();
      if (idPlayer !== player.m_idPlayer) return;
      this.deps.warService?.acceptTruce(player);
    });
  }

  private guard(
    socket: ClientSocket, _reader: PacketReader, op: string,
    body: (player: CPlayer) => void,
  ): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      body(player);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer, op }, 'guild packet parse failed');
        return;
      }
      throw error;
    }
  }

  private resolve(socket: ClientSocket): CPlayer | null {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return null; }
    const id = socket.session.charId;
    if (id === undefined) { socket.destroy(); return null; }
    const player = this.deps.playerManager.get(id);
    if (!player) { socket.destroy(); return null; }
    return player;
  }
}
