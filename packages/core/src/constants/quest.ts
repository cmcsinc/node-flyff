/**
 * Quest engine constants -- mirrors the v15 C++ defines.
 *
 * Sources:
 *   QS_BEGIN           resource/defineNeuz.h:86
 *   QS_END             resource/definequest.h:520
 *   MAX_QUEST          _Common/ProjectCmn.h:27
 *   MAX_COMPLETE_QUEST _Common/ProjectCmn.h:28
 *   MAX_CHECKED_QUEST  _Common/ProjectCmn.h:30
 *   QT_*               resource/definequest.h:523-525
 *   QUEST_KIND_*       resource/definequest.h:507-510
 *   MAX_QUESTREMOVE    resource/definequest.h (SetEndRemoveQuest array cap)
 *
 * The `QUEST` struct wire layout (12 bytes, `_Common/Mover.h:267`) lives in
 * `packages/world-server/src/net/snapshot/quest.serializer.ts`.
 *
 * @module constants/quest
 */

/** Quest state (`m_nState`). `QS_BEGIN`=newly started, `QS_END`=complete. */
export const QS_BEGIN = 0;
export const QS_END = 14;

/** Per-player array caps (`_Common/ProjectCmn.h`). */
export const MAX_QUEST = 100;
export const MAX_COMPLETE_QUEST = 300;
export const MAX_CHECKED_QUEST = 5;

/** `SetEndRemoveQuest` array cap (definequest.h). */
export const MAX_QUESTREMOVE = 12;

/**
 * `SNAPSHOTTYPE_REMOVEQUEST` `nRemoveType` (`User.cpp:1367-1399`).
 * - `CANCEL`         (-1) AddCancelQuest -- show "quest removed" chat text
 * - `SILENT`         (0)  AddRemoveQuest -- silent remove one
 * - `ALL`            (1)  AddRemoveAllQuest -- clear active list
 * - `CLEAR_COMPLETE` (2)  AddRemoveCompleteQuest -- clear completed list
 */
export const REMOVEQUEST_TYPE = Object.freeze({
  CANCEL: -1,
  SILENT: 0,
  ALL: 1,
  CLEAR_COMPLETE: 2,
} as const);

/** `CalluspLoggingQuest` action codes (`ScriptHelper.cpp:767/772/789`, `DPSrvr.cpp:1121`). */
export const QUEST_LOG_ACTION = Object.freeze({
  START: 10,
  END: 20,
  CANCEL: 30,
} as const);

/**
 * Quest type (`QT_*`, definequest.h:523-525). Drives grouping in the UI
 * (`CWndQuest` separates scenario vs normal vs request).
 */
export const QUEST_TYPE = Object.freeze({
  GENERAL: 0,
  REQUEST: 1,
  SCENARIO1: 2,
} as const);

/**
 * Quest kind / category parent id range (definequest.h:507-510). Quests whose
 * `SetHeadQuest` points here group under that UI header.
 */
export const QUEST_KIND = Object.freeze({
  SCENARIO: 6000,
  NORMAL: 6001,
  REQUEST: 6002,
  EVENT: 6003,
} as const);

/** QUEST bitfield flags (`_Common/Mover.h` `m_bPatrol`/`m_bDialog` bits). */
export const QUEST_FLAG = Object.freeze({
  PATROL: 1 << 0,
  DIALOG: 1 << 1,
} as const);
