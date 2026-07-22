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
  // v15 learn skills -- `DPSrvr::OnDoUseSkillPoint` (DPSrvr.cpp:3265). Body is
  // 45x (DWORD dwSkill, DWORD dwLevel) -- the player's desired job-skill roster,
  // one entry per m_aJobSkill slot. Atomic all-or-nothing server-side.
  DOUSESKILLPOINT:      0x000f0003,
  DOUSEITEM:            0x00ff0021,
  SETTARGET:            0x00ff0023,
  REVIVAL:              0x00ff00c0,
  // v15 client -> world revival opcodes (DPSrvr.cpp:960/1061/1188). All three
  // handlers read ZERO body fields -- the opcode alone selects the branch
  // (`SendHdr` on the client side). OnRevival=scroll, OnRevivalLodestar=town,
  // OnRevivalLodelight=empty C++ stub.
  REVIVAL_TO_LODESTAR:  0x00ff00c1,
  REVIVAL_TO_LODELIGHT: 0x00ff00c2,
  WHISPER:              0x00ff00d4,
  SAY:                  0x00ff00e0,
  SHOUT:                0x00ff00e1,
  DEFINEDTEXT:          0x00ff00ec,
  SCRIPTDLG:            0x00ff00b0,
  // v15 NPC shop window -- `WORLDSERVER/DPSrvr.cpp:149-150`. OnOpenShopWnd:2744
  // reads `OBJID objid` (the vendor NPC); OnCloseShopWnd:2793 is bodyless. Open
  // validates the vendor is a trade NPC + sets the player's interacting-other;
  // ack is SNAPSHOTTYPE_OPENSHOPWND with the vendor's `m_ShopInventory`.
  OPENSHOPWND:          0x00ff00b1,
  CLOSESHOPWND:         0x00ff00b2,
  BUYITEM:              0x00ff00b3,
  SELLITEM:             0x00ff00b4,
  // v15 bank window -- `WORLDSERVER/DPSrvr.cpp:152-167`. OPENBANKWND dwId=NULL_ID
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
  // v15 bank password confirm -- `WORLDSERVER/DPSrvr.cpp:167` OnConfirmBank:3991.
  // Body: `String szPass(10), DWORD dwId, DWORD dwItemId`. Ack is
  // SNAPSHOTTYPE_CONFIRMBANKPASS with nMode 1 (open) / 0 (re-prompt). Fires when
  // OPENBANKWND sent nMode=1 (bank has a password set).
  CONFIRMBANK:          0xffffff48,
  // v15 taskbar hotkey binding -- `WORLDSERVER/DPSrvr.cpp:2203/2251`.
  // OnAddItemTaskBar: `BYTE nSlotIndex, BYTE nIndex, DWORD dwShortcut, DWORD
  // dwId, DWORD dwType, DWORD dwIndex, DWORD dwUserId, DWORD dwData` (+ String
  // szString when dwShortcut==SHORTCUT_CHAT). OnRemoveItemTaskBar: `BYTE nSlotIndex,
  // BYTE nIndex`. Server stores the binding into m_playTaskBar.m_aSlotItem in
  // memory (no DB write in the C++ handler). Rejected paths send nothing.
  ADDITEMTASKBAR:        0xffffff0c,
  REMOVEITEMTASKBAR:     0xffffff0d,
  // v15 client -> world quest handlers (`WORLDSERVER/DPSrvr.cpp`, msghdr.h)
  REMOVEQUEST:          0x00ff0026, // OnRemoveQuest -- DWORD dwQuestCancelID
  QUESTHELPER_REQNPCPOS: 0x70005000, // OnReqQuestNPCPos -- String szCharKey
  QUEST_CHECK:          0x88100110, // OnCheckedQuest -- int nQuestId, BOOL bCheck

  REPLACE:              0x00ff0f00,
  SETQUEST:             0x00ff0ff3,
  SCRIPT_CREATE_ITEM:   0x00ff0ff4,
  SCRIPT_ADD_GOLD:      0x00ff0ff5,

  SNAPSHOT:             0xffffff00,
  PLAYERMOVED:          0xffffff01,
  PLAYERBEHAVIOR:       0xffffff02,
  PLAYERMOVED2:         0xffffff03,
  PLAYERCORR:           0xffffff05,
  PLAYERSETDESTOBJ:     0xffffff07,
  MOVERDESTPOS:         0xffffff0f,
  PLAYERANGLE:          0xffffff29,
  QUERYGETPOS:          0xffffff08,
  GETPOS:               0xffffff09,
  // v15 `WORLDSERVER/DPSrvr.cpp:1355` OnQueryGetDestObj -- OBJID objid. Client
  // polls a mover's walk-to-object destination (~3*/s) to sync pathfinding.
  QUERYGETDESTOBJ:      0xffffff72,

  GUILD:                0xffffff30,

  // v15 client -> world -- `WORLDSERVER/DPSrvr.cpp` handlers.
  MAP_KEY:              0xfffff000, // OnMapKey -- per-.wld checksum as client loads the world
  QUERY_PLAYER_DATA:    0xf000f802, // OnQueryPlayerData -- peer data when client cache stale
  MODIFY_STATUS:        0xf000f501, // OnModifyStatus -- allocate STR/STA/DEX/INT from m_nRemainGP (DPSrvr.cpp:10345)
} as const);

export type PacketType = typeof PACKETTYPE[keyof typeof PACKETTYPE];

/**
 * v15 certifier login error codes -- the `LONG lError` payload of the
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
  // v15 bank S->C sub-types -- `_Network/MsgHdr.h:956-964` (`CUser::AddPutItemBank`
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
