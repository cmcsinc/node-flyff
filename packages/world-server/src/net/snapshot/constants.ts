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

/** Wire size of an empty CItemContainer<CItemElem> (inventory or one bank tab). */
export const EMPTY_ITEM_CONTAINER_SIZE =
  4 * MAX_INVENTORY +  // m_apIndex[] (NULL_ID per empty slot)
  1 +                  // chSize == 0 (no non-empty slots)
  4 * MAX_INVENTORY;   // adwObjIndex[] (NULL_ID per empty slot)
