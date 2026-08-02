export const PACKETTYPE = Object.freeze({
  QUERYTICKCOUNT:       0x0000000b,
  PING:                 0x00000014,
  KEEP_ALIVE:           0x00000018,

  CACHE_ADDR:           0x000000f2,
  PLAYER_LIST:          0x000000f3,
  CREATE_PLAYER:        0x000000f4,
  DELETE_PLAYER:        0x000000f5,
  GETPLAYERLIST:        0x000000f6,
  SEL_PLAYER:           0x000000f7,
  SAVE_PLAYER:          0x000000f8,
  CERTIFY:              0x000000fc,
  SRVR_LIST:            0x000000fd,
  ERROR:                0x000000fe,

  // --- Mail / post (MsgHdr.h:30-37) ---------------------------------------
  // Admin->player mail only: the player-to-player send path
  // (`PACKETTYPE_QUERYPOSTMAIL` 0x1a) is deliberately NOT wired.
  // QUERYMAILBOX has an EMPTY payload (`SendQueryMailBox`, DPClient.cpp:15923);
  // the other four all carry a single `[nMail:DWORD]`.
  QUERYREMOVEMAIL:      0x0000001b, // MsgHdr.h:32 -- delete a mail (OnQueryRemoveMail, DPSrvr.cpp:7389)
  QUERYGETMAILITEM:     0x0000001c, // MsgHdr.h:33 -- pull the attached item (DPSrvr.cpp:7417)
  QUERYMAILBOX:         0x0000001d, // MsgHdr.h:34 -- request the full mailbox (DPSrvr.cpp:7526)
  QUERYGETMAILGOLD:     0x0000001f, // MsgHdr.h:36 -- pull the attached penya (DPSrvr.cpp:7470)
  READMAIL:             0x00000024, // MsgHdr.h:37 -- mark read (DPSrvr.cpp:7498)

  JOIN:                 0x0000ff00,
  LEAVE:                0x0000ff01,
  DESTROY_ALLPLAYERS:   0x0000ff02,
  CLOSE_ERROR:          0x0000ff04,
  PRE_JOIN:             0x0000ff05,

  CHAT:                 0x00ff0000,
  ACTMSG:               0x00ff0001, // MsgHdr.h:112 -- OnActMsg: DWORD dwMsg | int nParam1 | int nParam2 (OBJMSG_*; pickup=11)
  ADDOBJ:               0x00ff0002,
  REMOVEOBJ:            0x00ff0003,
  CONTROL:              0x00ff0004,
  CREATEITEM:           0x00ff0005,
  MOVEITEM:             0x00ff0006,
  DROPITEM:             0x00ff0007,
  DROPGOLD:             0x00ff0008,
  // MsgHdr.h:145 -- OnRemoveInvenItem (DPSrvr.cpp:8350): `DWORD dwId, int nNum`.
  // Right-click "Delete" / drag-to-trash -- destroys count, no ground pile.
  REMOVEINVENITEM:      0x00ff0019,
  DOEQUIP:              0x00ff000b,
  DAMAGE:               0x00ff000c,
  SETEXPERIENCE:        0x00ff000d,
  MELEE_ATTACK:         0x00ff0010,
  MAGIC_ATTACK:         0x00ff0011,
  RANGE_ATTACK:         0x00ff0012,
  MOVERDEATH:           0x00ff0013,
  MOTION:               0x00ff0016,
  USESKILL:             0x00ff0020,
  // v19 learn skills -- `DPSrvr::OnDoUseSkillPoint` (DPSrvr.cpp:3265). Body is
  // 45x (DWORD dwSkill, DWORD dwLevel) -- the player's desired job-skill roster,
  // one entry per m_aJobSkill slot. Atomic all-or-nothing server-side.
  DOUSESKILLPOINT:      0x000f0003,
  DOUSEITEM:            0x00ff0021,
  SETTARGET:            0x00ff0023,
  REVIVAL:              0x00ff00c0,
  // v19 client -> world revival opcodes (DPSrvr.cpp:960/1061/1188). All three
  // handlers read ZERO body fields -- the opcode alone selects the branch
  // (`SendHdr` on the client side). OnRevival=scroll, OnRevivalLodestar=town,
  // OnRevivalLodelight=empty C++ stub.
  REVIVAL_TO_LODESTAR:  0x00ff00c1,
  REVIVAL_TO_LODELIGHT: 0x00ff00c2,
  WHISPER:              0x00ff00d4,
  // MsgHdr.h:194 -- `CDPSrvr::OnEndSkillQueue` (DPSrvr.cpp:7077). Bodyless; the
  // opcode alone signals "skill queue cancelled". Server acks with a self-only
  // SNAPSHOTTYPE_ENDSKILLQUEUE so the client clears its taskbar cast slot
  // (`CUserTaskBar::OnEndSkillQueue` -> `AddHdr(self, ENDSKILLQUEUE)`).
  ENDSKILLQUEUE:         0x00ff00d5,
  SAY:                  0x00ff00e0,
  SHOUT:                0x00ff00e1,
  DEFINEDTEXT:          0x00ff00ec,
  SCRIPTDLG:            0x00ff00b0,
  // v19 NPC shop window -- `WORLDSERVER/DPSrvr.cpp:149-150`. OnOpenShopWnd:2744
  // reads `OBJID objid` (the vendor NPC); OnCloseShopWnd:2793 is bodyless. Open
  // validates the vendor is a trade NPC + sets the player's interacting-other;
  // ack is SNAPSHOTTYPE_OPENSHOPWND with the vendor's `m_ShopInventory`.
  OPENSHOPWND:          0x00ff00b1,
  CLOSESHOPWND:         0x00ff00b2,
  BUYITEM:              0x00ff00b3,
  SELLITEM:             0x00ff00b4,
  // v19 bank window -- `WORLDSERVER/DPSrvr.cpp:152-167`. OPENBANKWND dwId=NULL_ID
  // -> NPC bank; PUT/GET ITEMBACK nSlot=bank tab(0..2), nId=inv slot; PUT/GET
  // GOLDBACK nSlot=tab, dwGold=amount. MOVEBANKITEM (0xffffff46) is an empty C++
  // stub -- not registered.
  OPENBANKWND:          0xffffff40,
  CLOSEBANKWND:         0xffffff41,
  PUTITEMBACK:          0xffffff42,
  PUTGOLDBACK:          0xffffff43,
  GETITEMBACK:          0xffffff44,
  GETGOLDBACK:          0xffffff45,
  // OnChangeBankPass:3955. Body: `String szLastPass(<=4), String szNewPass(<=4),
  // DWORD dwId, DWORD dwItemId`. Acks SNAPSHOTTYPE_CHANGEBANKPASS nMode 1 (old
  // matched, new saved) / 0 (old wrong -> re-prompt).
  CHANGEBANKPASS:       0xffffff47,
  // v19 bank password confirm -- `WORLDSERVER/DPSrvr.cpp:167` OnConfirmBank:3991.
  // Body: `String szPass(10), DWORD dwId, DWORD dwItemId`. Ack is
  // SNAPSHOTTYPE_CONFIRMBANKPASS with nMode 1 (open) / 0 (re-prompt). Fires when
  // OPENBANKWND sent nMode=1 (bank has a password set).
  CONFIRMBANK:          0xffffff48,
  // v19 taskbar hotkey binding -- `WORLDSERVER/DPSrvr.cpp:2203/2251`.
  // OnAddItemTaskBar: `BYTE nSlotIndex, BYTE nIndex, DWORD dwShortcut, DWORD
  // dwId, DWORD dwType, DWORD dwIndex, DWORD dwUserId, DWORD dwData` (+ String
  // szString when dwShortcut==SHORTCUT_CHAT). OnRemoveItemTaskBar: `BYTE nSlotIndex,
  // BYTE nIndex`. Server stores the binding into m_playTaskBar.m_aSlotItem in
  // memory (no DB write in the C++ handler). Rejected paths send nothing.
  ADDITEMTASKBAR:        0xffffff0c,
  REMOVEITEMTASKBAR:     0xffffff0d,
  // v19 SKILLTASKBAR (0xffffff0e) -- `DPSrvr::OnSkillTaskBar` (DPSrvr.cpp:2141):
  // `[DWORD nCount] nCount*{ [BYTE nIndex][6 DWORDs: dwShortcut,dwId,dwType,
  // dwIndex,dwUserId,dwData] }`. Client always sends all MAX_SLOT_QUEUE(5)
  // slots (`CDPClient::SendSkillTaskBar`, DPClient.cpp:10834) -- the action
  // slot grid (m_playTaskBar.m_aSlotQueue). Echoed back on JOIN via the queue
  // section of SNAPSHOTTYPE_TASKBAR. END_SKILLQUEUE (0x00ff00d5) is the
  // separate cast-cancel/exhaustion ack, not the queue upload.
  SKILLTASKBAR:          0xffffff0e,
  // v19 client -> world quest handlers (`WORLDSERVER/DPSrvr.cpp`, msghdr.h)
  REMOVEQUEST:          0x00ff0026, // OnRemoveQuest -- DWORD dwQuestCancelID
  QUESTHELPER_REQNPCPOS: 0x70005000, // OnReqQuestNPCPos -- String szCharKey
  QUEST_CHECK:          0x88100110, // OnCheckedQuest -- int nQuestId, BOOL bCheck
  // v19 2nd-password numpad -- `LOGINSERVER/DPLoginSrvr.cpp:281-287` SendNumPadId.
  // S->C on GETPLAYERLIST: payload is one DWORD idNumPad (0-999). The client owns
  // a hardcoded byNumberTable[1000][10] in Wnd2ndPassword.cpp:186-388; the server
  // picks the row so the digit layout differs every session (anti-keylogger).
  // Cosmetic-only in this emulator -- not validated server-side.
  LOGIN_PROTECT_NUMPAD: 0x88100200,

  REPLACE:              0x00ff0f00,
  SETQUEST:             0x00ff0ff3,
  SCRIPT_CREATE_ITEM:   0x00ff0ff4,
  SCRIPT_ADD_GOLD:      0x00ff0ff5,

  SNAPSHOT:             0xffffff00,
  PLAYERMOVED:          0xffffff01,
  PLAYERBEHAVIOR:       0xffffff02,
  PLAYERMOVED2:         0xffffff03,
  PLAYERBEHAVIOR2:      0xffffff04,
  PLAYERCORR:           0xffffff05,
  PLAYERSETDESTOBJ:     0xffffff07,
  MOVERDESTPOS:         0xffffff0f,
  PLAYERANGLE:          0xffffff29,
  // v19 GM target-inspect -- `WORLDSERVER/DPSrvr.cpp:2154` OnMoverFocus.
  // Body: `[DWORD uidPlayer]`. Client sends it from `CWorld::SetObjFocus`
  // (`_Common/World.cpp:355`) ONLY when `g_pPlayer->IsAuthHigher(AUTH_GAMEMASTER)`
  // and the clicked object is a player -- the GM needs that player's live gold
  // and exp, which the ADD_OBJ snapshot does not carry. Reply is
  // SNAPSHOTTYPE_MOVERFOCUS (0x003b), self-only.
  MOVERFOCOUS:          0xffffff2d,
  // v19 GM whisper audit log -- `WORLDSERVER/DPSrvr.cpp:6677` OnGameMasterWhisper.
  // Body: `[String sPlayerFrom(<=42)][String lpString(<=260)]`. The CLIENT sends
  // it from `OnWhisper` (`Neuz/DPClient.cpp:11922`) when the RECEIVING player
  // `IsAuthHigher(AUTH_LOGCHATTING)` ('G') -- i.e. a GM-ish account that received
  // a whisper self-reports it so the server can log it. Server-side it only
  // forwards `"<from> -> <msg>"` to the DB log server; no reply, no game effect.
  LOG_GAMEMASTER_CHAT:  0x0f000f09,
  QUERYGETPOS:          0xffffff08,
  GETPOS:               0xffffff09,
  // v19 `WORLDSERVER/DPSrvr.cpp:1355` OnQueryGetDestObj -- OBJID objid. Client
  // polls a mover's walk-to-object destination (~3*/s) to sync pathfinding.
  QUERYGETDESTOBJ:      0xffffff72,

  // v19 `DPSrvr::OnMode` -- DWORD dwMode. Toggles PK / MATCHLESS / TRANSPARENT
  // mode bits. `dwMode=1` = PK on, `dwMode=0` = PK off.
  MODE:                 0xffffff7b,

  GUILD:                0xffffff30,

  // v19 client -> world -- `WORLDSERVER/DPSrvr.cpp` handlers.
  MAP_KEY:              0xfffff000, // OnMapKey -- per-.wld checksum as client loads the world
  QUERY_PLAYER_DATA:    0xf000f802, // OnQueryPlayerData -- peer data when client cache stale
  MODIFY_STATUS:        0xf000f501, // OnModifyStatus -- allocate STR/STA/DEX/INT from m_nRemainGP (DPSrvr.cpp:10345)
  // MsgHdr.h:229 -- `CDPSrvr::OnReqLeave` (DPSrvr.cpp:6703). Bodyless; client
  // sends this when the player initiates logout (exit / char-select). Server
  // records `m_dwLeavePenatyTime = now + TIMEWAIT_CLOSE*1000` (idempotent -- only
  // set if 0). The actual teardown fires later via LEAVE/ScheduleDestroy; this
  // opcode only annotates leave intent so the safe-zone / guild-war penalty path
  // can defer disconnect by TIMEWAIT_CLOSE (10s).
  REQ_LEAVE:              0x00ff00fa,
  // MsgHdr.h:515 -- `CDPSrvr::OnEnchant` (DPSrvr.cpp:5735). Universal item-
  // upgrade entry: `DWORD objidTarget, DWORD objidMaterial`. Server dispatches
  // by the *material's* dwItemKind3 (ItemUpgrade.cpp:384): IK3_ENCHANT (Sunstone/
  // orichalcum) -> weapon/armor refine; IK3_ELECARD (element card) -> element.
  ENCHANT:              0xf000b024,

  // ── Phase 1 v19 systems ───────────────────────────────────────────────────
  // MsgHdr.h:179 -- `CDPSrvr::OnRepairItem` (DPSrvr.cpp:4949). Body:
  // `BYTE c (count) | c × BYTE nId (inv slot)`. Cap c ≤ MAX_REPAIRINGITEM(25).
  REPAIRITEM:           0x00ff00b5,
  // MsgHdr.h:299-301 -- 1v1 PvP consent. REQUEST: `u_long uidSrc, u_long uidDst`.
  // YES (accept) same body; NO: `u_long uidSrc` only. Party-duel 0xffffff26-28
  // deferred (ponytail: add with party).
  DUELREQUEST:          0xffffff23,
  DUELYES:              0xffffff24,
  DUELNO:               0xffffff25,
  // MsgHdr.h:144 -- navigator map ping. `CWndNavigator::OnLButtonDown`
  // (WndField.cpp:12123) sends `D3DXVECTOR3 Pos, OBJID objidTarget`: the
  // focused player's objid when one is focused, else NULL_ID (= ping my party).
  SETNAVIPOINT:         0x00ff0018,
  // MsgHdr.h:280-316 -- Party C->S (solo party MVP). Bodies (Neuz/DPClient.cpp
  // :9583-9637): MEMBERREQUEST `u_long uLeaderId, u_long uMemberId, BYTE bTroup`
  // (invite); MEMBERREQUESTCANCLE `u_long uLeader, u_long uMember, int nMode`
  // (reject); ADDPARTYMEMBER accept (leader/member ids re-derived from session);
  // REMOVEPARTYMEMBER `u_long LeaderId, u_long MemberId` (leave/kick);
  // PARTYCHANGELEADER `u_long uLeaderId, u_long uChangerLeaderid`;
  // PARTYCHANGEITEMMODE/EXPMODE `u_long idPlayer, int nMode`; PARTYCHAT
  // `DWORD dpidUser, u_long idParty, String msg`. Party-duel 0xffffff26-28 still deferred.
  MEMBERREQUEST:        0xffffff17,
  MEMBERREQUESTCANCLE:  0xffffff18,
  ADDPARTYMEMBER:       0xffffff11,
  REMOVEPARTYMEMBER:    0xffffff12,
  PARTYCHANGELEADER:    0xffffff2f,
  PARTYCHANGEITEMMODE:  0xffffff20,
  PARTYCHANGEEXPMODE:   0xffffff21,
  PARTYCHAT:            0xffffff59,
  // CHANGETROUP (MsgHdr.h:286) -- "advance to party" (solo -> troupe/guild party).
  // Body (Neuz/DPClient.cpp:9535): `u_long idPlayer, BOOL bSendName[, String szParty]`.
  CHANGETROUP:          0xffffff19,
  // MsgHdr.h:776-779 -- Couple (marriage link) under `__VER >= 13 // __COUPLE_1117`.
  // PROPOSE body: DWORD-prefixed string `szPlayer[42]`. REFUSE/COUPLE/DECOUPLE
  // bodyless (SendHdr). Delegates to CCoupleHelper singleton.
  PROPOSE:              0x8FFFF000,
  REFUSE:               0x8FFFF001,
  COUPLE:               0x8FFFF002,
  DECOUPLE:             0x8FFFF003,
  // MsgHdr.h:361-370 -- Friend roster. REQEST: `u_long uidLeader, u_long uidMember`.
  // NAMEREQEST: `u_long uidLeader` + DWORD-prefixed `szMemberName[64]`.
  // CANCEL/REMOVEFRIEND/GETFRIENDSTATE/SETFRIENDSTATE: see MsgHdr.h:362-367.
  ADDFRIENDREQEST:      0xffffff61,
  ADDFRIENDCANCEL:      0xffffff62,
  ADDFRIENDNAMEREQEST:  0xffffff6b,
  REMOVEFRIEND:         0xffffff6a,
  GETFRIENDSTATE:       0xffffff64,
  SETFRIENDSTATE:       0xffffff67,
  // MsgHdr.h:354 -- friend block toggle. `BYTE nGu` (1=chat, 2=friend, 3=trade)
  // + String szNameTo + String szNameFrom. Core toggles `bBlock` on the friend edge.
  BLOCK:                0xffffff5a,
  // MsgHdr.h:359/365-372 -- friend opcodes that are SERVER->CLIENT despite living
  // in the PACKETTYPE space (they are their own packets, not snapshot blocks).
  // ADDFRIEND (0xffffff60) is the client's accept leg AND, in C++, a core-server
  // relay; here it is client->server only. JOIN/LOGOUT are presence pushes:
  // `u_long idFriend, DWORD dwState, u_long uLogin` / `u_long idFriend`.
  // REMOVEFRIENDSTATE tells the other side its roster shrank: `u_long uRemoveid`.
  ADDFRIEND:            0xffffff60,
  ADDFRIENDJOIN:        0xffffff65,
  ADDFRIENDLOGOUT:      0xffffff66,
  REMOVEFRIENDSTATE:    0xffffff6d,
  // MsgHdr.h:665 -- `CDPSrvr::OnNPCBuff` (DPSrvr.cpp:11242) under `__NPC_BUFF`.
  // Body: DWORD-prefixed string `szKey[64]` -- the character.inc block key of the
  // buff-pang NPC the player right-clicked (`MMI_NPC_BUFF`). Server resolves the
  // block, validates proximity to any spawned buff NPC, and applies its
  // `SetBuffSkill` list (skill id/level/player-level-range/duration) to self.
  NPC_BUFF:             0xf000f813,

  // ── Phase 2 v19 systems ───────────────────────────────────────────────────
  // MsgHdr.h:515-516 -- `CDPSrvr::OnQueryEquip` (DPSrvr.cpp:7128) /
  // `OnQueryEquipSetting` (DPSrvr.cpp:7150). QUERYEQUIP body: `OBJID objid`
  // (the player to inspect). QUERYEQUIPSETTING body: `BOOL bAllow` (4 B) --
  // TRUE clears `EQUIP_DENIAL_MODE`, FALSE sets it, then AddModifyMode.
  QUERYEQUIP:           0xf000d009,
  QUERYEQUIPSETTING:    0xf000d00a,
  // MsgHdr.h:391 -- `CDPSrvr::OnCheering` (DPSrvr.cpp:7068). Body: `OBJID objid`
  // (target player). Spends one of MAX_CHEERPOINT(3) points, turns the cheerer to
  // face the target, plays MTI_CHEERSAME/OTHER, and applies the II_CHEERUP buff.
  CHEERING:             0xffffff7c,
  // MsgHdr.h:154-163 -- Trade (CVTInfo state machine). TRADE/CONFIRMTRADE/
  // CONFIRMTRADECANCEL bodies: `OBJID objidTrader`. TRADEPUT: `BYTE i, BYTE
  // nItemType, BYTE nId, short nItemNum`. TRADEPULL: `BYTE i`. TRADEPUTGOLD:
  // `DWORD dwGold`. TRADECANCEL: `int nMode`. TRADEOK / TRADECONFIRM bodyless.
  // TRADECLEARGOLD is commented out server-side in v19 (kept for the opcode map).
  TRADECONFIRM:         0x00ff002f,
  TRADE:                0x00ff00a0,
  TRADEPUT:             0x00ff00a1,
  TRADEPULL:            0x00ff00a2,
  TRADEOK:              0x00ff00a3,
  TRADECANCEL:          0x00ff00a4,
  TRADEPUTGOLD:         0x00ff00a5,
  TRADECLEARGOLD:       0x00ff00a6,
  CONFIRMTRADE:         0x00ff00a7,
  CONFIRMTRADECANCEL:   0x00ff00a8,
  // MsgHdr.h:821-827 -- Campus (master/pupil mentoring) under `__VER >= 15 //
  // __CAMPUS`. INVITE/ACCEPT/REFUSE bodies: `u_long idTarget` (playerId, NOT
  // objid). REMOVE_MEMBER: `u_long idMember`. ALL/ADD_MEMBER/UPDATE_POINT are
  // DB-server driven -- see campus handlers.
  CAMPUS_ALL:           0x88100120,
  CAMPUS_INVITE:        0x88100121,
  CAMPUS_ACCEPT:        0x88100122,
  CAMPUS_REFUSE:        0x88100123,
  CAMPUS_ADD_MEMBER:    0x88100124,
  CAMPUS_REMOVE_MEMBER: 0x88100125,
  CAMPUS_UPDATE_POINT:  0x88100126,
  // MsgHdr.h:165-170 -- Private shop (vending). PVENDOR is the CVTInfo vendor
  // half, sibling of trade. OPEN: DWORD-prefixed `szPVendor[48]` title.
  // CLOSE: `OBJID objidVendor`. REGISTER_PVENDOR_ITEM: `BYTE iIndex, BYTE nType,
  // BYTE nId, short nNum, int nCost` (nType is wire-only -- server ignores it,
  // echoes 0). UNREGISTER: `BYTE i`. QUERY: `OBJID objidVendor`. BUY:
  // `OBJID objidVendor, BYTE nItem, DWORD dwItemId, short nNum`.
  // Handlers: DPSrvr.cpp:8959,9065,9248,9228,9197,9143.
  PVENDOR_OPEN:            0x00ff00a9,
  PVENDOR_CLOSE:           0x00ff00aa,
  REGISTER_PVENDOR_ITEM:   0x00ff00ab,
  QUERY_PVENDOR_ITEM:      0x00ff00ac,
  BUY_PVENDOR_ITEM:        0x00ff00ad,
  UNREGISTER_PVENDOR_ITEM: 0x00ff00ae,
} as const);

export type PacketType = typeof PACKETTYPE[keyof typeof PACKETTYPE];

/**
 * v19 certifier login error codes -- the `LONG lError` payload of the
 * `PACKETTYPE_ERROR` (0xfe) reply (`_Network/MsgHdr.h:1312-1346`).
 * The client's `OnError` switch (`Neuz/DPCertified.cpp:305-389`) shows a
 * localized message for each; an unmapped code (e.g. our old `0`) shows nothing.
 * 0 (`ERROR_OK`) is a deliberate no-op -- never use it for a real failure.
 */
export const LOGIN_ERROR = Object.freeze({
  WRONG_PASSWORD:        120, // ERROR_FLYFF_PASSWORD -- invalid credentials
  UNKNOWN_ACCOUNT:       121, // ERROR_FLYFF_ACCOUNT
  BLOCKED:               119, // ERROR_BLOCKGOLD_ACCOUNT -- banned / gold-blocked
  THROTTLE_15SEC:        134, // ERROR_15SEC_PREVENT -- login rate limit
  THROTTLE_15MIN:        135, // ERROR_15MIN_PREVENT
  ALREADY_LOGGED_IN:     103, // ERROR_DUPLICATE_ACCOUNT
  ILLEGAL_VERSION:       107, // ERROR_ILLEGAL_VER
  CERT_GENERAL:          136, // ERROR_CERT_GENERAL -- DB/generic failure
} as const);

export type LoginError = typeof LOGIN_ERROR[keyof typeof LOGIN_ERROR];

export const SNAPSHOTTYPE = Object.freeze({
  CHAT:           0x0001,
  ACTMSG:         0x0002,
  // MsgHdr.h:860 -- `CUser::AddMoveItem` (User.cpp:741):
  // `[objid][0x0004][BYTE nItemType][BYTE nSrcIndex][BYTE nDestIndex]`. Echoes
  // a bag slot swap -- the client does NOT swap optimistically; `OnMoveItem`
  // (DPClient.cpp:2141) performs the `m_Inventory.Swap` on receipt.
  MOVEITEM:       0x0004,
  DOEQUIP:        0x0006,
  SETPOS:         0x0010,
  SETLEVEL:       0x0011,
  SETEXPERIENCE:  0x0012,
  DAMAGE:         0x0013,
  UPDATE_MOVER:   0x0017,
  UPDATE_ITEM:    0x0018,
  USESKILL:       0x0019,
  SETDESTPARAM:   0x001c,
  RESETDESTPARAM: 0x001d,
  SETPOINTPARAM:  0x001e,
  GETPOS:         0x001f,
  SETFAME:        0x0040,
  SETSTATE:       0x006a,
  SETSCALE:       0x0039,
  // v19 bank S->C sub-types -- `_Network/MsgHdr.h:956-964` (`CUser::AddPutItemBank`
  // etc.). Bodies confirmed against `WORLDSERVER/User.cpp` at implement time.
  PUTITEMBANK:    0x0050,
  GETITEMBANK:    0x0051,
  PUTGOLDBANK:    0x0052,
  UPDATE_BANKITEM: 0x0054,
  BANKWINDOW:     0x0056,
  // MsgHdr.h:964 -- `CUser::AddconfirmBankPass` (User.cpp:1065):
  // `[objid][0x0058][int nMode][DWORD dwId][DWORD dwItemId]`. nMode 1 = password
  // ok -> bank opens; 0 = wrong password -> re-prompt.
  CONFIRMBANKPASS: 0x0058,
  // MsgHdr.h:963 -- `CUser::AddChangeBankPass` (User.cpp:1054):
  // `[objid][0x0057][int nMode][DWORD dwId][DWORD dwItemId]`. nMode 1 = old
  // password matched, new one saved; 0 = old password wrong -> re-prompt.
  CHANGEBANKPASS:  0x0057,
  // MsgHdr.h:878 -- `CUser::AddOpenShopWnd` (User.cpp:865):
  // `[objid][0x0014][CItemContainer x MAX_VENDOR_INVENTORY_TAB]`. The vendor's
  // 4 shop tabs serialized back-to-back.
  OPENSHOPWND:    0x0014,
  // MsgHdr.h:1033 -- taskbar hotkey grid. Body is `CUserTaskBar::Serialize`
  // (UserTaskBar.cpp:61): `[appletCount][...][itemCount][i,j,6 DWORDs,+chat]
  // [queueCount][...][actionPoint]`. Sent on JOIN so saved F1-F9 bindings
  // (items/skills/emotes/chat macros) repopulate; client `OnTaskBar`
  // (DPClient.cpp:4215) -> `CWndTaskBar::Serialize`.
  TASKBAR:        0x0097,
  // MsgHdr.h:1034 -- `CUserMng::AddMotion` (User.cpp:4392):
  // `[objid][0x0098][DWORD dwMsg]`. Broadcast to the visibility range (incl self)
  // for motion/animation cues. Client `OnMotion` (DPClient.cpp:9813) re-dispatches
  // `dwMsg` as `SendActMsg` -- e.g. OBJMSG_PICKUP(11) plays the pickup anim+sound.
  MOTION:         0x0098,

  // ── Phase 1 v19 systems S->C ──────────────────────────────────────────────
  // MsgHdr.h:946-954, 1010-1011 -- Duel snapshots. DUELREQUEST/DUELSTART/DUELNO/
  // DUELCANCEL to both parties; SETDUEL flips the m_nDuel flag; DUELCOUNT is the
  // ranked win counter.
  DUELREQUEST:    0x0030,
  DUELSTART:      0x0031,
  DUELNO:         0x0032,
  DUELCANCEL:     0x0033,
  SETDUEL:        0x0066,
  DUELCOUNT:      0x0067,
  // MsgHdr.h:1293-1297 -- Couple snapshots. PROPOSE_RESULT is the propose dialog
  // prompt; COUPLE_RESULT confirms the link; DECOUPLE_RESULT confirms the break;
  // ADD_COUPLE_EXPERIENCE is the periodic proximity-exp tick (ponytail).
  COUPLE_PROPOSE_RESULT:  0x9701,
  COUPLE_RESULT:          0x9703,
  DECOUPLE_RESULT:        0x9704,
  ADD_COUPLE_EXPERIENCE:  0x9705,
  // MsgHdr.h:1020-1027 -- Friend roster snapshots. ADDFRIEND (roster insert),
  // ADDFRIENDREQEST (incoming invite dialog), ADDFRIENDCANCEL, ADDGETFRIENDNAME,
  // ADDFRIENDGAMEJOIN (online status ping), REMOVEFRIEND, ADDFRIENDERROR,
  // ADDFRIENDCHANGEJOB. Bodies: `u_long uid + DWORD-prefixed name + state BYTEs`.
  ADDFRIEND:            0x0070,
  ADDFRIEND_SNAPSHOT_REQEST:    0x0071,
  ADDFRIEND_SNAPSHOT_CANCEL:    0x0072,
  ADDGETFRIENDNAME:     0x0073,
  ADDFRIENDGAMEJOIN:    0x0074,
  REMOVEFRIEND_SNAPSHOT: 0x0075,
  ADDFRIENDERROR:       0x0076,
  ADDFRIENDCHANGEJOB:   0x0077,
  // MsgHdr.h:1028-1070 -- Party S->C (solo party MVP). ERRORPARTY error text;
  // PARTYMEMBER full roster (CParty::Serialize body, party.cpp:169-223 -- crash-
  // risk widths, verify vs game/source); PARTYREQEST invite popup; PARTYREQESTCANCEL;
  // PARTYEXP party-level bar; PARTYMEMBERLEVEL member level delta;
  // ADDPARTYCHANGELEADER new-leader notice; PARTYCHAT party chat line;
  // PARTYCHANGEITEMMODE/EXPMODE mode-change echo.
  ERRORPARTY:             0x0081,
  PARTYMEMBER:            0x0082,
  PARTYREQEST:            0x0083,
  PARTYREQESTCANCEL:      0x0084,
  PARTYEXP:               0x0085,
  PARTYMEMBERLEVEL:       0x0087,
  ADDPARTYCHANGELEADER:   0x0079,
  PARTYCHAT:              0x0069,
  PARTYCHANGEITEMMODE:    0x008f,
  PARTYCHANGEEXPMODE:     0x0090,
  // PARTYCHANGETROUP (MsgHdr.h:1046) -- "advanced to troupe" echo. Body
  // (User.cpp:1346 AddPartyChangeTroup): `String szPartyName`. Client sets
  // g_Party.m_nKindTroup=1 on receipt (DPClient.cpp:5340 OnPartyChangeTroup).
  PARTYCHANGETROUP:       0x0088,
  // MsgHdr.h:1121 -- navigator map ping echo. `CUser::AddSetNaviPoint`
  // (User.cpp:2559) body: `D3DXVECTOR3 Pos | String Name`. `objid` (the
  // snapshot record owner) is the PINGER's id, not the recipient's --
  // `CDPClient::OnSetNaviPoint` (DPClient.cpp:15358) keys `m_vOtherPoint` by it.
  SETNAVIPOINT:           0x00c6,

  // ── Phase 2 v19 systems S->C ──────────────────────────────────────────────
  // MsgHdr.h:1084 -- `CUser::AddQueryEquip` (User.cpp:2635), self only:
  // `objid(inspected) | QUERYEQUIP | int cbEquip | cbEquip x { int nParts,
  // __int64 randomOptItemId, CPiercing::Serialize, BYTE bItemResist,
  // int nResistAbilityOption }`. Carries NO item ids -- refinement data only.
  QUERYEQUIP:             0x00ac,
  // MsgHdr.h:1093 -- `CUser::AddSetCheerParam` (User.cpp:2623), self only:
  // `objid | SETCHEERPARAM | int nCheerPoint | DWORD dwRest | BOOL bAdd`.
  SETCHEERPARAM:          0x00b4,
  // MsgHdr.h:900 -- `CUserMng::AddCreateSfxObj` (User.cpp:5012), vicinity:
  // `objid | CREATESFXOBJ | DWORD dwSfxObj | float x | float y | float z |
  // BOOL bFlag`. The 3-arg overload passes x=y=z=0.
  CREATESFXOBJ:           0x000f,
  // MsgHdr.h:1058 -- `CUser::AddDefinedText(int dwText)` (User.cpp:2246), self:
  // `objid | DEFINEDTEXT1 | int dwText`. The no-format-args sibling of
  // DEFINEDTEXT (0x0095) -- NO trailing string. Emitting the string form for an
  // arg-less text shifts the client's read by a DWORD.
  DEFINEDTEXT1:           0x0094,
  // MsgHdr.h:890-939 -- Trade snapshots (see trade serializers for bodies).
  TRADEPUTERROR:          0x0005,
  TRADE_SNAPSHOT:         0x0007,
  TRADEPUT:               0x0008,
  TRADEPULL:              0x0009,
  TRADEOK:                0x000a,
  TRADECANCEL:            0x000b,
  TRADECONSENT:           0x000c,
  TRADEPUTGOLD:           0x0020,
  TRADECLEARGOLD:         0x0021,
  CONFIRMTRADE:           0x0022,
  CONFIRMTRADECANCEL:     0x0023,
  TRADELASTCONFIRM:       0x002b,
  TRADELASTCONFIRMOK:     0x002c,
  // MsgHdr.h:1324-1327 -- Campus snapshots. INVITE is the invite popup
  // (`u_long idRequest` + name); UPDATE ships a whole CCampus; REMOVE drops a
  // member; UPDATE_POINT is the campus-point delta.
  CAMPUS_INVITE:          0x8830,
  CAMPUS_UPDATE:          0x8831,
  CAMPUS_REMOVE:          0x8832,
  CAMPUS_UPDATE_POINT:    0x8833,
  // MsgHdr.h:906-907,966-971 -- Private shop (vending) snapshots.
  // PVENDOR_OPEN (0x0042) vicinity: `String title`. PVENDOR_CLOSE (0x0043):
  // `BYTE byClearTitle` (1=vendor closed own shop, 0=buyer closed their view).
  // REGISTER_PVENDOR_ITEM (0x0044) self: `BYTE iIndex, BYTE nType, BYTE nId,
  // short nNum, int nCost`. PVENDOR_ITEM (0x0045) buyer: full shop window --
  // `BYTE count` then per slot `BYTE iIndex, CItemElem blob, short nExtra, int
  // nCost`, then `BYTE bState`. PVENDOR_ITEM_NUM (0x0046) vendor+browsers:
  // `BYTE nItem, short nVend, String sBuyer`. UNREGISTER (0x0047) self: `BYTE i`.
  PVENDOR_OPEN:            0x0042,
  PVENDOR_CLOSE:           0x0043,
  REGISTER_PVENDOR_ITEM:   0x0044,
  PVENDOR_ITEM:            0x0045,
  PVENDOR_ITEM_NUM:        0x0046,
  UNREGISTER_PVENDOR_ITEM: 0x0047,
} as const);

export type SnapshotType = typeof SNAPSHOTTYPE[keyof typeof SNAPSHOTTYPE];

export function lookupPacketType(value: number): string | undefined {
  for (const [key, val] of Object.entries(PACKETTYPE)) {
    if (val === value) return key;
  }
  return undefined;
}

export function lookupSnapshotType(value: number): string | undefined {
  for (const [key, val] of Object.entries(SNAPSHOTTYPE)) {
    if (val === value) return key;
  }
  return undefined;
}
