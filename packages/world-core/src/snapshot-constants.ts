/**
 * C++ serializer constants for the player self-spawn (JOIN/SNAPSHOT/ADD_OBJ)
 * blob -- `__VER 15`, all version-gated fields active.
 *
 * Sourced from `game/source/`:
 *   MAX_HUMAN_PARTS   resource/defineNeuz.h:62
 *   MAX_JOB           resource/defineJob.h:91
 *   MAX_SKILL_JOB     _Common/Mover.h:96  (= 3+20+20+1+1, defineJob.h:12-17)
 *   SM_MAX            _Network/CmnHdr.h:504  (enum terminator, 26 members)
 *   MAX_HONOR_TITLE   _Common/ProjectCmn.h:38
 *   MAX_INVENTORY/MAX_BANK  _Common/ProjectCmn.h:7,9
 *   sizeof(SKILL)=8   _Common/Item.h:308   (DWORD dwSkill + DWORD dwLevel)
 *   sizeof(QUEST)=12  _Common/Mover.h:260  (MSVC x86 default alignment)
 *
 * @module net/snapshot/constants
 */

export const SNAPSHOTTYPE_ADD_OBJ = 0x00f0;

/**
 * `SNAPSHOTTYPE_WORLD_READINFO` (`_Network/MsgHdr.h:1278`). Under `__MAP_SECURITY`
 * (defined in both Neuz/VersionCommon.h:172 and WORLDSERVER/VersionCommon.h:178),
 * `CUser::Open` emits this sub-record BEFORE `ADD_OBJ` (`User.cpp:317`). The
 * client's `OnWorldReadInfo` (`DPClient.cpp:18606`) calls `g_WorldMng.Open(dwWorldId)`
 * -- the ONLY place `g_pWorld` is set in the JOIN flow. Omit it and `OnAddObj`
 * -> `OpenField` derefs a null `CWorld` -> `VecInWorld this==nullptr` crash.
 */
export const SNAPSHOTTYPE_WORLD_READINFO = 0x9910;

/** Numeric world ID -> which `.wld` the client loads. Resource/defineWorld.h:5. */
export const WI_WORLD_MADRIGAL = 1;

/** CObj method: full self-data (METHOD_NONE) vs peer/NPC (METHOD_EXCLUDE_ITEM). */
export const METHOD_NONE = 0;
export const METHOD_EXCLUDE_ITEM = 1;

// --- ADD_OBJ prefix values (locked vs C++ source) ---------------------------
// OT_ enum is sequential from 0: OT_OBJ=0, OT_ANI=1, OT_CTRL=2, OT_SFX=3,
// OT_ITEM=4, OT_MOVER=5, OT_REGION=6, OT_SHIP=7. Proven by the filter array
// indexed by dwType in _Common/World3D.cpp:23 (ObjTypeToObjFilter) + the
// m_apObject[nType] indexing in _Common/lod.cpp:1544-1547. Written at
// WORLDSERVER/User.cpp:669 as `(BYTE)pCtrl->GetType()`.
export const OT_MOVER = 5;
// Player model index = propMover row. _Database/DbManager.cpp:187 sets dwIndex
// by sex; loaded world-side at WORLDSERVER/DPDatabaseClient.cpp:721. Numeric
// values in resource/defineObj.h:962-963, cross-verified vs propMover.txt:4-5.
export const MI_MALE = 11;
export const MI_FEMALE = 12;

// --- Monster model indices (resource/defineObj.h) ---------------------------
// Real propMover row indices the client resolves via prj.GetMover(dwIndex).
// Used as dwObjIndex/m_dwIndex on the NPC ADD_OBJ path so Neuz renders the
// actual monster model. Add more as spawn coverage widens.
export const MI_SMALL_MUSHPOIE = 168;   // defineObj.h:1161 -- small mushpang, Flaris area

/**
 * `BELLI_PEACEFUL` -- `game/resource/defineAttribute.h:203` defines it as 1.
 * Sent as the `m_dwBelligerence` BYTE in the CMover::Serialize prefix
 * (`game/source/_Common/ObjSerializeOpt.cpp:109`). The value is NOT arbitrary:
 * the client's `IsPeaceful()` (`Mover.h:1090`) and minimap classify
 * (`WndField.cpp:9338`) compare `m_dwBelligerence == BELLI_PEACEFUL`, and
 * `IsAttackAbleNPC` (`Mover.cpp:8991`) suppresses the attack cursor when it
 * holds. Sending 0 makes peaceful NPCs attackable + red on the minimap.
 */
export const BELLI_PEACEFUL = 1;

// --- Raw struct / array sizes (bytes) ---------------------------------------
// Slot-sizing consts (NULL_ID, INVENTORY_SLOTS, BANK_SLOTS, MAX_HUMAN_PARTS,
// MAX_SKILL_JOB, MAX_INVENTORY, MAX_BANK, MAX_BANK_TABS, MAX_SLOT_ITEM_*,
// SHORTCUT) moved to @flyff/entities -- re-exported at the bottom of this file.
// v19 (`__3RD_LEGEND16` + `__VER 19`): MAX_JOB = MAX_HERO(32) + 8 legend-hero
// jobs = 40 (`resource/defineJob.h:145`). v15 pre-legend was 32 -- using that
// here under-sizes the `dwJobLv` array by 8 DWORDs and shifts every subsequent
// CMover field, crashing the client in `CItemContainer::Serialize` (Item.h:938).
export const MAX_JOB = 40;
export const SKILL_SIZE = 8;            // sizeof(SKILL)
export const SM_MAX = 26;
export const MAX_HONOR_TITLE = 150;
export const MAX_POCKET_TABS = 3;
export const QUEST_SIZE = 12;           // sizeof(QUEST)

/**
 * Live slot counts (`INVENTORY_SLOTS` = 73, `BANK_SLOTS` = 42) now live in
 * `@flyff/entities` -- re-exported at the bottom of this file. See there for
 * the `CItemContainer` sizing rationale (desync crash if bag written as 42).
 */

/**
 * Vendor shop container widths -- `_Common/ProjectCmn.h:21-22`. Each NPC shop
 * tab is `CItemContainer<CItemElem>` sized via `SetItemContainer(ITYPE_ITEM,
 * MAX_VENDOR_INVENTORY)` (`_Common/Mover.cpp:8415`), so `m_dwItemMax = 100`.
 * `AddOpenShopWnd` (User.cpp:865) always serializes MAX_VENDOR_INVENTORY_TAB(4)
 * tabs back-to-back; the client drains exactly 4 (DPClient.cpp:2789).
 */
export const MAX_VENDOR_INVENTORY = 100;
export const MAX_VENDOR_INVENTORY_TAB = 4;

/** Wire bytes of an empty CItemContainer<CItemElem> with `slots` slots. */
export function emptyItemContainerSize(slots: number): number {
  return 4 * slots + 1 + 4 * slots; // m_apIndex[] + chSize + adwObjIndex[]
}

// --- Peer-broadcast snapshot sub-types (S->C) --------------------------------
// `_Network/MsgHdr.h` -- all typed `(WORD)`, written as 2 bytes on the wire
// (mirrors the working JOIN serializer's `writeWord(SNAPSHOTTYPE_*)`).
export const SNAPSHOTTYPE_SETPOS = 0x0010;           // MsgHdr.h:874 -- same-world teleport (AddSetPos)
export const SNAPSHOTTYPE_DESTPOS = 0x00c1;          // MsgHdr.h:1086 -- click-to-move echo
export const SNAPSHOTTYPE_MOVERSETDESTOBJ = 0x00c2;  // MsgHdr.h:1087 -- PLAYERSETDESTOBJ echo
export const SNAPSHOTTYPE_GETDESTOBJ = 0x004a;       // MsgHdr.h:947 -- AddGetDestObj query reply (dest objid + fRange)
export const SNAPSHOTTYPE_MOVERMOVED = 0x00ca;       // MsgHdr.h:1095 -- 60B movement frame
export const SNAPSHOTTYPE_MOVERBEHAVIOR = 0x00cb;    // MsgHdr.h:1096 -- 60B motion frame (same body)
export const SNAPSHOTTYPE_QUERY_PLAYER_DATA = 0x0141; // MsgHdr.h:1195
// Added for the remaining v19 C->S handlers (DPSrvr.cpp MsgHdr.h):
export const SNAPSHOTTYPE_CHAT_OUT = 0x00bc;         // MsgHdr.h:1078 -- CHATTEXT (defined-text echo)
export const SNAPSHOTTYPE_MOTION = 0x0098;           // MsgHdr.h:1034 -- MOTION echo
export const SNAPSHOTTYPE_ENDSKILLQUEUE = 0x00e5;   // MsgHdr.h:1115 -- AddHdr(self) bodyless ack (taskbar cancels queued skill)
export const SNAPSHOTTYPE_SETACTIONPOINT = 0x00c5; // MsgHdr.h:1090 -- AddSetActionPoint(self, int nAP)
export const SNAPSHOTTYPE_MELEE_ATTACK = 0x00e0;     // MsgHdr.h:1110 -- MELEE_ATTACK swing echo
export const SNAPSHOTTYPE_RANGE_ATTACK = 0x00e2;    // MsgHdr.h:1112 -- RANGE_ATTACK projectile swing echo
export const SNAPSHOTTYPE_MOVERCORR = 0x00c8;        // MsgHdr.h:1093 -- PLAYERCORR echo (60B body)
export const SNAPSHOTTYPE_MOVERMOVED2 = 0x00cc;      // MsgHdr.h:1097 -- PLAYERMOVED2 echo (73B body)

// --- Combat S->C snapshot sub-types (`_Network/MsgHdr.h`) ----------------------
// DAMAGE is the per-mover HP-sync mechanism (all nearby clients decrement HP
// identically). MOVERDEATH zeroes + removes. SETEXPERIENCE is self-only;
// SETLEVEL broadcasts to vicinity but skips self (self gets level via exp).
export const SNAPSHOTTYPE_DAMAGE = 0x0013;           // MsgHdr.h -- AddDamage vicinity HP sync
export const SNAPSHOTTYPE_SETEXPERIENCE = 0x0012;    // MsgHdr.h -- AddSetExperience self-only
export const SNAPSHOTTYPE_SETLEVEL = 0x0011;         // MsgHdr.h -- AddSetLevel vicinity (skips self)
export const SNAPSHOTTYPE_MOVERDEATH = 0x00c7;       // MsgHdr.h -- AddMoverDeath vicinity
export const SNAPSHOTTYPE_SETPOINTPARAM = 0x001e;    // MsgHdr.h -- AddSetPointParam: int param(DST_*) | int value
/**
 * `SNAPSHOTTYPE_SETSTATE` (MsgHdr.h:986) -- `CUser::AddSetState`
 * (`WORLDSERVER/User.cpp:2407`): `OBJID | SETSTATE | nStr:DWORD | nSta:DWORD |
 * nDex:DWORD | nInt:DWORD | nRemainLP:DWORD(0) | nRemainGP:DWORD`. Self-only,
 * sent after a stat allocation (`OnModifyStatus`) so the client refreshes its
 * stat window + recomputes derived HP/MP/FP (DPClient.cpp:13376 OnSetState).
 */
export const SNAPSHOTTYPE_SETSTATE = 0x006a;

// --- Skill S->C snapshot sub-types (`_Network/MsgHdr.h`) -----------------------
// USESKILL (MsgHdr.h:884) -- `CUserMng::AddUseSkill` (User.cpp:4501):
// `OBJID | USESKILL | DWORD dwSkill | DWORD dwLevel | DWORD target | int nUseType |
// int nCastingTime`. Vicinity INCL caster (caster needs it to drive the cast bar).
// CLEAR_USESKILL (MsgHdr.h:885) -- header-only `OBJID | CLEAR_USESKILL`, self only:
// tells the client a cast was rejected so it cancels the predicted animation.
// SETSKILLLEVEL (MsgHdr.h:942) -- per-skill level delta, vicinity excl caster.
// DOUSESKILLPOINT (MsgHdr.h:996) -- learn/SP confirm, self only:
// `OBJID | DOUSESKILLPOINT | 45x(DWORD dwSkill,DWORD dwLevel) | int nSkillPoint`.
export const SNAPSHOTTYPE_USESKILL = 0x0019;         // MsgHdr.h:884 -- AddUseSkill (cast start, incl caster)
export const SNAPSHOTTYPE_CLEAR_USESKILL = 0x001a;   // MsgHdr.h:885 -- AddClearUseSkill (cast rejected, self)
export const SNAPSHOTTYPE_SETSKILLLEVEL = 0x0026;    // MsgHdr.h:942 -- AddSetSkillLevel (peer skill-level delta)
export const SNAPSHOTTYPE_DOUSESKILLPOINT = 0x007d;  // MsgHdr.h:996 -- AddDoUseSkillPoint (learn/SP confirm, self)
/**
 * Skill-buff S->C snapshots (`_Network/MsgHdr.h`):
 * - SETSKILLSTATE (0x004c) -- `CUserMng::AddSetSkillState` (User.cpp:5672):
 *   `OBJID | SETSKILLSTATE | WORD wType | WORD wID | DWORD dwLevel | DWORD dwTime`.
 *   Broadcast to vicinity on buff attach/refresh -- the client adds the buff
 *   icon + timer (DPClient.cpp:14233 OnSetSkillState). Does NOT carry the DST
 *   delta; the stat change rides a separate SETDESTPARAM (future slice).
 * - REMOVESKILLINFULENCE (0x00f8) -- `CUser::AddRemoveSkillInfluence`
 *   (User.cpp:1025): `OBJID | REMOVESKILLINFULENCE | WORD wType | WORD wID`.
 *   Broadcast on buff expire/remove -- client drops the icon.
 */
export const SNAPSHOTTYPE_SETSKILLSTATE = 0x004c;        // MsgHdr.h -- AddSetSkillState (buff attach/refresh)
export const SNAPSHOTTYPE_REMOVESKILLINFULENCE = 0x00f8; // MsgHdr.h -- AddRemoveSkillInfluence (buff expire/remove)
/**
 * DST delta S->C snapshots (`_Network/MsgHdr.h`):
 * - SETDESTPARAM (0x001c) -- `CUserMng::AddSetDestParam` (User.cpp:4651):
 *   `OBJID | SETDESTPARAM | int nDstParameter | int nAdjParameterValue | int nChgParameterValue`.
 *   Broadcast when a DST modifier is applied (equip/buff/item). Carries the delta
 *   (adj/chg being added), NOT the new total -- the client maintains its own
 *   adj/chg pool mirroring the server's, and reads its own total for display.
 *   `nChgParameterValue = 0x7FFFFFFF` (CHG_SENTINEL) means "no override".
 * - RESETDESTPARAM (0x001d) -- `CUserMng::AddResetDestParam` (User.cpp:4663):
 *   `OBJID | RESETDESTPARAM | int nDstParameter | int nAdjParameterValue`.
 *   Broadcast when a DST modifier is reversed (buff expire/unequip).
 */
export const SNAPSHOTTYPE_SETDESTPARAM = 0x001c;   // MsgHdr.h -- AddSetDestParam (DST apply delta)
export const SNAPSHOTTYPE_RESETDESTPARAM = 0x001d; // MsgHdr.h -- AddResetDestParam (DST reverse delta)
/**
 * `SNAPSHOTTYPE_MODIFYMODE` (MsgHdr.h:1105) -- `CUserMng::AddModifyMode`
 * (User.cpp:5096): `OBJID | MODIFYMODE | m_dwMode:DWORD`. Broadcast to vicinity
 * on any `m_dwMode` bit flip so peers re-render the mover (transparency,
 * undying glow, etc.). Body is one DWORD -- the full new mode bitmask.
 */
export const SNAPSHOTTYPE_MODIFYMODE = 0x00d3;       // MsgHdr.h:1105 -- AddModifyMode

/**
 * `SNAPSHOTTYPE_DISGUISE` / `NODISGUISE` (MsgHdr.h:1133-1134) --
 * `CUserMng::AddDisguise/AddNoDisguise` (User.cpp:4455/4466). DISGUISE body is
 * one DWORD (the propMover index to render as); NODISGUISE is bodyless. The
 * disguised player renders as that mover model until cleared.
 */
export const SNAPSHOTTYPE_DISGUISE = 0x00f5;          // MsgHdr.h:1133 -- AddDisguise (dwMoverIdx:DWORD)
export const SNAPSHOTTYPE_NODISGUISE = 0x00f6;        // MsgHdr.h:1134 -- AddNoDisguise (bodyless)

// --- Revival S->C confirm snapshots (`_Network/MsgHdr.h:1044-1046`) -----------
// `CUserMng::AddRevival`-style confirm -- body is just `OBJID objid + WORD wHdr`
// (the AddHdr prefix); no per-type fields. Broadcast to vicinity (peers see the
// revive). Client `CDPClient::OnRevival/OnRevivalLodestar/OnRevivalLodelight`
// (DPClient.cpp:3384/3418/3449) calls `ClearState()` + applies client-local
// HP/MP/FP restore from the follow-up SETEXPERIENCE/SETPOINTPARAM frames.
export const SNAPSHOTTYPE_REVIVAL = 0x00a1;              // MsgHdr.h:1044 -- scroll (in-place) revive
export const SNAPSHOTTYPE_REVIVAL_TO_LODESTAR = 0x00a2;  // MsgHdr.h:1045 -- town (lodestar) revive
export const SNAPSHOTTYPE_REVIVAL_TO_LODELIGHT = 0x00a3; // MsgHdr.h:1046 -- lodelight (unused -- C++ stub)

// --- Ground-item S->C snapshot sub-types (`_Network/MsgHdr.h`) -----------------
// OT_ITEM=4 is the CObj type for ground `CItem` (CreateObj.cpp:618). DEL_OBJ
// (MsgHdr.h:1128) is bodyless: `User::AddRemoveObj(objid)` -> `AddHdr(objid, DEL_OBJ)`.
export const OT_ITEM = 4;
export const SNAPSHOTTYPE_DEL_OBJ = 0x00f1;          // MsgHdr.h:1128 -- AddRemoveObj (bodyless)

/**
 * `SNAPSHOTTYPE_CREATEITEM` (0x0003, MsgHdr.h:859) -- `CUser::AddCreateItem`
 * (User.cpp:727). Notifies the client that N inventory slots now hold a new
 * item. One pItemBase body (CItemBase 20B + CItemElem 55B -- same fields as the
 * OT_ITEM ground item, MINUS the CObj/CCtrl frame) followed by a per-slot
 * `[BYTE nCount][BYTE*nCount slotIds][short*nCount counts]` trailer. Used by
 * the pickup path (Phase E) to place looted items into the bag.
 *
 * `UPDATE_ITEM` (0x0018) is the count-only delta on an EXISTING slot; not
 * needed until moveitem/split ship.
 */
export const SNAPSHOTTYPE_CREATEITEM = 0x0003;

// --- Chat-family S->C snapshot sub-types (`_Network/msghdr.h`) ----------------
// All `CUser::Add*` per-user snapshots: `OBJID | WORD type | payload`, wrapped
// once in PACKETTYPE_SNAPSHOT. Mirrors the single-snapshot flush the other
// peer-broadcast serializers use.
export const SNAPSHOTTYPE_CHAT = 0x0001;              // msghdr.h:733  -- AddChat vicinity chat (objid + text only)
export const SNAPSHOTTYPE_TEXT = 0x00a0;              // msghdr.h:877  -- AddText per-user color text (notice/system)
export const SNAPSHOTTYPE_RETURNSAY = 0x00a9;         // msghdr.h:885  -- AddReturnSay whisper error reply
export const SNAPSHOTTYPE_SHOUT = 0x00d0;             // msghdr.h:923  -- AddShout server-wide shout
export const SNAPSHOTTYPE_REPLACE = 0x00f2;           // msghdr.h:948  -- AddReplace teleport notify

// --- Quest S->C snapshot sub-types (`_Network/msghdr.h`) -----------------------
// All `CUser::Add*Quest*` per-user snapshots: `OBJID | WORD subtype | payload`,
// wrapped once in PACKETTYPE_SNAPSHOT. SETQUEST blits the 12-byte QUEST struct
// raw (`User.cpp:1826`); see quest.serializer.ts for the field layout.
export const SNAPSHOTTYPE_SETQUEST = 0x00b0;          // msghdr.h:784 -- AddSetQuest (12B QUEST blit)
export const SNAPSHOTTYPE_QUEST_REMOVE = 0x003a;      // msghdr.h:892 -- AddCancelQuest/AddRemoveQuest...
export const SNAPSHOTTYPE_QUEST_TEXT_TIME = 0x00ba;   // msghdr.h:906 -- AddQuestTextTime
export const SNAPSHOTTYPE_QUESTHELPER_NPCPOS = 0x9400; // msghdr.h:1040 -- AddNPCPos (D3DVECTOR)
export const SNAPSHOTTYPE_QUEST_CHECKED = 0x8820;     // msghdr.h:1065 -- AddCheckedQuest

// --- NPC dialog menu S->C (`_Network/MsgHdr.h`) --------------------------------
// `CUser::AddRunScriptFunc` (User.cpp:6259) queues one RUNSCRIPTFUNC entry per
// `Say`/`AddKey`/`Exit` the dialog script emits; they flush inside a single
// PACKETTYPE_SNAPSHOT frame and are applied client-side by `CDPClient::OnRunScriptFunc`
// (Neuz/DPClient.cpp:14127) to the `CWndDialog` the client opened on click
// (`_Interface/WndWorld.cpp:5163`). There is no separate "open" packet.
export const SNAPSHOTTYPE_RUNSCRIPTFUNC = 0x0024;   // MsgHdr.h:898
// FUNCTYPE_* (MsgHdr.h:1387-1409) -- the per-op WORD after the snapshot type.
export const FUNCTYPE_ADDKEY = 0x0010;              // MsgHdr.h:1387 -- String word, String key, DWORD param, DWORD quest
export const FUNCTYPE_REMOVEKEY = 0x0011;           // MsgHdr.h:1388 -- String key
export const FUNCTYPE_SAY = 0x0012;                 // MsgHdr.h:1389 -- String text, DWORD quest
export const FUNCTYPE_ADDANSWER = 0x0013;           // MsgHdr.h:1390 -- String word, String key, DWORD param, DWORD quest
export const FUNCTYPE_EXIT = 0x0016;                // MsgHdr.h:1393 -- (no payload)
export const FUNCTYPE_ENDSAY = 0x0017;              // MsgHdr.h:1394 -- (no payload)
export const FUNCTYPE_REMOVEALLKEY = 0x001d;        // MsgHdr.h:1400 -- (no payload)

/** Default shout color `0xffff99cc` (TextCmd_shout, FuncTextCmd.cpp:1551). */
export const SHOUT_COLOR_DEFAULT = 0xffff99cc;
/** Default notice/system text color (yellow). */
export const TEXT_COLOR_NOTICE = 0xffffff00;

/**
 * `OnText` state BYTE -- written by `CUser::AddText` only when `__S_SERVER_UNIFY`
 * is defined (`game/source/WORLDSERVER/User.cpp:681-683`). The build defines it,
 * so the client's `OnText` reads `BYTE nState` before the string. Omit it and the
 * string-length DWORD shifts by one byte -> garbled text -> silent drop.
 */
export const TEXT_GENERAL = 0x01; // PutString (normal notice)
export const TEXT_DIAG = 0x02;    // OpenMessageBoxUpper (modal)

// NULL_ID moved to @flyff/entities -- re-exported at bottom.

/**
 * Anti-loot-steal FFA window. A dropped pile is locked to its owner (the
 * first-hitter / killer) for this long; afterwards anyone may loot it.
 * Ports `CMover::IsLoot` (`_Common/MoverActEvent.cpp:2234`): after `SEC(7)`
 * since `m_dwDropTime` the pile goes free-for-all. (Pre-`__S_9` builds used
 * 40 s; v19 ships the 7 s gate.)
 */
export const LOOT_FFA_MS = 7_000;

// --- SetPointParam S->C (`_Network/MsgHdr.h` / `resource/defineAttribute.h`) ----
// Generic per-mover stat update: `objid | SETPOINTPARAM | paramId:DWORD | value:DWORD`
// (`CUserMng::AddSetPointParam`, User.cpp:3169). `CMover::AddGold` (Mover.cpp:638)
// notifies the client of a gold-balance change via AddSetPointParam(self, DST_GOLD, total).
// (SNAPSHOTTYPE_SETPOINTPARAM is defined with the combat snapshots above.)
export const DST_GOLD = 10000;                       // defineAttribute.h:352

// --- Taskbar hotkey grid (MAX_SLOT_ITEM_*, SHORTCUT, MAX_SHORTCUT_*) ----------
// Moved to @flyff/entities -- re-exported at bottom. See entities/constants/slots.ts.

/**
 * Circular ground-plane broadcast radius approximating the v19 `CLinkMap`
 * visibility grid (`LinkMap.cpp:66`): standard outdoor zone `nView=1`, 64-unit
 * cells, 2-cell range => 256*256 broadcast box (128 half-extent per axis). A
 * circle that covers that box needs r >= 128sqrt2 ~= 181; 200 rounds up to guarantee
 * no in-box peer is missed (slight overshoot at the diagonals is harmless --
 * extra writes to peers who can't yet render the mover, never a client crash).
 *
 * ponytail: `ZoneManager.broadcastAround` uses a circle, C++ uses a box; swap
 * to a box check if peer pop-in/desync shows up under real load.
 */
export const VISIBILITY_RADIUS = 200;

// --- Slot sizing + taskbar consts (moved to @flyff/entities) -----------------
// Re-exported here so legacy `from './constants'` / `from '../net/snapshot/constants'`
// importers keep resolving during the package split. New code: import from @flyff/entities.
export {
  NULL_ID, MAX_HUMAN_PARTS, MAX_SKILL_JOB, MAX_INVENTORY, MAX_BANK, MAX_BANK_TABS,
  INVENTORY_SLOTS, BANK_SLOTS, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SLOT_QUEUE,
  MAX_SHORTCUT_STRING, SHORTCUT, MAX_SHORTCUT_CHAT,
} from '@flyff/entities';
