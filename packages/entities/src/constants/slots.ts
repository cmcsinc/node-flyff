/**
 * Slot-sizing constants for CPlayer/CMover fields + the taskbar grid.
 *
 * Carved out of `world-server/net/snapshot/constants.ts` so entity field widths
 * (`m_Inventory`, `m_Bank`, `m_aJobSkill`, `m_aSlotItem`) resolve from
 * `@flyff/entities` without depending on the world-server protocol layer.
 *
 * @module entities/constants/slots
 */

/** `NULL_ID` (`_Network/MsgHdr.h`) -- "no object" sentinel. */
export const NULL_ID = 0xffffffff;

// --- Raw struct / array sizes ------------------------------------------------
export const MAX_HUMAN_PARTS = 31;
export const MAX_SKILL_JOB = 45;
export const MAX_INVENTORY = 42;
export const MAX_BANK = 42;
export const MAX_BANK_TABS = 3;

/**
 * Live slot counts the client's `CItemContainer<CItemElem>` is sized with at
 * `SetItemContainer` time -- these, NOT the bare defines, drive `m_dwItemMax`
 * and thus the array widths on the wire.
 *
 * Inventory: `m_Inventory.SetItemContainer( ITYPE_ITEM, MAX_INVENTORY, MAX_HUMAN_PARTS )`
 * (`_Network/Objects/Obj.cpp:128`); `dwExtra != 0xffffffff` so `m_dwItemMax += MAX_HUMAN_PARTS`
 * (`Obj.h:354-355`) -> 42 + 31 = **73** slots. Writing only 42 here desyncs the stream
 * by 248 bytes and crashes the client in `CItemContainer::Serialize`.
 *
 * Bank tabs: `m_Bank[i].SetItemContainer( ITYPE_ITEM, MAX_BANK )` (`Obj.cpp:133`) --
 * `dwExtra` defaults to 0xffffffff -> no add -> 42 slots.
 */
export const INVENTORY_SLOTS = MAX_INVENTORY + MAX_HUMAN_PARTS; // 73
export const BANK_SLOTS = MAX_BANK;                             // 42

// --- Taskbar hotkey grid (`_Common/ProjectCmn.h:901-923`) --------------------
export const MAX_SLOT_ITEM_COUNT = 8;   // ProjectCmn.h:904 -- taskbar pages (rows)
export const MAX_SLOT_ITEM = 9;         // ProjectCmn.h:901 -- slots per page
/**
 * Action-slot queue depth (C++ `MAX_SLOT_QUEUE`, `ProjectCmn.h:902`). The
 * action slot holds up to 5 queued skills the client fires in sequence
 * (`CUserTaskBar::m_aSlotQueue[MAX_SLOT_QUEUE]`). Populated via
 * `PACKETTYPE_SKILLTASKBAR`; persisted alongside `m_aSlotItem` in
 * `characters.taskbar`; replayed via the queue section of
 * `SNAPSHOTTYPE_TASKBAR`.
 */
export const MAX_SLOT_QUEUE = 5;
export const MAX_SHORTCUT_STRING = 128; // _Common/DefineCommon.h:9 -- chat-macro text cap

/**
 * `m_dwShortcut` discriminant (`ProjectCmn.h:910-923`) -- selects how the
 * client interprets the rest of the SHORTCUT struct. NONE = empty slot.
 */
export const SHORTCUT = Object.freeze({
  NONE:      0,
  OBJECT:    7,   // inventory item
  CHAT:      8,   // chat macro (carries m_szString; capped at 10/player)
  SKILLFUN:  9,   // skill
  EMOTICON:  10,
  LORDSKILL: 11,
} as const);

/** Per-player cap on chat-macro shortcuts (`OnAddItemTaskBar:2231` rejects >9). */
export const MAX_SHORTCUT_CHAT = 9;

// --- Consumable cooldown groups (`_Common/CooltimeMgr.h`) --------------------
// Groups are 1-based (C++ dwGroup-1 indexes m_times[]). 1..3 mirror v15
// CCooltimeMgr::GetGroup (food / pill / skill); 4 = potions (our addition --
// vanilla comments IK2_POTION out, so HP potions there have no cooldown).
export const MAX_COOLTIME_GROUP = 4;
export const COOLTIME_GROUP = Object.freeze({
  FOOD: 1,
  PILL: 2,
  SKILL: 3,
  POTION: 4,
} as const);
