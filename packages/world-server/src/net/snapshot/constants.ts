/**
 * C++ serializer constants for the player self-spawn (JOIN/SNAPSHOT/ADD_OBJ)
 * blob — `__VER 15`, all version-gated fields active.
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
 * — the ONLY place `g_pWorld` is set in the JOIN flow. Omit it and `OnAddObj`
 * → `OpenField` derefs a null `CWorld` → `VecInWorld this==nullptr` crash.
 */
export const SNAPSHOTTYPE_WORLD_READINFO = 0x9910;

/** Numeric world ID → which `.wld` the client loads. Resource/defineWorld.h:5. */
export const WI_WORLD_MADRIGAL = 1;

/** CObj method: full self-data (vs METHOD_EXCLUDE_ITEM for other players). */
export const METHOD_NONE = 0;

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

// --- Raw struct / array sizes (bytes) ---------------------------------------
export const MAX_HUMAN_PARTS = 31;
export const MAX_JOB = 32;
export const MAX_SKILL_JOB = 45;
export const SKILL_SIZE = 8;            // sizeof(SKILL)
export const SM_MAX = 26;
export const MAX_HONOR_TITLE = 150;
export const MAX_INVENTORY = 42;
export const MAX_BANK = 42;
export const MAX_BANK_TABS = 3;
export const MAX_POCKET_TABS = 3;
export const QUEST_SIZE = 12;           // sizeof(QUEST)

/**
 * Live slot counts the client's `CItemContainer<CItemElem>` is sized with at
 * `SetItemContainer` time — these, NOT the bare defines, drive `m_dwItemMax`
 * and thus the array widths on the wire.
 *
 * Inventory: `m_Inventory.SetItemContainer( ITYPE_ITEM, MAX_INVENTORY, MAX_HUMAN_PARTS )`
 * (`_Network/Objects/Obj.cpp:128`); `dwExtra != 0xffffffff` so `m_dwItemMax += MAX_HUMAN_PARTS`
 * (`Obj.h:354-355`) → 42 + 31 = **73** slots. Writing only 42 here desyncs the stream
 * by 248 bytes and crashes the client in `CItemContainer::Serialize` (garbage `ch` →
 * `m_apItem[ch]` OOB → 0xC0000005 reading ~0x8).
 *
 * Bank tabs: `m_Bank[i].SetItemContainer( ITYPE_ITEM, MAX_BANK )` (`Obj.cpp:133`) —
 * `dwExtra` defaults to 0xffffffff → no add → 42 slots.
 */
export const INVENTORY_SLOTS = MAX_INVENTORY + MAX_HUMAN_PARTS; // 73
export const BANK_SLOTS = MAX_BANK;                             // 42

/** Wire bytes of an empty CItemContainer<CItemElem> with `slots` slots. */
export function emptyItemContainerSize(slots: number): number {
  return 4 * slots + 1 + 4 * slots; // m_apIndex[] + chSize + adwObjIndex[]
}

// --- Peer-broadcast snapshot sub-types (S→C) --------------------------------
// `_Network/MsgHdr.h` — all typed `(WORD)`, written as 2 bytes on the wire
// (mirrors the working JOIN serializer's `writeWord(SNAPSHOTTYPE_*)`).
export const SNAPSHOTTYPE_DESTPOS = 0x00c1;          // MsgHdr.h:1086 — click-to-move echo
export const SNAPSHOTTYPE_MOVERMOVED = 0x00ca;       // MsgHdr.h:1095 — 60B movement frame
export const SNAPSHOTTYPE_MOVERBEHAVIOR = 0x00cb;    // MsgHdr.h:1096 — 60B motion frame (same body)
export const SNAPSHOTTYPE_QUERY_PLAYER_DATA = 0x0141; // MsgHdr.h:1195
// Added for the remaining v15 C→S handlers (DPSrvr.cpp MsgHdr.h):
export const SNAPSHOTTYPE_CHAT_OUT = 0x00bc;         // MsgHdr.h:1078 — CHATTEXT (S→C chat echo)
export const SNAPSHOTTYPE_MOTION = 0x0098;           // MsgHdr.h:1034 — MOTION echo
export const SNAPSHOTTYPE_MOVERCORR = 0x00c8;        // MsgHdr.h:1093 — PLAYERCORR echo (60B body)
export const SNAPSHOTTYPE_MOVERMOVED2 = 0x00cc;      // MsgHdr.h:1097 — PLAYERMOVED2 echo (73B body)

/** `NULL_ID` (`_Network/MsgHdr.h`) — "no object" sentinel. */
export const NULL_ID = 0xffffffff;

/**
 * Circular ground-plane broadcast radius approximating the v15 `CLinkMap`
 * visibility grid (`LinkMap.cpp:66`): standard outdoor zone `nView=1`, 64-unit
 * cells, 2-cell range ⇒ 256×256 broadcast box (128 half-extent per axis). A
 * circle that covers that box needs r ≥ 128√2 ≈ 181; 200 rounds up to guarantee
 * no in-box peer is missed (slight overshoot at the diagonals is harmless —
 * extra writes to peers who can't yet render the mover, never a client crash).
 *
 * ponytail: `ZoneManager.broadcastAround` uses a circle, C++ uses a box; swap
 * to a box check if peer pop-in/desync shows up under real load.
 */
export const VISIBILITY_RADIUS = 200;
