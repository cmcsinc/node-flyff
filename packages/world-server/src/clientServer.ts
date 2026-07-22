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
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { JoinHandler } from './handlers/join.handler.js';
import type { MapKeyHandler } from './handlers/mapKey.handler.js';
import type { QueryPlayerDataHandler } from './handlers/queryPlayerData.handler.js';
import type { SnapshotHandler } from './handlers/snapshot.handler.js';
import type { PlayerMovedHandler } from './handlers/playerMoved.handler.js';
import type { PlayerBehaviorHandler } from './handlers/playerBehavior.handler.js';
import type { ChatHandler } from './handlers/chat.handler.js';
import type { MotionHandler } from './handlers/motion.handler.js';
import type { SetTargetHandler } from './handlers/setTarget.handler.js';
import type { LeaveHandler } from './handlers/leave.handler.js';
import type { PlayerCorrHandler } from './handlers/playerCorr.handler.js';
import type { PlayerMoved2Handler } from './handlers/playerMoved2.handler.js';
import type { PlayerAngleHandler } from './handlers/playerAngle.handler.js';
import type { QueryGetPosHandler } from './handlers/queryGetPos.handler.js';
import type { QueryGetDestObjHandler } from './handlers/queryGetDestObj.handler.js';
import type { GetPosHandler } from './handlers/getPos.handler.js';
import type { ScriptDlgHandler } from './handlers/scriptDlg.handler.js';
import type { RevivalHandler } from './handlers/revival.handler.js';
import type { PlayerSetDestObjHandler } from './handlers/playerSetDestObj.handler.js';
import type { MeleeAttackHandler } from './handlers/meleeAttack.handler.js';
import type { UseSkillHandler } from './handlers/useSkill.handler.js';
import type { DoUseSkillPointHandler } from './handlers/doUseSkillPoint.handler.js';
import type { ActMsgHandler } from './handlers/actMsg.handler.js';
import type { MoveItemHandler } from './handlers/moveItem.handler.js';
import type { DropItemHandler } from './handlers/dropItem.handler.js';
import type { DropGoldHandler } from './handlers/dropGold.handler.js';
import type { RemoveItemHandler } from './handlers/removeItem.handler.js';
import type { DoEquipHandler } from './handlers/doEquip.handler.js';
import type { DoUseItemHandler } from './handlers/doUseItem.handler.js';
import type { BankHandler } from './handlers/bank.handler.js';
import type { ShopHandler } from './handlers/shop.handler.js';
import type { RemoveQuestHandler } from './handlers/removeQuest.handler.js';
import type { QuestCheckHandler } from './handlers/questCheck.handler.js';
import type { QuestHelperHandler } from './handlers/questHelper.handler.js';

export interface WorldClientServerDeps {
  joinHandler: JoinHandler;
  mapKeyHandler: MapKeyHandler;
  queryPlayerDataHandler: QueryPlayerDataHandler;
  snapshotHandler: SnapshotHandler;
  playerMovedHandler: PlayerMovedHandler;
  playerBehaviorHandler: PlayerBehaviorHandler;
  chatHandler: ChatHandler;
  motionHandler: MotionHandler;
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
  playerSetDestObjHandler: PlayerSetDestObjHandler;
  meleeAttackHandler: MeleeAttackHandler;
  useSkillHandler: UseSkillHandler;
  doUseSkillPointHandler: DoUseSkillPointHandler;
  actMsgHandler: ActMsgHandler;
  moveItemHandler: MoveItemHandler;
  dropItemHandler: DropItemHandler;
  dropGoldHandler: DropGoldHandler;
  removeItemHandler: RemoveItemHandler;
  doEquipHandler: DoEquipHandler;
  doUseItemHandler: DoUseItemHandler;
  bankHandler: BankHandler;
  shopHandler: ShopHandler;
  removeQuestHandler: RemoveQuestHandler;
  questCheckHandler: QuestCheckHandler;
  questHelperHandler: QuestHelperHandler;
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
  dispatcher.register(PACKETTYPE.PLAYERSETDESTOBJ, (s, r) => deps.playerSetDestObjHandler.handlePlayerSetDestObj(s, r));
  dispatcher.register(PACKETTYPE.MELEE_ATTACK, (s, r) => deps.meleeAttackHandler.handleMeleeAttack(s, r));
  dispatcher.register(PACKETTYPE.USESKILL, (s, r) => deps.useSkillHandler.handleUseSkill(s, r));
  dispatcher.register(PACKETTYPE.DOUSESKILLPOINT, (s, r) => deps.doUseSkillPointHandler.handleDoUseSkillPoint(s, r));
  dispatcher.register(PACKETTYPE.ACTMSG, (s, r) => deps.actMsgHandler.handleActMsg(s, r));
  dispatcher.register(PACKETTYPE.MOVEITEM, (s, r) => deps.moveItemHandler.handleMoveItem(s, r));
  dispatcher.register(PACKETTYPE.DROPITEM, (s, r) => deps.dropItemHandler.handleDropItem(s, r));
  dispatcher.register(PACKETTYPE.DROPGOLD, (s, r) => deps.dropGoldHandler.handleDropGold(s, r));
  dispatcher.register(PACKETTYPE.REMOVEINVENITEM, (s, r) => deps.removeItemHandler.handleRemoveItem(s, r));
  dispatcher.register(PACKETTYPE.DOEQUIP, (s, r) => deps.doEquipHandler.handleDoEquip(s, r));
  dispatcher.register(PACKETTYPE.DOUSEITEM, (s, r) => deps.doUseItemHandler.handleDoUseItem(s, r));
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
  dispatcher.register(PACKETTYPE.REMOVEQUEST, (s, r) => deps.removeQuestHandler.handleRemoveQuest(s, r));
  dispatcher.register(PACKETTYPE.QUEST_CHECK, (s, r) => deps.questCheckHandler.handleQuestCheck(s, r));
  dispatcher.register(PACKETTYPE.QUESTHELPER_REQNPCPOS, (s, r) => deps.questHelperHandler.handleQuestHelper(s, r));
  return { server, dispatcher };
}
