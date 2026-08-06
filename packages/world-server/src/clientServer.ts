/**
 * World client-facing TCP server.
 *
 * Binds client->world opcodes to their handlers. `JOIN` writes the self-spawn
 * snapshot; the in-world handlers (MAP_KEY, QUERY_PLAYER_DATA, SNAPSHOT,
 * PLAYERMOVED, PLAYERBEHAVIOR) validate + delegate to their services. `index.ts`
 * calls `server.listen(config.server.port)`.
 *
 * @module clientServer
 */

import type { Server } from 'node:net';
import { createClientServer, type PacketDispatcher, type DispatcherLogger, type ClientSocket } from '@flyff/core/net';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { JoinHandler } from './handlers/join.handler';
import type { MapKeyHandler } from '@flyff/npc';
import type { QueryPlayerDataHandler } from './handlers/queryPlayerData.handler';
import type { SnapshotHandler } from './handlers/snapshot.handler';
import type { PlayerMovedHandler } from './handlers/playerMoved.handler';
import type { PlayerBehaviorHandler } from './handlers/playerBehavior.handler';
import type { PlayerBehavior2Handler } from './handlers/playerBehavior2.handler';
import type { ChatHandler } from './handlers/chat.handler';
import type { MotionHandler } from './handlers/motion.handler';
import type { MoverFocusHandler } from './handlers/moverFocus.handler';
import type { GmChatLogHandler } from './handlers/gmChatLog.handler';
import type { QueryEquipHandler } from './handlers/queryEquip.handler';
import type { CheeringHandler } from './handlers/cheering.handler';
import type { TradeHandler } from '@flyff/inventory';
import type { VendorHandler } from '@flyff/inventory';
import type { FriendHandler, CampusHandler } from '@flyff/social';
import type { SetTargetHandler } from '@flyff/npc';
import type { LeaveHandler } from './handlers/leave.handler';
import type { PlayerCorrHandler } from './handlers/playerCorr.handler';
import type { PlayerMoved2Handler } from './handlers/playerMoved2.handler';
import type { PlayerAngleHandler } from './handlers/playerAngle.handler';
import type { QueryGetPosHandler } from './handlers/queryGetPos.handler';
import type { QueryGetDestObjHandler } from './handlers/queryGetDestObj.handler';
import type { GetPosHandler } from './handlers/getPos.handler';
import type { ScriptDlgHandler } from '@flyff/npc';
import type { RevivalHandler } from './handlers/revival.handler';
import type { PkModeHandler } from './handlers/pkMode.handler';
import type { ReqLeaveHandler } from './handlers/reqLeave.handler';
import type { StateModeHandler } from './handlers/stateMode.handler';
import type { PlayerSetDestObjHandler } from './handlers/playerSetDestObj.handler';
import type { MeleeAttackHandler } from '@flyff/combat';
import type { RangeAttackHandler } from '@flyff/combat';
import type { DuelHandler } from '@flyff/combat';
import type { PartyHandler } from '@flyff/party';
import type { GuildHandler } from '@flyff/guild';
import type { UseSkillHandler } from '@flyff/skills';
import type { DoUseSkillPointHandler } from '@flyff/skills';
import type { ModifyStatusHandler } from './handlers/modifyStatus.handler';
import type { ActMsgHandler } from '@flyff/inventory';
import type { MoveItemHandler } from '@flyff/inventory';
import type { DropItemHandler } from '@flyff/inventory';
import type { DropGoldHandler } from '@flyff/inventory';
import type { RemoveItemHandler } from '@flyff/inventory';
import type { DoEquipHandler } from '@flyff/inventory';
import type { DoUseItemHandler } from '@flyff/inventory';
import type { EnchantHandler } from '@flyff/inventory';
import type { RepairHandler } from '@flyff/inventory';
import type { BankHandler } from '@flyff/npc';
import type { ShopHandler } from '@flyff/npc';
import type { NpcBuffHandler } from '@flyff/npc';
import type { TaskBarHandler } from './handlers/taskbar.handler';
import type { SkillTaskBarHandler } from './handlers/skillTaskbar.handler';
import type { EndSkillQueueHandler } from './handlers/endSkillQueue.handler';
import type { RemoveQuestHandler } from '@flyff/quest';
import type { QuestCheckHandler } from '@flyff/quest';
import type { QuestHelperHandler } from '@flyff/quest';
import type { MailHandler } from '@flyff/mail';

export interface WorldClientServerDeps {
  joinHandler: JoinHandler;
  mapKeyHandler: MapKeyHandler;
  queryPlayerDataHandler: QueryPlayerDataHandler;
  snapshotHandler: SnapshotHandler;
  playerMovedHandler: PlayerMovedHandler;
  playerBehaviorHandler: PlayerBehaviorHandler;
  playerBehavior2Handler: PlayerBehavior2Handler;
  chatHandler: ChatHandler;
  motionHandler: MotionHandler;
  moverFocusHandler: MoverFocusHandler;
  gmChatLogHandler: GmChatLogHandler;
  queryEquipHandler: QueryEquipHandler;
  cheeringHandler: CheeringHandler;
  tradeHandler: TradeHandler;
  vendorHandler: VendorHandler;
  friendHandler: FriendHandler;
  campusHandler: CampusHandler;
  setTargetHandler: SetTargetHandler;
  leaveHandler: LeaveHandler;
  playerCorrHandler: PlayerCorrHandler;
  playerMoved2Handler: PlayerMoved2Handler;
  playerAngleHandler: PlayerAngleHandler;
  queryGetPosHandler: QueryGetPosHandler;
  queryGetDestObjHandler: QueryGetDestObjHandler;
  getPosHandler: GetPosHandler;
  scriptDlgHandler: ScriptDlgHandler;
  revivalHandler: RevivalHandler;
  pkModeHandler: PkModeHandler;
  stateModeHandler: StateModeHandler;
  playerSetDestObjHandler: PlayerSetDestObjHandler;
  meleeAttackHandler: MeleeAttackHandler;
  rangeAttackHandler: RangeAttackHandler;
  duelHandler: DuelHandler;
  partyHandler: PartyHandler;
  guildHandler: GuildHandler;
  useSkillHandler: UseSkillHandler;
  doUseSkillPointHandler: DoUseSkillPointHandler;
  modifyStatusHandler: ModifyStatusHandler;
  actMsgHandler: ActMsgHandler;
  moveItemHandler: MoveItemHandler;
  dropItemHandler: DropItemHandler;
  dropGoldHandler: DropGoldHandler;
  removeItemHandler: RemoveItemHandler;
  doEquipHandler: DoEquipHandler;
  doUseItemHandler: DoUseItemHandler;
  enchantHandler: EnchantHandler;
  repairHandler: RepairHandler;
  bankHandler: BankHandler;
  shopHandler: ShopHandler;
  npcBuffHandler: NpcBuffHandler;
  taskbarHandler: TaskBarHandler;
  skillTaskbarHandler: SkillTaskBarHandler;
  endSkillQueueHandler: EndSkillQueueHandler;
  reqLeaveHandler: ReqLeaveHandler;
  removeQuestHandler: RemoveQuestHandler;
  questCheckHandler: QuestCheckHandler;
  questHelperHandler: QuestHelperHandler;
  mailHandler: MailHandler;
  /**
   * Connection-close lifecycle hook. The dispatcher fires this on every
   * disconnect (LEAVE, alt-F4, reset); the world uses it to flush the live
   * player's checkpoint state to the DB before release. Optional only in tests.
   */
  onDisconnect?: (socket: ClientSocket) => void;
  logger?: DispatcherLogger;
}

export function buildWorldClientServer(deps: WorldClientServerDeps): {
  server: Server;
  dispatcher: PacketDispatcher;
} {
  const dd: { logger?: DispatcherLogger; crc: true; leadsWithDpid: true; onDisconnect?: (socket: ClientSocket) => void } = { crc: true, leadsWithDpid: true };
  if (deps.logger !== undefined) dd.logger = deps.logger;
  if (deps.onDisconnect) dd.onDisconnect = deps.onDisconnect;
  const { server, dispatcher } = createClientServer(dd);
  dispatcher.register(PACKETTYPE.JOIN, (s, r) => deps.joinHandler.handleJoin(s, r));
  dispatcher.register(PACKETTYPE.MAP_KEY, (s, r) => deps.mapKeyHandler.handleMapKey(s, r));
  dispatcher.register(PACKETTYPE.QUERY_PLAYER_DATA, (s, r) => deps.queryPlayerDataHandler.handleQueryPlayerData(s, r));
  dispatcher.register(PACKETTYPE.SNAPSHOT, (s, r) => deps.snapshotHandler.handleSnapshot(s, r));
  dispatcher.register(PACKETTYPE.PLAYERMOVED, (s, r) => deps.playerMovedHandler.handlePlayerMoved(s, r));
  dispatcher.register(PACKETTYPE.PLAYERBEHAVIOR, (s, r) => deps.playerBehaviorHandler.handlePlayerBehavior(s, r));
  dispatcher.register(PACKETTYPE.PLAYERBEHAVIOR2, (s, r) => deps.playerBehavior2Handler.handlePlayerBehavior2(s, r));
  dispatcher.register(PACKETTYPE.CHAT, (s, r) => deps.chatHandler.handleChat(s, r));
  dispatcher.register(PACKETTYPE.MOTION, (s, r) => deps.motionHandler.handleMotion(s, r));
  dispatcher.register(PACKETTYPE.SETTARGET, (s, r) => deps.setTargetHandler.handleSetTarget(s, r));
  dispatcher.register(PACKETTYPE.LEAVE, (s) => deps.leaveHandler.handleLeave(s));
  dispatcher.register(PACKETTYPE.PLAYERCORR, (s, r) => deps.playerCorrHandler.handlePlayerCorr(s, r));
  dispatcher.register(PACKETTYPE.PLAYERMOVED2, (s, r) => deps.playerMoved2Handler.handlePlayerMoved2(s, r));
  dispatcher.register(PACKETTYPE.PLAYERANGLE, (s, r) => deps.playerAngleHandler.handlePlayerAngle(s, r));
  dispatcher.register(PACKETTYPE.QUERYGETPOS, (s, r) => deps.queryGetPosHandler.handleQueryGetPos(s, r));
  dispatcher.register(PACKETTYPE.QUERYGETDESTOBJ, (s, r) => deps.queryGetDestObjHandler.handleQueryGetDestObj(s, r));
  dispatcher.register(PACKETTYPE.GETPOS, (s, r) => deps.getPosHandler.handleGetPos(s, r));
  dispatcher.register(PACKETTYPE.SCRIPTDLG, (s, r) => deps.scriptDlgHandler.handleScriptDlg(s, r));
  dispatcher.register(PACKETTYPE.REVIVAL, (s, r) => deps.revivalHandler.handleRevival(s, r));
  dispatcher.register(PACKETTYPE.REVIVAL_TO_LODESTAR, (s, r) => deps.revivalHandler.handleRevivalLodestar(s, r));
  dispatcher.register(PACKETTYPE.REVIVAL_TO_LODELIGHT, (s, r) => deps.revivalHandler.handleRevivalLodelight(s, r));
  dispatcher.register(PACKETTYPE.MODE, (s, r) => deps.pkModeHandler.handleMode(s, r));
  dispatcher.register(PACKETTYPE.STATEMODE, (s, r) => deps.stateModeHandler.handleStateMode(s, r));
  dispatcher.register(PACKETTYPE.PLAYERSETDESTOBJ, (s, r) => deps.playerSetDestObjHandler.handlePlayerSetDestObj(s, r));
  dispatcher.register(PACKETTYPE.MELEE_ATTACK, (s, r) => deps.meleeAttackHandler.handleMeleeAttack(s, r));
  dispatcher.register(PACKETTYPE.RANGE_ATTACK, (s, r) => deps.rangeAttackHandler.handleRangeAttack(s, r));
  // Projectile SFX bookkeeping. C++ tracks these in `m_sfxHitArray` purely so a
  // later SFX_HIT can be matched to its launch; the damage path they once fed
  // (`AttackBySFX`) is commented out in v19 and ranged damage is already resolved
  // eagerly by `CombatService.resolveAttack`. Registered so a bow shot does not
  // log "Unknown opcode" twice per arrow.
  dispatcher.register(PACKETTYPE.SFX_ID, () => {});
  dispatcher.register(PACKETTYPE.SFX_HIT, () => {});
  dispatcher.register(PACKETTYPE.DUELREQUEST, (s, r) => deps.duelHandler.handleDuelRequest(s, r));
  dispatcher.register(PACKETTYPE.DUELYES, (s, r) => deps.duelHandler.handleDuelYes(s, r));
  dispatcher.register(PACKETTYPE.DUELNO, (s, r) => deps.duelHandler.handleDuelNo(s, r));
  dispatcher.register(PACKETTYPE.MEMBERREQUEST, (s, r) => deps.partyHandler.handleMemberRequest(s, r));
  dispatcher.register(PACKETTYPE.MEMBERREQUESTCANCLE, (s, r) => deps.partyHandler.handleMemberRequestCancle(s, r));
  dispatcher.register(PACKETTYPE.ADDPARTYMEMBER, (s, r) => deps.partyHandler.handleAddPartyMember(s, r));
  dispatcher.register(PACKETTYPE.REMOVEPARTYMEMBER, (s, r) => deps.partyHandler.handleRemovePartyMember(s, r));
  dispatcher.register(PACKETTYPE.PARTYCHANGELEADER, (s, r) => deps.partyHandler.handlePartyChangeLeader(s, r));
  dispatcher.register(PACKETTYPE.CHANGETROUP, (s, r) => deps.partyHandler.handleChangeTroup(s, r));
  dispatcher.register(PACKETTYPE.PARTYCHANGEITEMMODE, (s, r) => deps.partyHandler.handlePartyChangeItemMode(s, r));
  dispatcher.register(PACKETTYPE.PARTYCHANGEEXPMODE, (s, r) => deps.partyHandler.handlePartyChangeExpMode(s, r));
  dispatcher.register(PACKETTYPE.PARTYCHAT, (s, r) => deps.partyHandler.handlePartyChat(s, r));
  dispatcher.register(PACKETTYPE.SETNAVIPOINT, (s, r) => deps.partyHandler.handleSetNaviPoint(s, r));
  // Guild -- 16 C->S opcodes. Guild CHAT is deliberately absent: `/g <msg>`
  // arrives as PACKETTYPE_CHAT and the chat command router calls
  // `GuildService.chat`, exactly as `FuncTextCmd.cpp:1122` does.
  dispatcher.register(PACKETTYPE.GUILD_INVITE, (s, r) => deps.guildHandler.handleGuildInvite(s, r));
  dispatcher.register(PACKETTYPE.IGNORE_GUILD_INVITE, (s, r) => deps.guildHandler.handleIgnoreGuildInvite(s, r));
  dispatcher.register(PACKETTYPE.ADD_GUILD_MEMBER, (s, r) => deps.guildHandler.handleAddGuildMember(s, r));
  dispatcher.register(PACKETTYPE.REMOVE_GUILD_MEMBER, (s, r) => deps.guildHandler.handleRemoveGuildMember(s, r));
  dispatcher.register(PACKETTYPE.DESTROY_GUILD, (s, r) => deps.guildHandler.handleDestroyGuild(s, r));
  dispatcher.register(PACKETTYPE.GUILD_MEMBER_LEVEL, (s, r) => deps.guildHandler.handleGuildMemberLevel(s, r));
  dispatcher.register(PACKETTYPE.GUILD_CLASS, (s, r) => deps.guildHandler.handleGuildClass(s, r));
  dispatcher.register(PACKETTYPE.GUILD_NICKNAME, (s, r) => deps.guildHandler.handleGuildNickname(s, r));
  dispatcher.register(PACKETTYPE.CHG_MASTER, (s, r) => deps.guildHandler.handleChgMaster(s, r));
  dispatcher.register(PACKETTYPE.NW_GUILDLOGO, (s, r) => deps.guildHandler.handleGuildLogo(s, r));
  dispatcher.register(PACKETTYPE.NW_GUILDNOTICE, (s, r) => deps.guildHandler.handleGuildNotice(s, r));
  dispatcher.register(PACKETTYPE.NW_GUILDCONTRIBUTION, (s, r) => deps.guildHandler.handleGuildContribution(s, r));
  dispatcher.register(PACKETTYPE.GUILD_AUTHORITY, (s, r) => deps.guildHandler.handleGuildAuthority(s, r));
  dispatcher.register(PACKETTYPE.GUILD_PENYA, (s, r) => deps.guildHandler.handleGuildPenya(s, r));
  dispatcher.register(PACKETTYPE.GUILD_SETNAME, (s, r) => deps.guildHandler.handleGuildSetName(s, r));
  // Guild bank -- all 5 re-check MMI_GUILDBANKING proximity in the service, not
  // just on open, so holding the window and walking away stops transacting.
  dispatcher.register(PACKETTYPE.GUILD_BANK_WND, (s, r) => deps.guildHandler.handleGuildBankWnd(s, r));
  dispatcher.register(PACKETTYPE.GUILD_BANK_WND_CLOSE, (s, r) => deps.guildHandler.handleGuildBankWndClose(s, r));
  dispatcher.register(PACKETTYPE.PUTITEMGUILDBANK, (s, r) => deps.guildHandler.handlePutItemGuildBank(s, r));
  dispatcher.register(PACKETTYPE.GETITEMGUILDBANK, (s, r) => deps.guildHandler.handleGetItemGuildBank(s, r));
  dispatcher.register(PACKETTYPE.GUILD_BANK_MOVEITEM, (s, r) => deps.guildHandler.handleGuildBankMoveItem(s, r));
  // Guild war -- 5 opcodes. Off by default (`EVE_GUILDWAR`); the service refuses
  // declare/accept when the flag is down, so these are safe to register always.
  // There is no reject/decline opcode for either the war or the truce: the
  // client's "No" is a bare Destroy() with no send.
  dispatcher.register(PACKETTYPE.DECL_GUILD_WAR, (s, r) => deps.guildHandler.handleDeclGuildWar(s, r));
  dispatcher.register(PACKETTYPE.ACPT_GUILD_WAR, (s, r) => deps.guildHandler.handleAcptGuildWar(s, r));
  dispatcher.register(PACKETTYPE.SURRENDER, (s, r) => deps.guildHandler.handleSurrender(s, r));
  dispatcher.register(PACKETTYPE.QUERY_TRUCE, (s, r) => deps.guildHandler.handleQueryTruce(s, r));
  dispatcher.register(PACKETTYPE.ACPT_TRUCE, (s, r) => deps.guildHandler.handleAcptTruce(s, r));
  dispatcher.register(PACKETTYPE.USESKILL, (s, r) => deps.useSkillHandler.handleUseSkill(s, r));
  dispatcher.register(PACKETTYPE.DOUSESKILLPOINT, (s, r) => deps.doUseSkillPointHandler.handleDoUseSkillPoint(s, r));
  dispatcher.register(PACKETTYPE.MODIFY_STATUS, (s, r) => deps.modifyStatusHandler.handleModifyStatus(s, r));
  dispatcher.register(PACKETTYPE.ACTMSG, (s, r) => deps.actMsgHandler.handleActMsg(s, r));
  dispatcher.register(PACKETTYPE.MOVEITEM, (s, r) => deps.moveItemHandler.handleMoveItem(s, r));
  dispatcher.register(PACKETTYPE.DROPITEM, (s, r) => deps.dropItemHandler.handleDropItem(s, r));
  dispatcher.register(PACKETTYPE.DROPGOLD, (s, r) => deps.dropGoldHandler.handleDropGold(s, r));
  dispatcher.register(PACKETTYPE.REMOVEINVENITEM, (s, r) => deps.removeItemHandler.handleRemoveItem(s, r));
  dispatcher.register(PACKETTYPE.DOEQUIP, (s, r) => deps.doEquipHandler.handleDoEquip(s, r));
  dispatcher.register(PACKETTYPE.DOUSEITEM, (s, r) => deps.doUseItemHandler.handleDoUseItem(s, r));
  dispatcher.register(PACKETTYPE.ENCHANT, (s, r) => deps.enchantHandler.handleEnchant(s, r));
  dispatcher.register(PACKETTYPE.REPAIRITEM, (s, r) => deps.repairHandler.handleRepair(s, r));
  dispatcher.register(PACKETTYPE.OPENBANKWND, (s, r) => deps.bankHandler.handleOpen(s, r));
  dispatcher.register(PACKETTYPE.CLOSEBANKWND, (s, r) => deps.bankHandler.handleClose(s, r));
  dispatcher.register(PACKETTYPE.PUTITEMBACK, (s, r) => deps.bankHandler.handleDeposit(s, r));
  dispatcher.register(PACKETTYPE.GETITEMBACK, (s, r) => deps.bankHandler.handleWithdraw(s, r));
  dispatcher.register(PACKETTYPE.PUTGOLDBACK, (s, r) => deps.bankHandler.handleDepositGold(s, r));
  dispatcher.register(PACKETTYPE.GETGOLDBACK, (s, r) => deps.bankHandler.handleWithdrawGold(s, r));
  dispatcher.register(PACKETTYPE.CONFIRMBANK, (s, r) => deps.bankHandler.handleConfirmBankPass(s, r));
  dispatcher.register(PACKETTYPE.CHANGEBANKPASS, (s, r) => deps.bankHandler.handleChangeBankPass(s, r));
  dispatcher.register(PACKETTYPE.OPENSHOPWND, (s, r) => deps.shopHandler.handleOpen(s, r));
  dispatcher.register(PACKETTYPE.CLOSESHOPWND, (s, r) => deps.shopHandler.handleClose(s, r));
  dispatcher.register(PACKETTYPE.BUYITEM, (s, r) => deps.shopHandler.handleBuy(s, r));
  dispatcher.register(PACKETTYPE.SELLITEM, (s, r) => deps.shopHandler.handleSell(s, r));
  dispatcher.register(PACKETTYPE.NPC_BUFF, (s, r) => deps.npcBuffHandler.handleNpcBuff(s, r));
  dispatcher.register(PACKETTYPE.ADDITEMTASKBAR, (s, r) => deps.taskbarHandler.handleAddItem(s, r));
  dispatcher.register(PACKETTYPE.REMOVEITEMTASKBAR, (s, r) => deps.taskbarHandler.handleRemoveItem(s, r));
  dispatcher.register(PACKETTYPE.SKILLTASKBAR, (s, r) => deps.skillTaskbarHandler.handleSkillTaskBar(s, r));
  dispatcher.register(PACKETTYPE.MOVERFOCOUS, (s, r) => deps.moverFocusHandler.handleMoverFocus(s, r));
  dispatcher.register(PACKETTYPE.LOG_GAMEMASTER_CHAT, (s, r) => deps.gmChatLogHandler.handleGmChatLog(s, r));
  dispatcher.register(PACKETTYPE.QUERYEQUIP, (s, r) => deps.queryEquipHandler.handleQueryEquip(s, r));
  dispatcher.register(PACKETTYPE.QUERYEQUIPSETTING, (s, r) => deps.queryEquipHandler.handleQueryEquipSetting(s, r));
  dispatcher.register(PACKETTYPE.CHEERING, (s, r) => deps.cheeringHandler.handleCheering(s, r));
  // Trade -- 10 opcodes. TRADECLEARGOLD has no v19 C++ handler (DPSrvr.cpp:8838
  // commented out); registered so it stops logging as unknown, then dropped.
  dispatcher.register(PACKETTYPE.CONFIRMTRADE, (s, r) => deps.tradeHandler.handleConfirmTrade(s, r));
  dispatcher.register(PACKETTYPE.CONFIRMTRADECANCEL, (s, r) => deps.tradeHandler.handleConfirmTradeCancel(s, r));
  dispatcher.register(PACKETTYPE.TRADE, (s, r) => deps.tradeHandler.handleTrade(s, r));
  dispatcher.register(PACKETTYPE.TRADEPUT, (s, r) => deps.tradeHandler.handleTradePut(s, r));
  dispatcher.register(PACKETTYPE.TRADEPULL, (s, r) => deps.tradeHandler.handleTradePull(s, r));
  dispatcher.register(PACKETTYPE.TRADEPUTGOLD, (s, r) => deps.tradeHandler.handleTradePutGold(s, r));
  dispatcher.register(PACKETTYPE.TRADECLEARGOLD, (s) => deps.tradeHandler.handleTradeClearGold(s));
  dispatcher.register(PACKETTYPE.TRADEOK, (s) => deps.tradeHandler.handleTradeOk(s));
  dispatcher.register(PACKETTYPE.TRADECONFIRM, (s) => deps.tradeHandler.handleTradeConfirm(s));
  dispatcher.register(PACKETTYPE.TRADECANCEL, (s, r) => deps.tradeHandler.handleTradeCancel(s, r));
  // Vendor (private shop) -- the 6-opcode CVTInfo vendor half. Bodies mirror
  // DPSrvr.cpp:8959/9065/9248/9228/9197/9143 (see vendor.handler).
  dispatcher.register(PACKETTYPE.PVENDOR_OPEN, (s, r) => deps.vendorHandler.handlePVendorOpen(s, r));
  dispatcher.register(PACKETTYPE.PVENDOR_CLOSE, (s, r) => deps.vendorHandler.handlePVendorClose(s, r));
  dispatcher.register(PACKETTYPE.REGISTER_PVENDOR_ITEM, (s, r) => deps.vendorHandler.handleRegisterPVendorItem(s, r));
  dispatcher.register(PACKETTYPE.UNREGISTER_PVENDOR_ITEM, (s, r) => deps.vendorHandler.handleUnregisterPVendorItem(s, r));
  dispatcher.register(PACKETTYPE.QUERY_PVENDOR_ITEM, (s, r) => deps.vendorHandler.handleQueryPVendorItem(s, r));
  dispatcher.register(PACKETTYPE.BUY_PVENDOR_ITEM, (s, r) => deps.vendorHandler.handleBuyPVendorItem(s, r));
  // Friend roster -- 6 opcodes. C++ splits these across the world and core
  // servers; one process handles all of them.
  dispatcher.register(PACKETTYPE.ADDFRIEND, (s, r) => deps.friendHandler.handleAddFriend(s, r));
  dispatcher.register(PACKETTYPE.ADDFRIENDREQEST, (s, r) => deps.friendHandler.handleRequest(s, r));
  dispatcher.register(PACKETTYPE.ADDFRIENDNAMEREQEST, (s, r) => deps.friendHandler.handleRequestByName(s, r));
  dispatcher.register(PACKETTYPE.ADDFRIENDCANCEL, (s, r) => deps.friendHandler.handleCancel(s, r));
  dispatcher.register(PACKETTYPE.GETFRIENDSTATE, (s, r) => deps.friendHandler.handleGetState(s, r));
  dispatcher.register(PACKETTYPE.SETFRIENDSTATE, (s, r) => deps.friendHandler.handleSetState(s, r));
  dispatcher.register(PACKETTYPE.REMOVEFRIEND, (s, r) => deps.friendHandler.handleRemove(s, r));
  dispatcher.register(PACKETTYPE.BLOCK, (s, r) => deps.friendHandler.handleBlock(s, r));
  // Campus -- only these 4 are client packets (DPSrvr.cpp:540-543). ALL /
  // ADD_MEMBER / UPDATE_POINT are DB-server->world and are not registered here.
  dispatcher.register(PACKETTYPE.CAMPUS_INVITE, (s, r) => deps.campusHandler.handleInvite(s, r));
  dispatcher.register(PACKETTYPE.CAMPUS_ACCEPT, (s, r) => deps.campusHandler.handleAccept(s, r));
  dispatcher.register(PACKETTYPE.CAMPUS_REFUSE, (s, r) => deps.campusHandler.handleRefuse(s, r));
  dispatcher.register(PACKETTYPE.CAMPUS_REMOVE_MEMBER, (s, r) => deps.campusHandler.handleRemoveMember(s, r));
  dispatcher.register(PACKETTYPE.ENDSKILLQUEUE, (s) => deps.endSkillQueueHandler.handleEndSkillQueue(s));
  dispatcher.register(PACKETTYPE.REQ_LEAVE, (s) => deps.reqLeaveHandler.handleReqLeave(s));
  dispatcher.register(PACKETTYPE.REMOVEQUEST, (s, r) => deps.removeQuestHandler.handleRemoveQuest(s, r));
  dispatcher.register(PACKETTYPE.QUEST_CHECK, (s, r) => deps.questCheckHandler.handleQuestCheck(s, r));
  dispatcher.register(PACKETTYPE.QUESTHELPER_REQNPCPOS, (s, r) => deps.questHelperHandler.handleQuestHelper(s, r));
  // Mail (post) -- the Post window's five packets. QUERYMAILBOX carries no
  // payload (SendQueryMailBox, DPClient.cpp:15923); the rest are `[nMail:DWORD]`.
  dispatcher.register(PACKETTYPE.QUERYMAILBOX, (s) => deps.mailHandler.handleQueryMailBox(s));
  dispatcher.register(PACKETTYPE.READMAIL, (s, r) => deps.mailHandler.handleReadMail(s, r));
  dispatcher.register(PACKETTYPE.QUERYGETMAILITEM, (s, r) => deps.mailHandler.handleGetMailItem(s, r));
  dispatcher.register(PACKETTYPE.QUERYGETMAILGOLD, (s, r) => deps.mailHandler.handleGetMailGold(s, r));
  dispatcher.register(PACKETTYPE.QUERYREMOVEMAIL, (s, r) => deps.mailHandler.handleRemoveMail(s, r));
  return { server, dispatcher };
}
